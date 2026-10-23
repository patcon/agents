# Tasks: text-dictation

Plan: [`text-dictation-plan.md`](text-dictation-plan.md). Spec: [`design/spec-text-dictation.md`](../../design/spec-text-dictation.md).

Before every commit: `pnpm test` and `pnpm exec tsc --noEmit` pass.

## Task 1: Text questions get a draft from what was said while they showed

**Description:** Add `dictate?: boolean` to `Question`. After `foldLog()`'s loop, give each text question with dictation on a `suggested` value: the utterances said while it was on screen, in order, joined by single spaces. Update `suggested`'s doc comment. Write the tests first, in a new `src/shared.test.ts`, and widen Vitest's `include` to find it.

**Acceptance criteria:**
- [x] Utterances said while a text question shows become its `suggested`, in order; those said before it showed, or while another question showed, don't count; two separate stretches on screen both count.
- [x] `dictate: false`, or no utterances while showing, gives no `suggested`; radio, checkbox and number questions get no dictated `suggested`, and Jev's suggestions are unchanged.
- [x] With recording on, speaking while the tags question shows fills its field with the "Filled in from what was said" badge, and nothing is saved until Submit.

**Verification:**
- [x] `pnpm test`: the 7 new fold tests and the 12 existing ones pass
- [x] `pnpm exec tsc --noEmit` passes
- [x] By hand with `pnpm run start`: the tags question fills as you speak, stops changing once edited, and shows the answer once submitted

**Dependencies:** None

**Files likely touched:**
- `src/shared.ts`
- `src/shared.test.ts` (new)
- `vitest.config.ts`

**Estimated scope:** Small

## Task 2: Plan prompts can turn dictation off with `"dictate": false`

**Description:** Add an optional `dictate` boolean to the prompt payload in `src/plan/plan.ts`, described like `assess`, and have `questionFor()` carry it onto the question. Regenerate the JSON schemas with `pnpm check-plans`.

**Acceptance criteria:**
- [x] A prompt with `"dictate": false` parses, and `questionFor()` gives a question with `dictate: false`; without it, `dictate` is unset, as `assess` is.
- [x] `src/plan/plan.schema.json` and `src/plan/plan.llm.schema.json` include `dictate`, and `admin-setup.json` still checks.

**Verification:**
- [x] `pnpm test`, including a new `src/plan/plan.test.ts` for the two `questionFor()` cases
- [x] `pnpm check-plans` passes
- [x] `pnpm exec tsc --noEmit` passes

**Dependencies:** Task 1 (`Question.dictate`)

**Files likely touched:**
- `src/plan/plan.ts`
- `src/plan/plan.test.ts` (new)
- `src/plan/plan.schema.json`, `src/plan/plan.llm.schema.json` (generated)

**Estimated scope:** Small

## Checkpoint: the draft

- [x] Tests, typecheck and `pnpm check-plans` pass
- [x] Hand check from task 1 done
- [x] Review with the user before phase 2

## Task 3: Interim text shows greyed in the text field on screen

**Description:** `App` passes `voice.interimTranscript` to `QuestionStage`. `QuestionStage` passes it on to `CardInput` as `interim` only when the question has dictation on, is text, is `view.onScreen`, recording is on, it's unanswered, and the card hasn't been edited. `CardInput` keeps `/interim` in card state, as it does `/likelihood`. `TextInput` draws it as a greyed line directly under the text, inside the same bordered box. `cards.ts` documents `/interim` beside `/likelihood`.

**Acceptance criteria:**
- [x] While someone speaks with a text question on screen, the interim text shows greyed ~~under the draft~~ inline after the draft (task 3a), and is gone once the utterance is final and has joined the draft.
- [x] It doesn't show once the field has been edited, once the question is answered, for `dictate: false`, or for non-text questions.
- [x] ~~It's never part of the value: submitting mid-sentence saves only the draft.~~ Submitting mid-sentence saves the draft with the greyed words as they stand.

**Verification:**
- [x] `pnpm exec tsc --noEmit` and `pnpm test` pass
- [x] By hand with `pnpm run start`: each criterion above, and no visible doubling when interim text turns final

**Dependencies:** Task 1

**Files likely touched:**
- `src/client.tsx`
- `src/cards/registry.tsx`
- `src/cards/cards.ts`

**Estimated scope:** Medium

## Task 3a: A display layer shows the draft with interim text inline

**Description:** Replaces task 3's wrapper box and greyed line under the text (`70e9714b`, `819959c1`). `TextInput` stacks a display `<div>` over the real `<textarea>` in one grid cell, with identical height (about 8 lines), font, padding, line height, wrapping and `scrollbar-gutter: stable`. While dictation fills the field, the div shows the draft followed by the interim text, greyed, inline; `cursor: text`. It follows new text while scrolled to the bottom. The page tells the card whether dictation is filling it (`/dictating` in card state), since only the page knows whether its text has been changed.

**Acceptance criteria:**
- [x] While dictating, the interim text shows greyed right after the last word, and the field's height never changes.
- [x] New text keeps the display scrolled to the bottom, unless the person scrolled up.
- [x] Without dictation (off, answered, or its text changed), the field is a plain textarea of the same height.

**Verification:**
- [x] `pnpm exec tsc --noEmit` and `pnpm test` pass
- [x] By hand: the criteria above, with a long enough dictation to pass the fold

**Dependencies:** Task 3

**Files likely touched:**
- `src/cards/registry.tsx`
- `src/client.tsx`
- `src/cards/cards.ts`

**Estimated scope:** Medium

## Task 3b: Pressing the display swaps in the textarea, caret where pressed

**Description:** On pointer-down on the display, or focus by Tab, `TextInput` hides the div and focuses the textarea in the same event, carrying over the scroll position and placing the caret: where pressed (`caretPositionFromPoint`, falling back to `caretRangeFromPoint`), at the end of the draft for a press on the interim text, at the end for Tab. ~~Taking over stops dictation for the field, as an edit did: the page records the draft as theirs.~~ Only changing the text stops dictation; while focused and unchanged, dictation keeps adding with the caret and scroll kept, and leaving brings the display back. Turning the caret result into an offset is a pure function in `src/cards/caret.ts`, tested beside it.

**Acceptance criteria:**
- [x] Pressing anywhere in the display gives a focused textarea with no text moving, the caret where pressed.
- [x] ~~After taking over, the badge goes, new speech doesn't change the field, and it stays a textarea after clicking away.~~ Clicking in and out without typing keeps the badge and brings the display back; while focused, new speech is added without moving the caret. After typing, the badge goes, new speech doesn't change the field, and it stays a textarea.
- [x] Tab into the field gives a focused textarea with the caret at the end.

**Verification:**
- [x] `pnpm test`, including `src/cards/caret.test.ts`
- [x] `pnpm exec tsc --noEmit` passes
- [x] By hand: the criteria above, on desktop, and on a phone if one's handy (the keyboard should open)

**Dependencies:** Task 3a

**Files likely touched:**
- `src/cards/registry.tsx`
- `src/cards/caret.ts`, `src/cards/caret.test.ts` (new)
- `src/client.tsx`

**Estimated scope:** Medium

## Task 4: The README describes dictation

**Description:** Add a short "Dictation" subsection after "Jev" in `README.md`: what fills a text field and when, the interim text, `"dictate": false`, and that nothing is submitted for the person. Note that tests now also live beside their source.

**Acceptance criteria:**
- [x] The section matches what was built, and links the spec.

**Verification:**
- [x] Read it against the code once tasks 1 to 3b are in

**Dependencies:** Tasks 1, 2, 3, 3a, 3b

**Files likely touched:**
- `README.md`

**Estimated scope:** XS

## Checkpoint: complete

- [x] Every success criterion in `design/spec-text-dictation.md` is met
- [x] Review with the user
