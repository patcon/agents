# Tasks: voice-drafting

Plan: [`plan.md`](plan.md). Spec: [`design/spec-voice-drafting.md`](../design/spec-voice-drafting.md).

Before every commit: `pnpm test` and `pnpm exec tsc --noEmit` pass.

## Task 1: Text questions can carry `draftHints`, and the tags question has some

**Description:** Add an optional `draftHints` string to the text question's shape in `QuestionSpecSchema`, with a `describe()` that tells the compiler it's prose about how the answer should read (style and length). Add `draftHints?: string` to `Question` in `src/shared.ts`, so the schema drift check passes. Give the admin setup's tags question `"draftHints": "A comma-separated list of short, lowercase tags, nothing else."`. Regenerate the schemas with `pnpm check-plans`.

**Acceptance criteria:**
- [x] A text question with `draftHints` parses, and `questionFor()` gives a question carrying it. A radio, checkbox or number question with `draftHints` doesn't parse.
- [x] Both plan schemas include `draftHints` on text questions only, and `admin-setup.json` checks.

**Verification:**
- [x] `pnpm test`, including new `src/plan/plan.test.ts` cases for the two criteria above
- [x] `pnpm check-plans` passes
- [x] `pnpm exec tsc --noEmit` passes

**Dependencies:** None

**Files likely touched:**
- `src/plan/plan.ts`
- `src/shared.ts`
- `src/plan/plan.test.ts`
- `src/plan/admin-setup.json`
- `src/plan/plan.schema.json`, `src/plan/plan.llm.schema.json` (generated)

**Estimated scope:** Small

## Task 2: Playbooks carry hints as notes, and compiles still match

**Description:** The decompile prompt learns to write a text question's hints as a note, e.g. `[hints: a comma-separated list of short, lowercase tags]`, and the compile prompt learns to turn that note into `draftHints`. Re-decompile to a scratch file to check the prompt writes the note, then add it to the committed playbook by hand, so nothing else in the playbook changes. `compare-plans` reports hints that differ only in wording apart, as it does for prompts, and a missing or extra hint as a difference.

**Acceptance criteria:**
- [x] A fresh decompile of `admin-setup.json` writes the hints note on the tags question.
- [x] `compare-plans` reports a reworded hint as `reworded`, and a missing hint as a difference.
- [x] 10 of 10 compiles of the playbook match the hand-made plan.

**Verification:**
- [x] `pnpm test`, including a `tests/compile.test.ts` case for a reworded hint and one for a missing hint
- [x] `pnpm compile-playbook src/compile/playbooks/admin-setup.decompiled.md --runs 10` then `pnpm compare-plans src/plan/admin-setup.json compiled/*.json` says "all the same"

**Dependencies:** Task 1

**Files likely touched:**
- `src/compile/prompts/decompile-plan.md`
- `src/compile/prompts/compile-playbook.md`
- `src/compile/playbooks/admin-setup.decompiled.md`
- `src/compile/compare-plans.ts`
- `tests/compile.test.ts`

**Estimated scope:** Medium

## Task 3: The draft prompt, `draftRequest()`, `readDraft()` and `pnpm try-draft`

**Description:** Write the system prompt in `src/draft/prompts/draft.md` with the spec's five rules: nothing invented, talk about the draft is an instruction, follow the hints, the speaker's language, corrections win. In `src/draft/draft.ts`, `draftRequest(question, said, previous)` builds the prompt and the response schema `{ draft: string }` from the question's prompt, its hints (saying when there are none), every utterance in order and the previous draft. `readDraft(json)` returns the text, or throws. Write the tests first. `scripts/try-draft.ts` runs the spec's six sample cases against `AGENT_MODEL` at low thinking, through `scripts/gemini.ts`, and prints each draft beside what was said.

**Acceptance criteria:**
- [x] `draftRequest()` includes the prompt, the hints or a line saying there are none, every utterance in order, and the previous draft only when there is one.
- [x] `readDraft()` returns the text, and throws on a missing or non-string `draft`.
- [x] `pnpm try-draft` runs all six cases (ramble with a correction and tag hints; "just write exactly what I said"; "drop the bit about parking"; no hints; Dutch speech with English hints; a ramble that tempts adding detail), or one case by name prefix.

**Verification:**
- [x] `pnpm test`, including the new `src/draft/draft.test.ts`
- [x] `pnpm exec tsc --noEmit` passes
- [x] `pnpm try-draft` output read by eye, by the user at the checkpoint

**Dependencies:** Task 1 (`Question.draftHints`)

**Files likely touched:**
- `src/draft/draft.ts` (new)
- `src/draft/draft.test.ts` (new)
- `src/draft/prompts/draft.md` (new)
- `scripts/try-draft.ts` (new)
- `package.json` (a `try-draft` script)

**Estimated scope:** Medium

## Checkpoint: the prompt

- [x] `pnpm test`, the typecheck and `pnpm check-plans` pass; 10 of 10 compiles match
- [x] The user reads `pnpm try-draft`'s output for every case, and the prompt is changed until they're happy with it

## Task 4: A `draft` log entry, folded into the question's draft

**Description:** Add the `draft` kind to `LogMeta`, the `Draft` type (`text`, `seenUpTo`, `model`) and `draft: Draft` to `LogDataParts`, as the spec has them. In `foldLog()`, keep the latest draft for each question while reading the log. After the loop, a drafted text question's `suggested` becomes the latest draft's text followed by the utterances that count for it after `seenUpTo`, joined by single spaces with empty parts left out, and is left out when empty. Write the spec's seven fold tests first.

**Acceptance criteria:**
- [x] With no draft, `suggested` is what `text-dictation` gives today, and the existing fold tests pass unchanged.
- [x] With drafts, `suggested` follows the spec's seven cases: draft then unseen utterances; just the draft when it saw the last one; the later of two drafts; not another question's draft; nothing with `dictate: false`; nothing when the draft is empty and nothing follows.

**Verification:**
- [x] `pnpm test`, including the seven new cases in `src/shared.test.ts`
- [x] `pnpm exec tsc --noEmit` passes

**Dependencies:** None (it can be built beside tasks 2 and 3)

**Files likely touched:**
- `src/shared.ts`
- `src/shared.test.ts`

**Estimated scope:** Small

## Task 5: The server drafts a text question after each utterance

**Description:** In `ConversationAgent`, after an utterance is appended, `#draftSoon(questionId)` starts a rewrite for the question it counts for, if that question is a text question with dictation on, still open, and drafting is on. `#draft(questionId)` copies `#assess()`'s pattern, with in-flight and again sets keyed by question id. It waits for `#tail`, skips if the latest draft already saw the question's last utterance, calls `generateJson()` with `draftRequest()`, adds the usage to the agent's tally, and appends a `draft` entry (`role: "system"`, a `data-draft` part). A failure is logged to the console and nothing is appended. Import the prompt with `?raw`. Add `DRAFT_ENABLED` to `wrangler.jsonc` (`"true"`), `.env.example` (with a comment like `JEV_ENABLED`'s) and `env.d.ts` (`pnpm types`).

**Acceptance criteria:**
- [ ] With recording on, speaking while the tags question shows logs a `draft` entry after each utterance, and the field shows it, followed by any words said since.
- [ ] Only one call per question is in flight; speech during a call leads to exactly one more call.
- [ ] Calls and tokens show in the log drawer's cost estimate; a failed call leaves the verbatim text; `DRAFT_ENABLED=false` makes no calls.

**Verification:**
- [x] `pnpm test` and `pnpm exec tsc --noEmit` pass
- [ ] By hand with `pnpm run start`: the three criteria above, watching the log drawer for `draft` entries and the call count

**Dependencies:** Tasks 3 and 4

**Files likely touched:**
- `src/server.ts`
- `wrangler.jsonc`
- `.env.example`
- `env.d.ts` (generated)

**Estimated scope:** Medium

## Checkpoint: drafting end to end

- [ ] Tests and typecheck pass
- [ ] By hand: a ramble on the tags question shows verbatim at once, then becomes a tidy tag list; `DRAFT_ENABLED=false` gives plain dictation
- [ ] Review with the user before phase 3, including how the text changing under them feels

## Task 6: Typing in a field stops the server drafting it

**Description:** Add a `takeOver(questionId)` callable that puts the question in an in-memory set, unlogged, which `#draftSoon()` checks. On the page, when a text question's card becomes edited (the `edited` value `QuestionStage` already computes), call `takeOver` once for it.

**Acceptance criteria:**
- [ ] After the person changes a text field's text, further speech logs no more `draft` entries for that question.
- [ ] Clicking into the field and leaving without changing it doesn't stop drafting.

**Verification:**
- [x] `pnpm exec tsc --noEmit` passes
- [ ] By hand: type in the tags field, keep speaking, and see the agent's call count stop rising and no new `draft` entries in the log drawer

**Dependencies:** Task 5

**Files likely touched:**
- `src/server.ts`
- `src/client.tsx`

**Estimated scope:** Small

## Task 7: "Drafting…" shows while a rewrite is in flight

**Description:** Whenever the set of questions with a call in flight changes, the server broadcasts `{ type: "drafting", questionIds }`, unlogged, as `jev-preview` is. The page keeps the latest set and shows a small "Drafting…" sign beside the "Filled in from what was said" badge on the question on screen while it's in the set.

**Acceptance criteria:**
- [ ] The sign shows while a draft call for the question on screen is in flight, and goes when it ends, whether it worked or failed.
- [ ] It doesn't show on a question whose text has been taken over.

**Verification:**
- [ ] `pnpm exec tsc --noEmit` passes
- [ ] By hand: the sign comes and goes as you speak; with the network to Vertex blocked, or a bad model name, it still goes

**Dependencies:** Task 5 (task 6 for the second criterion)

**Files likely touched:**
- `src/server.ts`
- `src/client.tsx`

**Estimated scope:** Small

## Task 8: The README describes drafting

**Description:** Add a paragraph to the README's "Dictation" section: the LLM rewrite after each utterance, `draftHints` and the playbook note, the `draft` log entry and how the fold composes it with the words said since, taking over, the "Drafting…" sign, `DRAFT_ENABLED`, and `pnpm try-draft`. Mention drafting in the intro's summary of what the example does. Mark the spec built and check its success criteria.

**Acceptance criteria:**
- [ ] Someone reading only the README knows what drafting does, how to turn it off, and how to try the prompt.
- [ ] The spec's status says built, with each success criterion checked.

**Verification:**
- [ ] Read through; every file and command it names exists

**Dependencies:** Tasks 1–7

**Files likely touched:**
- `README.md`
- `design/spec-voice-drafting.md`
- `design/capability-map.md` (the status line)

**Estimated scope:** Small

## Checkpoint: complete

- [ ] Every success criterion in the spec is checked
- [ ] This plan and its tasks move to `archived/` as `voice-drafting-plan.md` and `voice-drafting-todo.md`
