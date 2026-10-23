# Spec: drafting text fields from speech

Status: draft, for review. Module `voice-drafting`, slice 1.1 in [`capability-map.md`](capability-map.md). It builds on [`text-dictation`](spec-text-dictation.md). `context-carryover`, `draft-ahead`, `planner` and `projects` come after it and are out of scope here.

## Objective

People speak conversationally: they ramble, correct themselves and circle back. Verbatim dictation puts all of that in the field. This slice has an LLM rewrite a text question's draft from what was said while it showed, so the field holds what they meant, written the way the field asks for.

Who it's for: whoever is answering, host or participant, and playbook authors, who say in prose how a field's answer should read.

Success means that if someone says "um, tags, so housing, and transport, oh and not parks, actually yes parks, and libraries" while the tags question shows, and its hints ask for "a comma-separated list of short tags", the field reads "housing, transport, parks, libraries". It's marked "Filled in from what was said", ready to edit and submit. If they then say "just write exactly what I said", the next draft is their words as said.

## How it works

### Which questions

Every text question with dictation on (`text-dictation`'s rule: `type: "text"`, unless `dictate: false`) is drafted, as long as drafting is on for the Worker. There's no per-prompt off switch for drafting alone: `"dictate": false` turns off both dictation and drafting, and `DRAFT_ENABLED="false"` turns drafting off everywhere, which leaves `text-dictation` exactly as it is. That switch is for cost, and for wherever text shouldn't go to a model. It works like `JEV_ENABLED`: on unless set to `"false"`.

Verbatim for a single prompt is asked for in its hints ("write exactly what was said"), or out loud.

### Hints

~~A plan prompt~~ A plan's text question can carry `draftHints`, a string in natural language about style and length: "two or three sentences, plain language"; "a comma-separated list of short tags". ~~It's carried onto `Question.draftHints` by `questionFor()`, as `dictate` is.~~ It sits beside `dictate` and `length` in the text question's shape, and `questionFor()` passes it through with the rest (decided 2026-10-23, once questions got a shape per type). Its Zod `describe()` tells the compiler what it's for, so a playbook author writes hints as prose and the compiler carries them over. With no hints, the draft is a clean, faithful version of what was said.

### A rewrite after each utterance

Drafting runs on the server, in `ConversationAgent`, in the same way as Jev's `#assess()`:

- After an utterance is appended, if the question it counts for (its `onScreen`) is drafted, still open (a skip doesn't close it), and not taken over (below), a rewrite for that question is started.
- There's one call per question in flight. Whatever is said meanwhile is covered by one more call after it, as with `#assessAgain`. Different questions can be drafted at the same time.
- A call is skipped if the latest draft for the question has already seen its latest utterance.
- The call gets the question's prompt, its `draftHints`, every utterance that counts for it in order, and the previous draft if there is one. It returns `{ "draft": string }`.
- `generateJson()` with `AGENT_MODEL` (`gemini-3.8-flash`) at `thinkingLevel: "low"`. Calls and tokens are added to `agentCalls`, `agentInputTokens` and `agentOutputTokens`, so the log drawer's cost estimate covers them.
- If the call fails, it's logged to the console and nothing is appended. The field keeps showing the verbatim text, so nothing is lost.

The system prompt is `src/draft/prompts/draft.md`, imported with `?raw` the way the compiler's prompts are. It says:

- **Nothing invented.** The draft may reorganise, condense and fix grammar, but adds nothing that wasn't said.
- **Talk about the draft is an instruction, not content.** "Shorter", "drop the bit about parking" and "write exactly what I said" change how it's written, and aren't written into it. Since every call sees every utterance, an instruction keeps holding for later drafts.
- **Follow the hints** for style and length, unless the speaker asks otherwise out loud.
- **Write in the speaker's language,** not the language of the hints, unless the hints say otherwise.
- **Corrections win.** When they correct themselves, the draft keeps the correction.

### The `draft` log entry

A new log entry kind, so every device and the server fold the same draft, and it's clear afterwards what the LLM wrote:

```ts
| { kind: "draft"; subjectId: string; at: number } // subjectId: the question's id

/** An LLM's rewrite of a text question's draft from what was said. */
export type Draft = {
  text: string;
  /** The last utterance it saw that counts for this question. */
  seenUpTo: string;
  model: string;
};
```

It goes in `LogDataParts` as `draft: Draft`, in a `data-draft` part with `role: "system"`, like `assessment`.

### The fold

`foldLog()` gives a drafted text question's `suggested` from:

1. the latest `draft` entry's `text` for that question, if there is one;
2. then, verbatim, the utterances that count for it after that draft's `seenUpTo`, as `text-dictation` joins them.

Each part is joined with a single space, and empty parts are left out. With no draft yet, this is exactly `text-dictation`'s draft. As now, `suggested` is left out when the result is empty, and an answered question shows its answer.

The interim text still shows greyed after `suggested`, as in `text-dictation`. Words show as soon as they're said, and the next draft takes them in.

### Taking over stops drafting

Once someone changes the field's text it's theirs, as in `text-dictation`, and the page already stops showing new speech there. The server can't see that, so the page tells it: when a text question's card becomes edited, the page calls a new `takeOver(questionId)` callable. The server keeps that question in an in-memory set and starts no more calls for it.

`takeOver` isn't logged, because the edit itself isn't: it saves calls, and doesn't change what anyone sees. If the Durable Object restarts, the set is lost, and a few more drafts may be logged. The page ignores them, as it ignores new speech now. One device's edit stops drafting on every device; it's the same person answering.

Revising around their edits stays a `planner` question.

### "Drafting…"

While a call is in flight for a question, the server broadcasts `{ type: "drafting", questionIds }`, unlogged, like `jev-preview`. It's sent whenever the set of in-flight questions changes. The page shows a small "Drafting…" sign beside the "Filled in from what was said" badge on the question on screen while it's in that set. Nothing else is shown: the verbatim transcript stays in the transcript drawer.

## Commands

```bash
pnpm install
pnpm test                  # vitest: tests/**/*.test.ts and src/**/*.test.ts
pnpm exec tsc --noEmit     # typecheck
pnpm run start             # vite dev, for checking it by hand
pnpm check-plans           # admin-setup.json still lints against the schema, which gains draftHints
pnpm types                 # regenerate env.d.ts after adding DRAFT_ENABLED
pnpm try-draft [case]      # new: runs sample rambles past the draft prompt, for reading by eye
```

## Project structure (what this slice touches)

```
src/shared.ts              Question.draftHints, the `draft` LogMeta kind and Draft type, foldLog() composes `suggested`
src/shared.test.ts         fold cases for drafts
src/draft/draft.ts         new: draftRequest() builds the call from a question, its utterances and the previous draft; readDraft() checks the answer
src/draft/draft.test.ts    new, beside it
src/draft/prompts/draft.md new: the system prompt
src/server.ts              #draftSoon()/#draft() per question, takeOver(), the `drafting` broadcast
src/plan/plan.ts           `draftHints` on ~~the prompt payload; questionFor() carries it over~~ the text question's shape
src/plan/plan.test.ts      a questionFor() case for draftHints
src/plan/plan.schema.json, plan.llm.schema.json   regenerated
src/plan/admin-setup.json  the tags question gains draftHints
src/client.tsx             calls takeOver when a text card becomes edited; shows "Drafting…"
scripts/try-draft.ts       new: sample cases, run with tsx, prints each draft
package.json               a `try-draft` script
wrangler.jsonc, env.d.ts, .env.example   DRAFT_ENABLED
README.md                  "Dictation" gains a paragraph on drafting
design/spec-voice-drafting.md   this file
```

## Code style

Follow `src/models/jev.ts` and `src/compile/compile.ts`: building the request and reading the answer are pure functions the server and a script can both use. The server only schedules and logs. The fold stays plain:

```ts
// A text question's draft: the LLM's latest rewrite, then what it hasn't seen yet.
const said = view.utterances.filter((u) => u.onScreen === question.id);
const draft = drafts.get(question.id);
const unseen = draft
  ? said.slice(said.findIndex((u) => u.id === draft.seenUpTo) + 1)
  : said;
const text = [draft?.text, ...unseen.map((u) => u.text)]
  .filter(Boolean)
  .join(" ");
if (text) entry.suggested = text;
```

## Testing strategy

Tests live beside the file they test. No model calls in unit tests.

`src/shared.test.ts`, with hand-built logs:

1. No draft: `suggested` is the verbatim utterances, as before.
2. A draft, then more utterances: the draft's text followed by the unseen utterances, verbatim.
3. A draft that saw the last utterance: just its text.
4. Two drafts: the later one wins.
5. A draft for another question doesn't apply.
6. `dictate: false`: no `suggested`, even with a draft in the log.
7. A draft with empty text and nothing after it: no `suggested`.

`src/draft/draft.test.ts`:

1. `draftRequest()` includes the prompt, the hints (or says there are none), every utterance in order, and the previous draft when there is one.
2. `readDraft()` returns the text, and throws on a missing or non-string `draft`.

`src/plan/plan.test.ts`: `questionFor()` carries `draftHints`.

`pnpm try-draft`, read by eye, with these cases at least:

- a ramble with a self-correction, with tag-list hints;
- "just write exactly what I said";
- "drop the bit about parking", after a draft that mentions parking;
- no hints;
- Dutch speech with English hints;
- a ramble that could tempt the model to add detail, to check it adds nothing.

Then a check by hand with `pnpm run start`: on the tags question, speak a ramble with a correction. Words should show verbatim at once and be replaced by a tidy draft, with "Drafting…" showing while it's written. Say "write exactly what I said" and the next draft is verbatim. Type in the field and no more draft calls happen (the log drawer's call count stops rising). With `DRAFT_ENABLED=false` it's `text-dictation` as before. Drafts are logged and the cost estimate rises.

## Boundaries

- **Always:** run `pnpm test` and the typecheck before each commit; keep the log append-only; compose the draft in `foldLog()`, so the server and page agree; keep the verbatim text whenever a call fails.
- **Ask first:** sending the model anything beyond this question's own speech and its previous draft (that's `context-carryover`); changing Jev; ~~editing `src/plan/admin-setup.json` to add hints;~~ editing `src/plan/admin-setup.json` beyond the tags question's hints; using a model other than `AGENT_MODEL`.
- **Never:** submit an answer on the person's behalf; overwrite what they've typed; let the draft add content that wasn't said; amend commits (add new ones).

## Success criteria

- [ ] With recording on and drafting on, each final utterance said while a text question shows starts a rewrite, and the field shows the new draft once it's logged.
- [ ] Until a draft arrives, and for words said since the last one, the field shows them verbatim, then greyed interim text, as in `text-dictation`.
- [ ] Only one draft call per question is in flight; speech during it is covered by exactly one more call.
- [ ] Drafts follow `draftHints`, keep corrections, treat talk about the draft as instructions, follow the speaker's language, and add nothing that wasn't said, in every `pnpm try-draft` case, read by eye.
- [ ] Once the person changes the field's text, the server makes no more draft calls for it.
- [ ] "Drafting…" shows on the question on screen while its call is in flight, and goes when it ends, whether it worked or failed.
- [ ] A failed call leaves the verbatim text in place.
- [ ] Drafts are `draft` log entries; calls and tokens appear in the cost estimate.
- [ ] `DRAFT_ENABLED=false` gives `text-dictation`'s behaviour, with no draft calls.
- [ ] `draftHints` parses on a text question, and on no other type, reaches the question, appears in both plan schemas, and `pnpm check-plans` passes with the tags question's hints.
- [ ] The new tests pass, and the existing ones still pass.

## Decisions

1. **Verbatim with no LLM:** only through `DRAFT_ENABLED="false"`, for the whole Worker. Per prompt, hints ask for verbatim (decided 2026-10-23).
2. **Field name:** `draftHints` (decided 2026-10-23).
3. **After typing:** the page calls `takeOver`, unlogged, and the server stops drafting that question (decided 2026-10-23).
4. **Showing the work:** a "Drafting…" sign only. The verbatim transcript stays in the transcript drawer (decided 2026-10-23).
5. **Number questions:** out of scope, as in `text-dictation`.
6. **Hints in the admin setup:** the tags question gets `"draftHints": "A comma-separated list of short, lowercase tags, nothing else."` in this slice, so hints can be seen at work (decided 2026-10-23).

## Open questions

- ~~Whether hints should be added to `admin-setup.json`'s tags question in this slice, to see them at work, or wait for `planner` (ask first, per the boundaries).~~ Yes: decision 6.
- Whether a long field (the planner's) needs a cap on how many utterances one call sends. Not for this slice's short fields.
