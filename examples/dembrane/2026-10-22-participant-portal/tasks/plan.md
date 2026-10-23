# Implementation plan: voice-drafting

Spec: [`design/spec-voice-drafting.md`](../design/spec-voice-drafting.md). Module `voice-drafting`, slice 1.1 in [`design/capability-map.md`](../design/capability-map.md). Tasks: [`todo.md`](todo.md). Finished plans are kept in [`archived/`](archived/).

## Overview

After each utterance, an LLM rewrites a text question's draft from everything said while it showed, following the question's `draftHints` and the speaker's own asks. Each rewrite is logged as a `draft` entry. `foldLog()` shows the latest draft followed, word for word, by what's been said since, so words still appear the moment they're said. Typing in the field stops drafting it, and a "Drafting…" sign shows while a rewrite is being written.

Baseline before starting: `pnpm test` passes 33 tests, `pnpm exec tsc --noEmit` reports no errors, and 10 of 10 compiles of the admin setup's playbook match the hand-made plan.

## Architecture decisions

- **The prompt first.** Whether the drafts read well is the biggest unknown, and it needs no server, log or page. `src/draft/draft.ts` builds the request and reads the answer as pure functions, as `src/models/jev.ts` does, so `pnpm try-draft` can run sample rambles past the real prompt before anything is wired up.
- **`draftHints` lives on the text question's shape**, beside `length` and `dictate`, now that plan questions have a shape per type. `questionFor()` already passes the question through, so nothing else changes there.
- **Hints go through playbooks as notes**, like `[short answer]`, so the compiler stays checked against the hand-made plan. `compare-plans` reports differently worded hints apart from real differences, as it does for prompts, since hints are prose.
- **The fold composes; the server only schedules and logs.** The server never writes `suggested`. It appends `draft` entries, and every device folds the same result.
- **Drafting copies `#assess()`'s scheduling, one question at a time.** There are in-flight and again sets keyed by question id, instead of Jev's single flags, so two questions can be drafted at once without one holding up the other.
- **`takeOver` and the "Drafting…" sign are unlogged**, as `jev-preview` is. Both are about calls in flight, not about what anyone said or answered.

## Dependency graph

```
draftHints on text questions (plan.ts, shared.ts)
    ├── hints in playbooks (prompts, playbook, compare-plans)
    └── draftRequest() / readDraft() + prompt + try-draft (src/draft/)
            │
`draft` entry + fold (shared.ts) ─┤
            │
            └── server drafting loop (server.ts, DRAFT_ENABLED)
                    ├── takeOver (server.ts, client.tsx)
                    └── "Drafting…" broadcast and sign (server.ts, client.tsx)
README: after all of the above
```

The fold (task 4) depends on nothing but `shared.ts`, so it can be built beside tasks 2 and 3.

## Task list

### Phase 1: hints and the prompt

- [ ] Task 1: Text questions can carry `draftHints`, and the tags question has some
- [ ] Task 2: Playbooks carry hints as notes, and compiles still match
- [ ] Task 3: The draft prompt, `draftRequest()`, `readDraft()` and `pnpm try-draft`

### Checkpoint: the prompt

- [ ] `pnpm test`, the typecheck and `pnpm check-plans` pass; 10 of 10 compiles match
- [ ] The user reads `pnpm try-draft`'s output for every case, and the prompt is changed until they're happy with it

### Phase 2: drafts in the session

- [ ] Task 4: A `draft` log entry, folded into the question's draft
- [ ] Task 5: The server drafts a text question after each utterance

### Checkpoint: drafting end to end

- [ ] Tests and typecheck pass
- [ ] By hand: a ramble on the tags question shows verbatim at once, then becomes a tidy tag list; `DRAFT_ENABLED=false` gives plain dictation
- [ ] Review with the user before phase 3

### Phase 3: taking over, showing the work, docs

- [ ] Task 6: Typing in a field stops the server drafting it
- [ ] Task 7: "Drafting…" shows while a rewrite is in flight
- [ ] Task 8: The README describes drafting

### Checkpoint: complete

- [ ] Every success criterion in the spec is checked
- [ ] This plan and its tasks move to `archived/` as `voice-drafting-plan.md` and `voice-drafting-todo.md`

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Drafts add things that weren't said, or write instructions ("shorter") into the text | High | Task 3 comes first and is read by eye against cases written to tempt exactly that; the checkpoint waits on the user. A Jev check of draft against transcript is noted in the spec as later. |
| Text jumps as a draft replaces the verbatim words someone is reading | Med | It's inherent in the design; check it by hand at the phase 2 checkpoint. If it's bad, a short pause before drafting (as Jev waits after a question arrives) batches utterances, at the cost of a slower draft. |
| A call per utterance costs more than expected on long answers | Med | The cost estimate shows it from task 5 on; `DRAFT_ENABLED=false` turns it off. The spec's open question on capping what a long field sends is left for `planner`. |
| A slow draft arrives after the person has typed or submitted | Low | The fold already ignores drafts once a question is answered, and the page ignores new drafts once the text is theirs, as it ignores new speech today. |
| Hints change how the compiler reads playbooks, and compiles stop matching | Low | Task 2 reruns the 10 compiles, as was done for `[short answer]`. |
| The in-memory taken-over set is lost on a Durable Object restart | Low | A few more drafts may be logged and the page ignores them; the spec accepts this. |

## Open questions

- None blocking. The spec's open question on long fields (capping what one call sends) waits for `planner`.
