# Spec: dictation into text fields

Status: ~~approved~~ built, and checked by hand on 2026-10-22. Module `text-dictation`, the first of three in [`capability-map.md`](capability-map.md); `planner` and `projects` come after, and are out of scope here.

## Objective

While recording, what someone says while a text question is on screen is written into that question's field as a draft. They can edit it, and they still submit it themselves: dictated text is never submitted for them.

This is the building block the planner needs. A planner is one long text field the host talks into, and that text is then compiled. It's also useful on its own: the admin setup's `tags` question is a text question today, and nothing fills it in.

Who it's for: whoever is answering, host or participant. Success means that saying "tags should be housing, transport and parks" while the tags question is showing leaves that sentence in the field, marked "Filled in from what was said", ready to edit and submit.

## How it works

No new log entries. Everything is derived from what the log already holds:

- `utterance` entries, each already tagged by `foldLog()` with `onScreen`, the question on screen when it was said.
- `answer` entries, which already stop a draft from showing once a question is answered.

`foldLog()` gives each open text question whose dictation is on a `suggested` value: the text of every utterance said while it was on screen, in log order, joined by single spaces. When nothing has been said, `suggested` is left out. The page already treats `suggested` as the draft until the person edits the card, and shows the "Filled in from what was said" badge while it does. Text questions get that for free.

| Question                         | Gets dictation? |
| -------------------------------- | --------------- |
| `type: "text"`                   | Yes, unless `dictate: false` |
| radio, checkbox                  | No. Jev already fills these in |
| number                           | No. A number from raw speech needs parsing, which is out of scope |
| consent                          | No (it's a checkbox) |
| from the plan, host, or agent    | All the same: it depends only on the question |

Turning it off: a plan prompt can say `"dictate": false`, the same way it can say `"assess": false`. (Since 2026-10-23, both go on the question itself, `dictate` on text and `assess` on choices, as questions have a shape per type.) It's carried onto `Question.dictate`. It's on when absent, because a recording session that ignores what you say in a text field would be surprising.

### Live interim text

While someone is still talking, the transcriber's interim text (`voice.interimTranscript`, already shown in the transcript drawer) shows greyed out in the field, after the draft. When the utterance becomes final, it joins the draft in normal text. It's shown only when:

- dictation is on for the question;
- the question is the one on screen (`view.onScreen`), and recording is on;
- the person hasn't ~~edited the card~~ ~~taken over the field (clicked or tabbed into it, below)~~ changed the field's text, and it isn't answered (a skip doesn't count as an answer).

~~It never becomes part of the value: it's only shown, and it's never saved or logged.~~ It isn't part of the draft, and isn't logged as an utterance until it's final. But Submit saves what's on screen: pressed mid-sentence, the greyed words are saved with the draft as they stand (decided 2026-10-22, after Submit was found to drop them). It reaches the card the way Jev's likelihoods do, through card state: `CardInput` takes an `interim` prop and keeps `/interim` in step, and `TextInput` draws it greyed, after the draft. ~~A textarea can't style part of its text, so `TextInput` shows it as a greyed line directly under the text, inside the same bordered box.~~ A textarea can't style part of its text, so while dictation fills the field, `TextInput` shows it in a display layer instead (below), with the interim text greyed inline right after the last word. Custom cards can read `/interim` too.

### The display layer, and taking over the field

Added after trying a greyed line under the text: it looked poor, and the field's height jumped.

- **Two layers in one box.** `TextInput` stacks a display `<div>` over the real `<textarea>` in one grid cell. The div shows while dictation fills the field; the textarea is always mounted underneath.
- **Identical text layout.** Both share the box's height, font, padding, line height and wrapping (`pre-wrap`, `break-word`), and `scrollbar-gutter: stable`, so swapping one for the other moves no text. The div keeps a trailing line break the way a textarea does.
- **Taller, fixed height.** About 8 lines, scrolling inside, for every text field. A fixed height means nothing jumps as text arrives. ~~A `rows` prop can come with the planner.~~ `TextInput` has a `length` prop instead (added 2026-10-23): `"short"` is a single-line input, which the portal title's card uses, and `"long"`, the default, is this field.
- **Follows new text.** If the div was scrolled to the bottom, it stays at the bottom as text arrives; if the person scrolled up, it stays where they are.
- **Looks editable.** `cursor: text` over the div.
- **~~Taking over~~ Swapping in the textarea.** Pressing on the div, or tabbing to it, swaps in the textarea in the same event: the scroll position carries over, the textarea is focused, and the caret goes where they pressed (from `document.caretPositionFromPoint`, falling back to `caretRangeFromPoint`; a press on the interim text puts it at the end of the draft; tabbing puts it at the end). Focusing within the event keeps a phone's keyboard opening.
- ~~**Taking over stops dictation**, as an edit did: the draft becomes theirs, the badge goes, and new speech no longer changes the field. It stays a textarea if they click away without typing.~~
- **Only changing the text stops dictation** (decided 2026-10-22, after trying clicks as takeovers). While the textarea has focus and they haven't typed, dictation keeps adding to it, their caret and scroll position stay put, and the badge stays; ~~interim text isn't shown there~~ interim text is in the textarea as plain text after the draft, and the final words replace it when they arrive. If they type first, it's theirs as it stands. A press on the greyed interim text puts the caret within it. If they leave without changing the text, the display comes back. Once they change it, the draft is theirs: the badge goes, new speech no longer changes it, and it stays a textarea.

Turning a press into a character offset is a small pure function, unit-tested; the rest is checked by hand.

### Which speech counts

Only utterances said *while the question is on screen* count. An utterance counts for the question on screen when it was *started* (decided 2026-10-22): the server notes the question at its first interim text and saves it on the utterance's log entry as `onScreen`, and `foldLog()` uses that when it's there. So pressing Submit or Skip mid-sentence doesn't hand the end of the sentence to the next question, and the page shows that sentence's interim text only on the question it started on. Jev reads the same tagging. Jev reads earlier speech too, but it judges relevance. Raw dictation can't judge relevance, so earlier speech would fill the field with unrelated talk.

## Commands

```bash
pnpm install
pnpm test                  # vitest: tests/**/*.test.ts and src/**/*.test.ts
pnpm exec tsc --noEmit     # typecheck (no script for it yet)
pnpm run start             # vite dev, for checking it by hand
pnpm check-plans           # admin-setup.json still lints against the schema
```

## Project structure (what this slice touches)

```
src/shared.ts         Question.dictate, and foldLog() fills `suggested` for text questions
src/plan/plan.ts      `dictate` on the prompt payload; questionFor() carries it over
src/plan/plan.schema.json, plan.llm.schema.json   regenerated if they're generated from the Zod schemas
src/client.tsx        passes the interim text to the card on screen
src/cards/registry.tsx  CardInput keeps /interim in card state; TextInput's display layer and swap to the textarea
src/cards/caret.ts    new: a press point's character offset in the draft, and its test beside it
src/cards/cards.ts    documents /interim beside /likelihood
src/shared.test.ts    new: foldLog() dictation cases, beside the file it tests
vitest.config.ts      `include` gains src/**/*.test.ts
README.md             a short "Dictation" subsection next to "Jev"
design/spec-text-dictation.md   this file
```

## Code style

Follow `src/shared.ts`: plain functions, comments that say why, types beside the code that uses them. The draft is built in the fold, like the Jev suggestion is:

```ts
// After the loop: a text question's draft is what was said while it showed.
for (const entry of view.questions) {
  const { question } = entry;
  if (question.type !== "text" || question.dictate === false) continue;
  const said = view.utterances.filter((u) => u.onScreen === question.id);
  if (said.length) entry.suggested = said.map((u) => u.text).join(" ");
}
```

The `suggested` doc comment becomes "What was said fills into the draft, if anything: Jev's picks for options, the words themselves for text."

## Testing strategy

Tests live beside the file they test: `src/shared.ts` → `src/shared.test.ts`. The existing `tests/compile.test.ts` stays where it is in this slice; moving it is a separate change.

Unit tests on `foldLog()` in `src/shared.test.ts`, with hand-built logs; no model calls:

1. Utterances said while a text question is showing become its `suggested`, joined in order.
2. Utterances said before it was shown, or while another question was showing, are left out.
3. Shown, then away, then shown again: both stretches count, in order.
4. `dictate: false` gives no `suggested`.
5. Radio, checkbox and number questions get no dictated `suggested` (Jev's still works on options).
6. No utterances while showing: no `suggested`.

Then a check by hand with `pnpm run start`: record, open the tags question, speak, and confirm that the interim text shows greyed while speaking, then joins the draft when final; that the field shows the badge, stops changing once ~~edited~~ ~~taken over~~ its text is changed, and is only saved on Submit; that pressing anywhere in the field swaps to a textarea with no text moving and the caret where pressed; and that leaving it unchanged brings the display back. The interim display is client-only and isn't unit-tested.

## Boundaries

- **Always:** run `pnpm test` and the typecheck before each commit; keep the log append-only; derive the draft in `foldLog()`, so the server and page agree.
- **Ask first:** adding a new log entry kind; calling an LLM to tidy dictated text; changing how Jev assesses; editing `src/plan/admin-setup.json`.
- **Never:** submit an answer on the person's behalf; overwrite what they've typed; amend commits (add new ones).

## Success criteria

- [x] With recording on, final utterances said while a text question shows appear in its field, in order, within the time it takes the utterance to arrive in the log.
- [x] While someone is speaking, their interim text shows greyed ~~in the field~~ inline after the draft in the field on screen, and is replaced by normal text once final. ~~It's never saved~~ Submit saves it as it stands, and it doesn't show once the field's text is changed ~~taken over~~, while the textarea has focus, or once it's answered.
- [x] Text fields are about 8 lines tall, and don't change height as text arrives or speech starts and stops. The display follows new text unless the person has scrolled up.
- [x] Pressing the field swaps in a textarea with no text moving, focused, with the caret where they pressed; tabbing to it puts the caret at the end.
- [x] The field shows "Filled in from what was said" until the person ~~edits it~~ ~~takes it over~~ changes its text. After ~~an edit~~ that, new speech no longer changes the field; clicking in and out without changing it doesn't count.
- [x] Nothing is saved until the person presses Submit or Skip.
- [x] Once answered, the field shows the answer, not the dictation.
- [x] `"dictate": false` on a prompt turns it off for that question; the plan schema accepts the field and `pnpm check-plans` passes.
- [x] The six fold tests pass, and the existing tests still pass.

## Decisions

1. **Speech after an edit:** once someone ~~types in~~ ~~takes over~~ changes the text in the field, dictation stops changing it. Adding new speech after their edit is left for the planner slice.
2. **Live interim text:** shown greyed, ~~as above~~ inline after the draft, in a display layer that turns into the textarea when pressed (decided 2026-10-22, after trying a line under the text).
3. **Location:** this spec lives in this example's `design/` folder.
