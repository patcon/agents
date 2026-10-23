# Implementation plan: text-dictation

Spec: [`design/spec-text-dictation.md`](../../design/spec-text-dictation.md). Module `text-dictation` in [`design/capability-map.md`](../../design/capability-map.md). Tasks: [`text-dictation-todo.md`](text-dictation-todo.md).

## Overview

What's said while a text question is on screen becomes its draft, and the transcriber's interim text shows greyed in the field while someone is still speaking. The draft is built in `foldLog()` as the question's `suggested` value, which the page already shows as a draft with the "Filled in from what was said" badge, and never submits. The interim text is only shown on the page.

Baseline before starting: `pnpm test` passes 12 tests, and `pnpm exec tsc --noEmit` reports no errors.

## Architecture decisions

- **Reuse `QuestionView.suggested`** rather than adding a separate dictation field. The page's draft, badge, stop-on-edit and submit logic all key off it already, so task 1 is usable end to end without touching the client.
- **Build the draft after the fold's loop**, from `view.utterances` and their `onScreen`, rather than inside the loop. Utterances already carry `onScreen`, and it keeps the Jev branch untouched.
- **`Question.dictate` is carried the same way as `assess`**: optional on the plan prompt's payload, copied by `questionFor()`, on when absent.
- **Interim text goes through card state at `/interim`**, as Jev's likelihoods go through `/likelihood`. `QuestionStage` decides whether to pass it, since it alone knows whether the card has been edited.
- **Tests sit beside the file they test**: `src/shared.test.ts`, `src/plan/plan.test.ts`. Vitest's `include` gains `src/**/*.test.ts`. `tests/compile.test.ts` stays put.

## Dependency graph

```
Question.dictate (shared.ts)
    ├── foldLog() dictation draft (shared.ts) ──→ page shows it via `suggested` (no change)
    │       └── interim text in the card (registry.tsx, cards.ts, client.tsx)
    └── `dictate` on plan prompts (plan.ts, generated schemas)
README "Dictation" section: after all of the above
```

## Task list

### Phase 1: the draft

- [x] Task 1: Text questions get a draft from what was said while they showed
- [x] Task 2: Plan prompts can turn dictation off with `"dictate": false`

### Checkpoint: the draft

- [x] `pnpm test` and `pnpm exec tsc --noEmit` pass; `pnpm check-plans` passes
- [x] By hand: speaking while the tags question is on screen fills its field, with the badge
- [x] Review with the user before phase 2

### Phase 2: interim text and docs

- [x] Task 3: Interim text shows greyed in the text field on screen
- [x] Task 3a: A display layer shows the draft with interim text inline (replaces task 3's line under the text)
- [x] Task 3b: Pressing the display swaps in the textarea, caret where pressed
- [x] Task 4: The README describes dictation

### Checkpoint: complete

- [x] Every success criterion in the spec is met
- [x] Review with the user

## Risks and mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| A text question is answered or skipped, then revisited: what shows? | Low | Today's page logic: an answer shows over `suggested`; a skipped question shows `suggested` as its value but without the badge, since it has an answer entry. That matches Jev's behaviour, so no change; the hand check confirms it. |
| Two devices with different questions showing: `view.onScreen` is whichever moved last | Low | Same limitation Jev has today; out of scope. The interim text uses the same `onScreen`, so the field and the draft agree. |
| The interim text and the final utterance both show for a moment | Low | The transcriber clears interim text when it sends the final; check by hand that there's no visible doubling. |
| Gemini's compile starts emitting `dictate` because it appears in the LLM schema | Low | The field is optional and on by default; `tests/compile.test.ts` and the 10-of-10 comparison don't depend on it. Re-run `pnpm test`. |

## Open questions

None. The spec's three open questions were decided on 2026-10-22.
