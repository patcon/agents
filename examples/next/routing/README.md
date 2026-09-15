# Next: routing

An early-access example showing `RoutedAgents` from `agents/routing`
installed on a plain Cloudflare `DurableObject`. The hub does not extend
`Agent`; its targets do. It is the recommended shape for "many chats per
user": **one top-level Durable Object per chat** (`ChatAgent`), owned and
routed to by **one per-user hub** (`UserHub`).

```
UserHub "alice" (plain DurableObject)      ChatAgent (one per chat, opaque name)
┌────────────────────────────────┐         ┌──────────────────────────┐
│ RoutedAgents route "chats"     │ forward │ messages                 │
│  id → physical name,           │────────▶│  role, text, at          │
│       title, lastMessage       │         │  (own SQLite, own alarms,│
│ message_index + message_fts    │         │   own placement)         │
│  every message, FTS5-indexed   │◀────────│                          │
│ WebSockets callables           │  push   └──────────────────────────┘
└────────────────────────────────┘            addMessage / getMessages
   listChats / searchChats / deleteChat        exportMessages (repair)
   reindexChat — read and write ONLY the hub   owns its WebSocket
   (except reindexChat, which wakes one chat)
```

| URL                                          | Handled by                                  |
| -------------------------------------------- | ------------------------------------------- |
| `/agents/user-hub/alice`                     | `UserHub` "alice", JSON view of the catalog |
| `/agents/user-hub/alice/chats/{id}`          | the `ChatAgent` behind that entry           |
| `/agents/user-hub/alice/chats/{id}/messages` | same `ChatAgent`, sees the path `/messages` |

```ts
export class UserHub extends DurableObject<Env> {
  readonly chats = new RoutedAgents<ChatAgent, ChatMeta>({
    namespace: this.env.ChatAgent,
    route: "chats"
  });
  readonly webSockets = new WebSockets({ callables: new HubCallables(this) });
  readonly lifecycle = Lifecycle.install(this)
    .use(this.chats)
    .use(this.webSockets);
}
```

## Why not facets (dynamic agents)?

A chat fails the facet test on every axis: it needs no isolation
boundary from a parent, it wants its own alarms (facets cannot set
alarms), a user accumulates an unbounded number of them (a facet tree is
pinned to one machine and stored as one logical root object), and
every WebSocket frame to a facet wakes the root parent. Facets are for
code the parent _supervises_ — dynamically-loaded or generated code,
per-run tool agents — reached via `this.dynamicAgents`. See
`docs/agents/sub-agents.md` for the decision rule.

## What `RoutedAgents` does for the hub

- **Creation** allocates a public chat ID and an opaque physical name
  without waking anything. The hub then calls `init()` on the new chat
  once, through the typed stub `get(id)` returns, so the chat knows its
  owner.
- **Routing.** Requests and WebSocket upgrades under `/chats/{id}` are
  forwarded to that chat. The chat answers the upgrade and owns the
  socket, so chat frames never wake the hub. An unknown or deleted ID is
  a `404` from the capability; the hub's `onRequest` never sees it.
- **Listing and search** read only the hub. Each chat pushes its title,
  last message, and the message itself back with `recordChatActivity()`.
  That call fences the push's own chat-local message ordinal against the
  entry's current one, inside `blockConcurrencyWhile`, before calling
  `setMetadata()` — a
  push delayed by a slow round-trip can't overwrite one that arrived
  first, two concurrent pushes can't both read the same stale value, and
  two messages landing in the same millisecond never tie the way a
  wall-clock fence would. Entries list most recently updated first, ties
  broken by write order.
- **Deletion** is `chats.delete(id)`: the entry is hidden, the chat is
  condemned so it wipes its own storage moments later, and the row is
  removed. A push for a deleted chat returns `false`, so delayed
  activity cannot resurrect it. `deleteChat()` also drops the chat's rows
  from the hub's index — `chats.delete()` knows nothing about the hub's
  own tables, so skipping that would leave a deleted conversation
  searchable.

The pushed metadata is derived data. A failed push leaves it stale until
the chat's next message; the chat itself stays the source of truth.
The full production design is in
[`design/rfc-user-chat-durable-objects.md`](../../../design/rfc-user-chat-durable-objects.md).

## Search over every message, not just the index

The sidebar's metadata — title and last message — is what the hub needs
to _render_ a list. It is not enough to _search_ one: a message in the
middle of a conversation is invisible to it. Two ways to fix that, and
this example takes the second:

1. **Fan out.** Ask every chat to search itself in parallel. Exact, no
   extra storage, and the chat stays the only copy of its messages — but
   it wakes every chat on every keystroke, which is the one thing this
   shape exists to avoid, and a user's chat count is unbounded.
2. **Widen the push.** The chat already calls the hub on every message.
   Send the message text along with the metadata and index it there.

So `addMessage()` pushes the message with the snapshot, in the same
round-trip, and the hub keeps two tables of its own alongside the
catalog:

```ts
CREATE TABLE message_index (          -- durable copy, keyed for replay
  chat_id TEXT, seq INTEGER, role TEXT, text TEXT, at INTEGER,
  PRIMARY KEY (chat_id, seq)
)
CREATE VIRTUAL TABLE message_fts USING fts5(text, chat_id UNINDEXED)
```

Durable Object SQLite has FTS5 compiled in, so `searchChats()` is one
`MATCH` query ranked by `bm25()` against a single Durable Object. No chat
wakes up, and the hit comes back with a `snippet()` of the matching text.

Things worth copying from this, and things to design around:

- **Two tables, not one.** FTS5 has no `PRIMARY KEY`, so it cannot make
  an insert idempotent. `message_index` carries
  `PRIMARY KEY (chat_id, seq)` — reusing the ordinal the metadata fence
  already needed — and the FTS row shares its `rowid`. `INSERT OR IGNORE` makes a replayed push a
  no-op, which is what makes repair a one-liner.
- **Indexing sits outside the metadata fence.** The fence exists so a
  stale _snapshot_ can't overwrite a fresher one. An out-of-order
  message is still a real message and belongs in the index, and because
  the insert is keyed, order doesn't matter.
- **Never send raw input to `MATCH`.** FTS5 match syntax is a query
  language: a typed `NOT`, a `:` or an unbalanced quote changes the
  meaning or throws mid-query. `toMatchQuery()` keeps letters and digits,
  re-quotes each token, and joins with an implicit AND, so what you type
  is read as literal terms. The last token gets a `*` so results narrow
  while you're still typing the word.
- **Snippets are sentinels, not markup.** The hub wraps hits in two
  control characters and the browser splits on them, so a message can
  never inject HTML into another chat's sidebar row.
- **Matching is per message, not per chat.** Searching
  `migration pelican` finds a chat only if one _message_ contains both
  words. Per-chat matching would mean a second FTS table keyed by chat.
- **The hub now grows with message volume**, not just chat count. It is
  still bounded per user — a Durable Object gets 10GB — but it is a real
  change in the hub's storage profile.
- **`reindexChat(id)` is the repair path.** The index is derived; the
  chat is the source of truth. A failed push leaves a message
  unsearchable until the chat's next one, and reindexing pulls the chat's
  messages back over a stub and rebuilds its slice. It is the one
  operation here that wakes a chat, which is why it's explicit rather
  than something search does on its own.

## The hub is a plain Durable Object

The hub has no `@callable()` methods and no `Agent` base class, yet the
browser reaches it with `useAgent` like any Agent. The `WebSockets`
capability speaks the Agent protocol for it: on connect it sends the
identity frame that resolves `ready`, and it answers the `rpc` frames that
`stub` and `call()` send against the hub's `RpcTarget`. The client picks the
wire with `transport: "cf-websocket" | "capnweb"` (add `?transport=capnweb` to
the page URL to try the second). Each chat still reaches its owner with a
plain Durable Object stub, `env.UserHub.getByName(userId)`.

Install order matters: `RoutedAgents` goes first so a forwarded upgrade
under `/chats/{id}` reaches the chat, and only the hub's own upgrades fall
through to the WebSockets capability.

Two sharp edges to design around:

- **Pick a route that cannot collide.** Forwarding matches every occurrence
  of the route segment in the path. If the hub's own name, or a path the
  hub handles itself, is literally `chats`, a coincidental match with no
  active entry behind it is answered `404` instead of reaching the hub.
- **A routed suffix cannot address a chat's own dynamic agents.** A
  `/sub/{class}/{name}` marker is resolved against the hub before this
  capability runs. Reach a chat's dynamic agents through a direct
  connection to that chat.

This is a demo: anyone who knows a user ID can list, route into, and delete
that user's chats. Put authentication in front of `routeAgentRequest` and
derive the hub name from the session before deploying something like it.

## Run

```sh
pnpm install
pnpm run start
```

The React UI (Vite + Kumo) shows the whole pattern: the sidebar and
search use one `useAgent` connection to the plain hub, and each open chat
gets its own `useAgent` connection through the hub's route via `basePath`.
Type into the search box and the matching message is shown with its hit
highlighted — including messages buried mid-conversation, which the
metadata alone could never have found.
No model is wired in; the "assistant" reply is an echo that proves both
roles land in the chat's own SQLite.

## Test

```sh
pnpm run test
```
