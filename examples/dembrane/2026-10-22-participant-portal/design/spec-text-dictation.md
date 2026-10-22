# Spec: dictation into text fields

Status: approved. Module `text-dictation`, the first of three in [`capability-map.md`](capability-map.md); `planner` and `projects` come after, and are out of scope here.

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

Turning it off: a plan prompt can say `"dictate": false`, the same way it can say `"assess": false`. It's carried onto `Question.dictate`. It's on when absent, because a recording session that ignores what you say in a text field would be surprising.

### Live interim text

While someone is still talking, the transcriber's interim text (`voice.interimTranscript`, already shown in the transcript drawer) shows greyed out in the field, after the draft. When the utterance becomes final, it joins the draft in normal text. It's shown only when:

- dictation is on for the question;
- the question is the one on screen (`view.onScreen`), and recording is on;
- the person hasn't edited the card, and it isn't answered.

It never becomes part of the value: it's only shown, and it's never saved or logged. It reaches the card the way Jev's likelihoods do, through card state: `CardInput` takes an `interim` prop and keeps `/interim` in step, and `TextInput` draws it greyed, after the draft. A textarea can't style part of its text, so `TextInput` shows it as a greyed line directly under the text, inside the same bordered box. Custom cards can read `/interim` too.

### Which speech counts

Only utterances said *while the question is on screen* count. Jev reads earlier speech too, but it judges relevance. Raw dictation can't judge relevance, so earlier speech would fill the field with unrelated talk.

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
src/cards/registry.tsx  CardInput keeps /interim in card state; TextInput draws it greyed
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

Then a check by hand with `pnpm run start`: record, open the tags question, speak, and confirm that the interim text shows greyed while speaking, then joins the draft when final; that the field shows the badge, stops changing once edited, and is only saved on Submit. The interim display is client-only and isn't unit-tested.

## Boundaries

- **Always:** run `pnpm test` and the typecheck before each commit; keep the log append-only; derive the draft in `foldLog()`, so the server and page agree.
- **Ask first:** adding a new log entry kind; calling an LLM to tidy dictated text; changing how Jev assesses; editing `src/plan/admin-setup.json`.
- **Never:** submit an answer on the person's behalf; overwrite what they've typed; amend commits (add new ones).

## Success criteria

- [ ] With recording on, final utterances said while a text question shows appear in its field, in order, within the time it takes the utterance to arrive in the log.
- [ ] While someone is speaking, their interim text shows greyed in the field on screen, and is replaced by normal text once final. It's never saved, and doesn't show once the field is edited or answered.
- [ ] The field shows "Filled in from what was said" until the person edits it. After an edit, new speech no longer changes the field.
- [ ] Nothing is saved until the person presses Submit or Skip.
- [ ] Once answered, the field shows the answer, not the dictation.
- [ ] `"dictate": false` on a prompt turns it off for that question; the plan schema accepts the field and `pnpm check-plans` passes.
- [ ] The six fold tests pass, and the existing tests still pass.

## Decisions

1. **Speech after an edit:** once someone types in the field, dictation stops changing it. Adding new speech after their edit is left for the planner slice.
2. **Live interim text:** shown greyed, as above.
3. **Location:** this spec lives in this example's `design/` folder.
