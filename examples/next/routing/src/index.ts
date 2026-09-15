import { DurableObject, RpcTarget } from "cloudflare:workers";
import {
  Agent,
  callable,
  routeAgentRequest,
  type Connection,
  type WSMessage
} from "agents";
import { Lifecycle } from "agents/lifecycle";
import { RoutedAgents, type RoutedAgentEntry } from "agents/routing";
import { WebSockets } from "agents/websockets";
import {
  MATCH_CLOSE,
  MATCH_OPEN,
  MAX_QUERY,
  MAX_TEXT,
  SEARCH_LIMIT
} from "./shared";

/**
 * The recommended shape for "many chats per user": one top-level
 * Durable Object per chat, owned and routed to by a per-user hub.
 *
 * The hub is a plain Durable Object composed with two capabilities.
 * `RoutedAgents` gives it a durable catalog of chat IDs mapped to opaque
 * physical names, and forwards `/chats/{id}/...` requests and WebSocket
 * upgrades to the right chat. `WebSockets` serves the hub's own methods
 * to the browser, so `useAgent().stub` reaches them on either transport.
 * Each chat pushes its metadata
 * back into the hub so listing, search, and deletion never wake a chat.
 *
 * The targets must be `Agent`s: the capability relies on Agent's
 * condemnation protocol to wipe a deleted chat's storage.
 *
 * Contrast with dynamic agents (facets): a chat needs no isolation
 * boundary from its parent, does need its own alarms and placement,
 * and a user accumulates an unbounded number of them. See
 * docs/agents/sub-agents.md for the decision rule.
 */

type ChatMeta = {
  title: string | null;
  lastMessage: string | null;
  /**
   * The pushing message's own ordinal in its chat, from `messages`'
   * `AUTOINCREMENT` id. Fences out delayed or superseded pushes without
   * relying on `Date.now()` resolution: two messages sent back to back
   * (a real echo can round-trip inside one millisecond) get consecutive
   * ordinals and so never tie, unlike wall-clock timestamps.
   */
  seq: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  at: number;
};

/** A message as it travels to the hub's index: the chat's row, plus its ordinal. */
type IndexedMessage = ChatMessage & { seq: number };

/**
 * One chat in a search result: the catalog entry the sidebar already
 * renders, plus the best-matching message from that chat.
 */
type ChatSearchHit = RoutedAgentEntry<ChatMeta> & {
  /**
   * The matching text with hit terms wrapped in `MATCH_OPEN`/`MATCH_CLOSE`.
   * Sentinels rather than HTML: the browser splits on them and styles the
   * pieces, so a message can never inject markup into the sidebar.
   */
  snippet: string;
  /** The matching message's ordinal, for deep-linking into the chat. */
  seq: number;
};

/** Recorded once by the owning hub right after the entry is created. */
type ChatOwner = {
  userId: string;
  chatId: string;
};

/** Runtime guards: every method here is reachable from a browser. */
function assertRole(value: unknown): "user" | "assistant" {
  if (value === "user" || value === "assistant") return value;
  throw new Error('role must be "user" or "assistant"');
}
function assertText(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(
      `${what} must be a non-empty string of at most ${max} characters`
    );
  }
  return value;
}
function assertChatId(value: unknown): string {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof value !== "string" || !uuid.test(value)) {
    throw new Error("chatId must be an entry id");
  }
  return value;
}

/**
 * Turn a raw search box into an FTS5 `MATCH` expression.
 *
 * FTS5 match syntax is a query language — bare user input can mean `NOT`,
 * `OR`, a column filter, or a syntax error that throws mid-query. Keeping
 * only letters and digits and re-quoting each token means whatever is
 * typed is read as literal terms joined by an implicit AND. The last
 * token gets a prefix `*` so the sidebar narrows while you are still
 * typing the word.
 */
function toMatchQuery(query: string): string | null {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens?.length) return null;
  return tokens
    .map((token, index) =>
      index === tokens.length - 1 ? `"${token}"*` : `"${token}"`
    )
    .join(" ");
}

/**
 * Strip the highlight sentinels from text on the way into the index, so
 * a message can never forge a highlight in another chat's snippet.
 */
function stripSentinels(text: string): string {
  return text.replaceAll(MATCH_OPEN, "").replaceAll(MATCH_CLOSE, "");
}

/** One Durable Object per conversation, reached only through its owner. */
export class ChatAgent extends Agent<Env> {
  onStart(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        at INTEGER NOT NULL
      )
    `;
  }

  init(owner: ChatOwner): Promise<void> {
    return this.ctx.storage.put("owner", owner);
  }

  @callable()
  async addMessage(role: "user" | "assistant", text: string): Promise<number> {
    // Guard at the boundary and use what the guards return: this method
    // is reachable from a browser, where the declared types mean nothing.
    const validRole = assertRole(role);
    const validText = assertText(text, MAX_TEXT, "text");
    const at = Date.now();
    const [{ id: seq }] = this.sql<{ id: number }>`
      INSERT INTO messages (role, text, at) VALUES (${validRole}, ${validText}, ${at})
      RETURNING id
    `;

    // Push the latest snapshot to the owner so listing and search never
    // wake this DO. The owner's copy is derived data: a failed push
    // leaves it stale until the next message, and a push for a deleted
    // chat is refused, so nothing can resurrect a deleted entry.
    //
    // The message itself rides along so the hub can index its text. That
    // is what makes search cover every message rather than just the
    // latest one, and it costs no extra round-trip.
    const owner = await this.ctx.storage.get<ChatOwner>("owner");
    const [first] = this.sql<{ text: string }>`
      SELECT text FROM messages WHERE role = 'user' ORDER BY id ASC LIMIT 1
    `;
    if (owner) {
      try {
        const hub = this.env.UserHub.getByName(owner.userId);
        await hub.recordChatActivity(
          owner.chatId,
          {
            title: first ? first.text.slice(0, 80) : null,
            lastMessage: text.slice(0, 120),
            seq
          },
          { role: validRole, text: validText, at, seq }
        );
      } catch (error) {
        // The chat keeps the message either way; the hub's index is
        // derived. `reindexChat` repairs whatever a failed push dropped.
        console.warn("[ChatAgent] owner update failed", error);
      }
    }

    return seq;
  }

  /**
   * Every message with its ordinal, for the hub to rebuild its slice of
   * the index. Not `@callable()`: this is a hub-to-chat repair path over
   * a Durable Object stub, not browser surface.
   */
  exportMessages(): IndexedMessage[] {
    return this.sql<IndexedMessage>`
      SELECT id AS seq, role, text, at FROM messages ORDER BY id ASC
    `;
  }

  @callable()
  getMessages(): ChatMessage[] {
    return this.sql<ChatMessage>`
      SELECT role, text, at FROM messages ORDER BY id ASC
    `;
  }

  /**
   * HTTP surface. The path the chat sees is the forwarded suffix:
   * `/agents/user-hub/{user}/chats/{id}/messages` arrives here as
   * `/messages`.
   */
  override async onRequest(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/messages") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      const { role, text } = (body ?? {}) as Partial<ChatMessage>;
      // Only validation is a 400. A storage failure inside addMessage
      // propagates and surfaces as a 500, as it should.
      let validRole: "user" | "assistant";
      let validText: string;
      try {
        validRole = assertRole(role);
        validText = assertText(text, MAX_TEXT, "text");
      } catch (error) {
        return new Response(
          error instanceof Error ? error.message : "Invalid message",
          { status: 400 }
        );
      }
      await this.addMessage(validRole, validText);
    }
    return Response.json(this.getMessages());
  }

  /**
   * A WebSocket upgraded through the hub's route is answered by this
   * Agent, which then owns the socket: frames never wake the hub.
   */
  override onMessage(connection: Connection, message: WSMessage): void {
    connection.send(`echo:${String(message)}`);
  }
}

/**
 * The hub's remote interface. Prototype methods are the complete surface;
 * the WebSockets capability answers `useAgent().stub` calls against it on
 * either transport.
 */
class HubCallables extends RpcTarget {
  readonly #hub: UserHub;

  constructor(hub: UserHub) {
    super();
    this.#hub = hub;
  }

  createChat(): Promise<string> {
    return this.#hub.createChat();
  }

  listChats() {
    return this.#hub.listChats();
  }

  searchChats(query: string) {
    return this.#hub.searchChats(assertText(query, MAX_QUERY, "query"));
  }

  deleteChat(chatId: string): Promise<boolean> {
    return this.#hub.deleteChat(assertChatId(chatId));
  }

  reindexChat(chatId: string): Promise<number> {
    return this.#hub.reindexChat(assertChatId(chatId));
  }
}

/**
 * The per-user hub. It owns the set of chats, routes to them, and holds
 * the pushed metadata that the sidebar and search read.
 */
export class UserHub extends DurableObject<Env> {
  readonly chats = new RoutedAgents<ChatAgent, ChatMeta>({
    namespace: this.env.ChatAgent,
    // Claims every `/chats/{id}/...` path under this hub before any
    // other capability or onRequest sees it.
    route: "chats"
  });

  readonly webSockets = new WebSockets({
    callables: new HubCallables(this)
  });

  // RoutedAgents is installed first so a forwarded upgrade under
  // `/chats/{id}` reaches the chat; only the hub's own upgrades fall
  // through to the WebSockets capability.
  readonly lifecycle = Lifecycle.install(this)
    .use(this.chats)
    .use(this.webSockets);

  /**
   * The hub's own tables, alongside the catalog `RoutedAgents` manages.
   * Lifecycle calls this once per instance start, inside
   * `blockConcurrencyWhile`, before any request is dispatched.
   *
   * `message_index` is the durable copy, keyed by the pushing chat's own
   * ordinal so a replayed push is a no-op. `message_fts` is the FTS5
   * index over the same rows, sharing their `rowid`. Two tables rather
   * than one because FTS5 has no `PRIMARY KEY` to make the insert
   * idempotent, and idempotency is what makes repair trivial.
   */
  onStart(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS message_index (
        chat_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, seq)
      )
    `);
    sql.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        text,
        chat_id UNINDEXED
      )
    `);
  }

  async createChat(): Promise<string> {
    const { id } = await this.chats.create({
      metadata: { title: null, lastMessage: null, seq: 0 }
    });
    try {
      // get() resolves the entry to an initialized, typed stub for RPC.
      const chat = await this.chats.get(id);
      if (!chat) throw new Error(`Chat ${id} vanished during creation`);
      await chat.init({ userId: this.lifecycle.name, chatId: id });
    } catch (error) {
      // The catalog row is uninitialized ownership without a matching
      // one-time init call, so it would never learn the chat pushes its
      // activity back into. Remove it rather than leave a chat that looks
      // created but can never appear as more than "New chat" again.
      await this.chats.delete(id);
      throw error;
    }
    return id;
  }

  /**
   * DO-RPC target for ChatAgent pushes. Rejects a push whose `seq` is
   * not strictly greater than the entry's current one, so a push
   * delayed by a slow round-trip can't overwrite one that arrived first
   * — `RoutedAgents.setMetadata()` itself has no ordering concept, so
   * the fence lives here. False for a deleted chat or a superseded push.
   *
   * `blockConcurrencyWhile` makes the read-then-write atomic against
   * other concurrent calls to this method on this same hub instance —
   * without it, two pushes could both read the same "current" value
   * before either writes, and the fence would compare against a value
   * that's already stale by the time the later one applies.
   */
  recordChatActivity(
    chatId: string,
    meta: ChatMeta,
    message?: IndexedMessage
  ): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const current = (await this.chats.list()).find(
        (entry) => entry.id === chatId
      );
      // A deleted chat is refused outright — nothing indexed, nothing
      // written — so delayed activity cannot resurrect it.
      if (!current) return false;

      // Indexing is deliberately outside the fence. The fence exists so
      // a stale *snapshot* cannot overwrite a fresher one, but an
      // out-of-order message is still a real message and belongs in the
      // index. The insert is keyed on (chat_id, seq), so ordering does
      // not matter and a replayed push is a no-op.
      if (message) this.#indexMessage(chatId, message);

      if ((current.metadata?.seq ?? 0) >= meta.seq) return false;
      return this.chats.setMetadata(chatId, meta);
    });
  }

  /** Idempotent on `(chat_id, seq)`: safe to call again for any message. */
  #indexMessage(chatId: string, message: IndexedMessage): void {
    const sql = this.ctx.storage.sql;
    const text = stripSentinels(message.text);
    const [inserted] = [
      ...sql.exec<{ rowid: number }>(
        `INSERT OR IGNORE INTO message_index (chat_id, seq, role, text, at)
         VALUES (?, ?, ?, ?, ?)
         RETURNING rowid`,
        chatId,
        message.seq,
        message.role,
        text,
        message.at
      )
    ];
    // No row back means this message was already indexed.
    if (!inserted) return;
    sql.exec(
      `INSERT INTO message_fts (rowid, text, chat_id) VALUES (?, ?, ?)`,
      inserted.rowid,
      text,
      chatId
    );
  }

  /** Most recent activity first; reads only this DO. */
  listChats() {
    return this.chats.list();
  }

  /**
   * Full-text search over every message this user has ever sent, still
   * reading only this Durable Object — no chat wakes up.
   *
   * FTS5 ranks with `bm25`, where lower is better. A chat can match on
   * many messages; only its best one is returned, so the sidebar stays
   * one row per chat. Entries deleted since a message was indexed are
   * dropped by the join against the live catalog.
   */
  async searchChats(query: string): Promise<ChatSearchHit[]> {
    const match = toMatchQuery(query);
    if (!match) return [];

    const rows = [
      ...this.ctx.storage.sql.exec<{
        chat_id: string;
        rowid: number;
        snippet: string;
        score: number;
      }>(
        `SELECT chat_id, rowid,
                snippet(message_fts, 0, ?, ?, '…', 12) AS snippet,
                bm25(message_fts) AS score
         FROM message_fts
         WHERE message_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
        MATCH_OPEN,
        MATCH_CLOSE,
        match,
        // Over-fetch: many rows can collapse onto one chat.
        SEARCH_LIMIT * 20
      )
    ];

    const best = new Map<string, { rowid: number; snippet: string }>();
    for (const row of rows) {
      // Rows arrive best-first, so the first sighting of a chat wins.
      if (!best.has(row.chat_id)) {
        best.set(row.chat_id, { rowid: row.rowid, snippet: row.snippet });
      }
    }

    const entries = new Map(
      (await this.chats.list()).map((entry) => [entry.id, entry])
    );
    const hits: ChatSearchHit[] = [];
    for (const [chatId, hit] of best) {
      const entry = entries.get(chatId);
      if (!entry) continue;
      const [row] = [
        ...this.ctx.storage.sql.exec<{ seq: number }>(
          `SELECT seq FROM message_index WHERE rowid = ?`,
          hit.rowid
        )
      ];
      hits.push({ ...entry, snippet: hit.snippet, seq: row?.seq ?? 0 });
      if (hits.length === SEARCH_LIMIT) break;
    }
    return hits;
  }

  /**
   * Destroys the chat's own storage, removes it from the catalog, and
   * drops its messages from the index. `chats.delete()` knows nothing
   * about this hub's tables, so forgetting the second half here would
   * leave a deleted conversation searchable.
   */
  async deleteChat(chatId: string): Promise<boolean> {
    const deleted = await this.chats.delete(chatId);
    if (deleted) this.#forgetChat(chatId);
    return deleted;
  }

  #forgetChat(chatId: string): void {
    const sql = this.ctx.storage.sql;
    sql.exec(
      `DELETE FROM message_fts
       WHERE rowid IN (SELECT rowid FROM message_index WHERE chat_id = ?)`,
      chatId
    );
    sql.exec(`DELETE FROM message_index WHERE chat_id = ?`, chatId);
  }

  /**
   * Rebuild one chat's slice of the index from the chat itself, which is
   * the source of truth. This is the repair path for a push that failed:
   * the chat kept the message, the hub never saw it, and search would
   * miss it until the next message arrived.
   *
   * This is the one operation here that wakes a chat, which is why it is
   * an explicit repair call and not something search does on its own.
   * Returns the number of messages indexed.
   */
  async reindexChat(chatId: string): Promise<number> {
    const chat = await this.chats.get(chatId);
    if (!chat) return 0;
    const messages = await chat.exportMessages();
    return this.ctx.blockConcurrencyWhile(async () => {
      // Still present after the round-trip? A delete may have landed
      // while the chat was answering.
      const entries = await this.chats.list();
      if (!entries.some((entry) => entry.id === chatId)) return 0;
      // Drop first: this repairs a partial index and also clears rows
      // for messages the chat no longer has.
      this.#forgetChat(chatId);
      for (const message of messages) this.#indexMessage(chatId, message);
      return messages.length;
    });
  }

  /** Plain HTTP view of the catalog, for curl. */
  async onRequest(): Promise<Response> {
    const [counts] = [
      ...this.ctx.storage.sql.exec<{ indexed: number }>(
        `SELECT COUNT(*) AS indexed FROM message_index`
      )
    ];
    return Response.json({
      user: this.lifecycle.name,
      indexedMessages: counts?.indexed ?? 0,
      chats: await this.chats.list()
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Routes both /agents/user-hub/{user} and the forwarded
    // /agents/user-hub/{user}/chats/{id}/... paths: RoutedAgents claims the
    // latter from inside the hub once the request reaches it.
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
