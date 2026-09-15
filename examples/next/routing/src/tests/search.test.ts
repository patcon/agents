import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MATCH_CLOSE, MATCH_OPEN } from "../shared";

function uniqueUser() {
  return `user-${Math.random().toString(36).slice(2)}`;
}

function chatUrl(userId: string, chatId: string) {
  return `http://example.com/agents/user-hub/${encodeURIComponent(userId)}/chats/${encodeURIComponent(chatId)}/messages`;
}

async function post(userId: string, chatId: string, text: string) {
  const response = await exports.default.fetch(chatUrl(userId, chatId), {
    method: "POST",
    body: JSON.stringify({ role: "user", text })
  });
  expect(response.status).toBe(200);
}

/** The hub's plain HTTP view, which reports how many rows the index holds. */
async function catalog(userId: string) {
  const response = await exports.default.fetch(
    `http://example.com/agents/user-hub/${encodeURIComponent(userId)}`
  );
  expect(response.status).toBe(200);
  return response.json<{ indexedMessages: number; chats: { id: string }[] }>();
}

describe("full-text search over every message, served by the hub alone", () => {
  it("finds a message that is neither the title nor the last message", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();

    await post(userId, chatId, "kicking off the migration");
    await post(userId, chatId, "the pelican benchmark looked wrong");
    await post(userId, chatId, "shipping tomorrow");

    // Buried in the middle: the old metadata-only search saw only the
    // first message (title) and the last one.
    const [hit] = await user.searchChats("pelican");
    expect(hit).toMatchObject({
      id: chatId,
      metadata: {
        title: "kicking off the migration",
        lastMessage: "shipping tomorrow"
      }
    });
  });

  it("returns one ranked row per chat, with a highlighted snippet", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const quiet = await user.createChat();
    const loud = await user.createChat();

    await post(userId, quiet, "one passing mention of quokkas");
    await post(userId, loud, "quokkas, quokkas and more quokkas");
    await post(userId, loud, "still talking about quokkas");

    const hits = await user.searchChats("quokkas");
    // One row per chat even though `loud` matched twice.
    expect(hits.map((hit) => hit.id)).toEqual([loud, quiet]);
    expect(hits[0]?.snippet).toContain(`${MATCH_OPEN}quokkas${MATCH_CLOSE}`);
    expect(hits[0]?.seq).toBeGreaterThan(0);
  });

  it("matches a word the user is still typing", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();
    await post(userId, chatId, "reticulating splines");

    expect((await user.searchChats("retic")).map((h) => h.id)).toEqual([
      chatId
    ]);
  });

  it("reads FTS5 operators in the search box as literal text", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();
    await post(userId, chatId, "deploy and rollback notes");

    // Each of these is valid FTS5 syntax that would throw, or quietly
    // mean something other than what was typed, if the raw string
    // reached MATCH. All of them are read as plain terms instead.

    // "and" is a word in the message, not a boolean operator.
    expect(
      (await user.searchChats("deploy AND rollback")).map((h) => h.id)
    ).toEqual([chatId]);
    // Not a negation: this asks for the literal word "not", which the
    // message does not contain ("notes" is a different token).
    expect(await user.searchChats("NOT deploy")).toEqual([]);
    // Not a column filter: this asks for the literal word "text".
    expect(await user.searchChats("text:deploy*")).toEqual([]);
    // Unbalanced quotes and empty input are answered, not thrown.
    expect(await user.searchChats('"')).toEqual([]);
    expect(await user.searchChats("   ")).toEqual([]);
  });

  it("indexes an out-of-order push even though the metadata fence rejects it", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();

    await user.recordChatActivity(
      chatId,
      { title: "Newer", lastMessage: "arrived first", seq: 2 },
      { role: "user", text: "arrived first", at: Date.now(), seq: 2 }
    );
    // Delivered second, lower ordinal: the snapshot is refused...
    expect(
      await user.recordChatActivity(
        chatId,
        { title: "Older", lastMessage: "delayed", seq: 1 },
        { role: "user", text: "delayed marsupial", at: Date.now(), seq: 1 }
      )
    ).toBe(false);

    // ...but the message it carried is a real message, and searchable.
    expect((await user.searchChats("marsupial")).map((h) => h.id)).toEqual([
      chatId
    ]);
    expect((await user.listChats())[0]?.metadata).toMatchObject({
      title: "Newer"
    });
  });

  it("ignores a replayed push instead of double-indexing it", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();
    const message = {
      role: "user" as const,
      text: "exactly once",
      at: Date.now(),
      seq: 1
    };
    const meta = { title: "t", lastMessage: "exactly once", seq: 1 };

    await user.recordChatActivity(chatId, meta, message);
    await user.recordChatActivity(chatId, meta, message);

    expect((await catalog(userId)).indexedMessages).toBe(1);
  });

  it("drops a deleted chat's messages out of the index", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const kept = await user.createChat();
    const removed = await user.createChat();

    await post(userId, kept, "shared keyword here");
    await post(userId, removed, "shared keyword there");
    expect((await user.searchChats("keyword")).length).toBe(2);

    expect(await user.deleteChat(removed)).toBe(true);
    expect((await user.searchChats("keyword")).map((h) => h.id)).toEqual([
      kept
    ]);
    expect((await catalog(userId)).indexedMessages).toBe(1);
  });

  it("never returns a hit for a chat missing from the catalog", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();
    await post(userId, chatId, "orphan candidate");

    // Index a message for an id that was never in the catalog: refused,
    // so a stale hit can't outlive its entry.
    expect(
      await user.recordChatActivity(
        crypto.randomUUID(),
        { title: null, lastMessage: null, seq: 1 },
        { role: "user", text: "orphan candidate", at: Date.now(), seq: 1 }
      )
    ).toBe(false);

    expect((await user.searchChats("orphan")).map((h) => h.id)).toEqual([
      chatId
    ]);
  });

  it("reindexChat rebuilds a chat's slice from the chat itself", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    const chatId = await user.createChat();

    await post(userId, chatId, "first line");
    await post(userId, chatId, "second line");

    // The repair path is idempotent: running it over an already-correct
    // index leaves exactly the same rows.
    expect(await user.reindexChat(chatId)).toBe(2);
    expect((await catalog(userId)).indexedMessages).toBe(2);
    expect(await user.reindexChat(chatId)).toBe(2);
    expect((await catalog(userId)).indexedMessages).toBe(2);
    expect((await user.searchChats("second")).map((h) => h.id)).toEqual([
      chatId
    ]);
  });

  it("reindexChat is a no-op for a chat that no longer exists", async () => {
    const userId = uniqueUser();
    const user = env.UserHub.getByName(userId);
    expect(await user.reindexChat(crypto.randomUUID())).toBe(0);
  });

  it("keeps each user's index to their own hub", async () => {
    const alice = uniqueUser();
    const bob = uniqueUser();
    const aliceHub = env.UserHub.getByName(alice);
    const bobHub = env.UserHub.getByName(bob);
    const aliceChat = await aliceHub.createChat();
    await bobHub.createChat();

    await post(alice, aliceChat, "private to alice");

    expect((await aliceHub.searchChats("private")).map((h) => h.id)).toEqual([
      aliceChat
    ]);
    expect(await bobHub.searchChats("private")).toEqual([]);
  });
});
