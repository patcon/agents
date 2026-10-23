# 2026-10-23-new-feature

A continuous voice session that walks a host through setting up their project's portal. The setup questions come from a plan compiled from a playbook (`src/shared/plan/admin-setup.json`); more can come on demand from the host and from an agent. Everything is stored as an append-only `UIMessage` log in one Durable Object.

A copy of [`2026-10-23-dembrane-theme`](../2026-10-23-dembrane-theme), itself a copy of [`2026-10-22-voice-drafting`](../2026-10-22-voice-drafting) in Dembrane's theme. Like those, it compiles its plan from a markdown playbook with Gemini, and checks the result against the hand-made plan (see [Playbooks](#playbooks-srcsharedcompilecompilets)). The running session still uses the hand-made plan. Like `2026-10-22-jev`, it has [Jev](https://docs.typesafe.ai), TypeSafe's System One model, listen along: every card with options shows how likely each option is to be what the speaker chose, and fills in the likely ones. Text questions are filled in by [dictation](#dictation-srcclientcardsregistrytsx): what's said while one is showing becomes its draft, and an LLM [rewrites that draft](#drafting-srcserverdraftdraftts) into what was meant, the way the field asks for.

## Run it

```bash
cp .env.example .env   # then set GOOGLE_CLOUD_PROJECT, and TYPESAFE_API_KEY for Jev
pnpm install
pnpm google-token      # writes a fresh GOOGLE_ACCESS_TOKEN to .env (lasts about an hour)
                       # or: pnpm google-key key.json, for a service account key that doesn't expire
pnpm run start
```

Transcription and the agent's question both use Gemini on Vertex AI, so you need a Google Cloud project with Vertex AI enabled and `gcloud` signed in. Deploys use a JSON key for a service account with `roles/aiplatform.user` instead, as `GOOGLE_SERVICE_ACCOUNT_KEY`: the Worker trades it for access tokens with `serviceAccountToken`, and fetches a new one before each expires. Transcription streams to `gemini-3.5-transcribe-live-preview` through `VertexLiveSTT` from [`@dembrane/voice-google`](../packages/voice-google); the agent's question comes from `gemini-3.8-flash`, and so do compiled plans. Drafts of text answers come from `gemini-3.5-flash`. The models are set in `wrangler.jsonc`.

## How it works

### The log

Every event is a new `UIMessage` with its own id. Nothing is edited in place. `metadata.subjectId` names the logical thing an entry is about, so answering a question twice appends two `answer` entries for the same subject, and the last one wins:

```ts
type LogMeta =
  | { kind: "utterance"; subjectId: string; at: number; onScreen?: string | null }
  | { kind: "question"; subjectId: string; at: number }
  | { kind: "answer"; subjectId: string; at: number }
  | { kind: "trigger"; subjectId: string; at: number }
  | { kind: "status"; subjectId: "session"; at: number };
```

`foldLog()` in `src/shared/index.ts` turns the log into current state. The client renders it, and the server feeds the same view to the model.

### Server (`src/server/`)

`ConversationAgent` is `withVoiceInput(AIChatAgent)`. Each source of events appends to the log with `persistMessages()`, which writes without starting a model turn:

| Source | How it appends                                                 |
| ------ | -------------------------------------------------------------- |
| Voice  | `onTranscript()` appends an `utterance`                        |
| Plan   | `open()` and `answer()` append the questions the plan releases |
| Host   | `@callable() pushHostQuestion()`                               |
| Person | `@callable() answer(questionId, value, skipped)`               |
| Drafting | `#draft()` appends a `draft` after an utterance on a text question |

The agent is woken without a human message: a `trigger` entry is appended with `saveMessages()`, which runs `onChatMessage()`. That asks Gemini (`src/server/models/gemini.ts`) for a question in the same shape as a plan's (`questionLlmSchema()` in `src/shared/plan/plan.ts`), checks it with Zod, appends it, and replies with a short assistant message saying what it asked. The trigger stays in the log, so it's clear why the turn ran.

```ts
await this.saveMessages((messages) => [...messages, triggerEntry]);
```

Consent comes before recording. The page calls `open()` as soon as it connects, which starts the plan and puts up the consent card, while nothing is recorded yet. `foldLog()` derives `consented` from the card's latest answer: true only when every option is ticked. There's no separate entry for it. Start stays disabled, and `begin()` and `setPaused(false)` refuse, until it's true. The plan's sections wait on it too, with a `consented` trigger condition. The card is required, so the only answer it takes is the tick, and it's `final`: once answered, `answer()` won't revise it and the page shows it read-only. Consent isn't taken back; that would mean deleting the session's data, which isn't built. The consent card is never assessed by Jev, since it has to be ticked by hand.

### Client (`src/client/`)

`useAgentChat` keeps the log in sync; `useVoiceInput` streams the microphone to the same agent instance. The page shows one question at a time with Back / Next. Each question's input is a [json-render](https://github.com/vercel-labs/json-render) card: a plan can give a prompt its own `card` (the language question lays its options out in two columns), and any question without one gets a default for its type. `src/shared/cards/cards.ts` holds the catalog of components a card can use and the platform's own cards, like consent, which a plan can place but not change; `src/client/cards/registry.tsx` draws them. New questions stack behind the current one and show as a count on Next. The transcript and the raw message log live in drawers. The log drawer also estimates what the session has cost so far, at today's prices and at any announced change, from the audio seconds streamed and the tokens Gemini reports. The tally lives in the agent's state, not the log. `pnpm update-prices` rewrites `src/shared/models/prices.json` for the models in `wrangler.jsonc`, taking today's Vertex AI rate from [LiteLLM](https://models.litellm.ai) and announced changes from [pydantic/genai-prices](https://github.com/pydantic/genai-prices).

### Jev (`src/shared/models/jev.ts`)

Jev is on whenever `TYPESAFE_API_KEY` is set. `JEV_ENABLED=false` turns it off with the key still set.

As soon as an utterance arrives, or 100 ms after a question does, the server asks Jev about every unanswered question whose card presents options (radio and checkbox; a skipped question counts as unanswered), in one request over the last 40 utterances. Only one request is in flight; whatever arrives meanwhile is covered by one more after it.

| Card     | What Jev is asked                                                                              | An option's likelihood |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| radio    | `pick`, a Choice over the options, and `stated`, a Noul: has the speaker answered this at all? | `pick × stated`        |
| checkbox | A Noul per option: has the speaker said this one applies?                                      | That Noul              |

The page calls `show(questionId)` whenever a question comes on screen, which appends a `shown` entry. Each utterance in Jev's state says which question was on screen when it was said, and Jev is told those lines answer that question directly, while anything said before it appeared counts only if it clearly settles it. Questions arrive filled in from what was said earlier, but what's said while a question is showing counts for more. In what Jev is sent, question marks in the transcript become periods: a transcribed "Basic?" is usually an answer said with a rising voice, which Jev otherwise reads as doubt. The log keeps what the transcriber wrote.

Each run appends an `assessment` entry with Jev's raw probabilities, the model version, the last utterance it saw, the question on screen, and for each question the utterances said while it was showing (`heardOnScreen`). `foldLog()` turns the latest one into a `likelihood` per option and a `suggested` answer, so thresholds can change without calling Jev again. An option is filled in at 80% and stays filled until it drops below 30% (`AUTO_SELECT` in `src/shared/index.ts`).

While someone's still speaking, the transcriber's interim text drives previews. Each one asks Jev about the question on screen only, over the last 10 utterances plus the interim text: about 570 tokens instead of a full run's 4,000 or so. One is in flight at a time, and the next takes the latest text. A preview isn't logged. It's broadcast to clients as a `jev-preview` message, and its likelihoods replace the logged ones on that card until an assessment sees past the utterance it came after. Previews move the bars but fill nothing in; that waits for the utterance and its full run.

On the page, each option has a bar behind it as wide as its likelihood, which grows from zero when Jev's first likelihood arrives. Below the auto-select threshold it's dim and blurred; above it, crisp. Cards read the likelihoods from `/likelihood` in their state, so custom cards get bars too. Until someone touches a card, an unanswered question shows Jev's suggestion as its draft, with a "Filled in from what was said" badge; it's never submitted for them. A plan can turn Jev off for a radio or checkbox question with `"assess": false`.

The model is pinned in `wrangler.jsonc` (`jev-1.13.0`), and Jev's input tokens show in the log drawer's cost estimate ($0.042 per million; output is free).

`pnpm try-jev` runs short Dutch and English transcripts past Jev with every option question in the admin setup plan, and prints the likelihoods: `pnpm try-jev nl` for just the Dutch ones, `JEV_MODEL=jev-1.14.0 pnpm try-jev` to try another model.

### Dictation (`src/client/cards/registry.tsx`)

What's said while a text question is on screen is written into its field as a draft. It's never submitted for the person: they edit it, and press Submit. Spec: [`2026-10-22-voice-drafting/design/spec-text-dictation.md`](../2026-10-22-voice-drafting/design/spec-text-dictation.md).

The draft is built in `foldLog()`: a text question's `suggested` is every utterance said while it was on screen, in order, joined by spaces. The page already shows `suggested` as the draft with the "Filled in from what was said" badge, so nothing new is logged. A plan's text question can turn it off with `"dictate": false`, as a choice can turn Jev off with `"assess": false`. A skipped question counts as unanswered, for dictation and Jev both (`isOpen()` in `src/shared/index.ts`).

An utterance counts for the question on screen when it was started, not when it was finished. The server notes the question at its first interim text, and saves it on the utterance's log entry as `onScreen`. So pressing Submit or Skip mid-sentence doesn't hand the end of the sentence to the next question.

On the page, `TextInput` draws the field in two layers in one box. While dictation fills it, a display layer shows the draft with the transcriber's interim text greyed inline after it, and follows new text down unless the person has scrolled up. Pressing it swaps in the real textarea underneath within the same event, with the caret where they pressed (`src/client/cards/caret.ts`, using `document.caretPositionFromPoint`) and the scroll position kept. Both layers lay text out identically (`FIELD_TEXT`), so nothing moves. Fields are a fixed height, so they don't jump as text arrives: eight lines for long text, the default. A text question with `"length": "short"`, like the portal title, gets a single-line input instead, where the display follows new text sideways. A plan's question has one shape per type (`QuestionSpecSchema` in `src/shared/plan/plan.ts`), so `options` and `assess` only go on choices, `length`, `dictate` and `draftHints` on text, and `min` and `max` on numbers.

| While the textarea has focus | |
| --- | --- |
| They haven't typed | Dictation keeps adding, with their caret and scroll put back. Interim text is in the textarea as plain text, and the final words replace it. Leaving brings the display back. |
| They've typed | The text is theirs: the badge goes, dictation and drafting stop, and it stays a textarea. |

Pressing Submit mid-sentence saves what's on screen, greyed words included. Cards read whether dictation fills them from `/dictating` and the interim text from `/interim` in their state, as they read Jev's likelihoods from `/likelihood`.

### Drafting (`src/server/draft/draft.ts`)

People ramble, correct themselves and circle back, so after each utterance an LLM rewrites the draft of the text question it counts for, from everything said for it. "um, tags, so housing, and transport, oh and not parks, actually yes parks" becomes "housing, transport, parks". Spec: [`2026-10-22-voice-drafting/design/spec-voice-drafting.md`](../2026-10-22-voice-drafting/design/spec-voice-drafting.md).

- A plan's text question can carry `draftHints`, prose on how its answer should read; the tags question asks for "A comma-separated list of short, lowercase tags, nothing else." A playbook writes them as a note, `[hints: …]`, which the compiler carries over. Without hints, the draft is a clean, faithful version of what was said.
- The prompt is `src/server/draft/prompts/draft.md`: add nothing that wasn't said, treat talk about the draft ("shorter", "write exactly what I said") as an instruction rather than content, follow the hints unless asked otherwise out loud, write in the speaker's language, and keep corrections. `draftRequest()` builds each call, and `readDraft()` checks the answer.
- The server (`#draft()` in `src/server/index.ts`) calls `DRAFT_MODEL` at low thinking, with one call per question in flight and one more after it for whatever was said meanwhile, and gives a call up after 20 s. Each draft is logged as a `draft` entry. `foldLog()` shows the latest draft followed, verbatim, by anything said since, so words appear at once and the next draft takes them in. A failed call logs nothing, and the words stay as said.
- Once someone changes a field's text, the page calls `takeOver()` and the server stops drafting it. While a call is in flight, the page shows "Drafting…" beside the "Filled in from what was said" badge.
- Calls and tokens have their own "Drafting" line in the log drawer's cost estimate. `DRAFT_ENABLED=false` in `.env` turns drafting off, leaving plain dictation.

`pnpm try-draft [case] [--model name]` runs sample rambles past the prompt and prints each draft beside what was said, for reading by eye. `gemini-3.5-flash` drafts in about 2 s, where `gemini-3.8-flash` often took 10–60 s, and unlike `gemini-3.5-flash-lite` it follows "write exactly what I said".

Tests sit beside what they test (`src/shared/index.test.ts`, `src/shared/plan/plan.test.ts`, `src/server/draft/draft.test.ts`, `src/client/cards/caret.test.ts`); `pnpm test` runs them along with `tests/compile.test.ts`.

### Playbooks (`src/shared/compile/compile.ts`)

A playbook is markdown a host could write: a `#` title, a `##` heading per section, and a bullet per question. It has no setting keys. `compilePlaybook()` turns one into a plan with `COMPILE_MODEL` at `COMPILE_THINKING` (`low`), the same way a host UI will call it:

- The system prompt is `src/shared/compile/prompts/compile-playbook.md`. Its `{{settings}}` placeholder gets the catalog in `src/shared/plan/settings.ts`: each portal setting's key, what it controls, and its options. The compiler maps the playbook's words to those keys. Which setting depends on which is left to the playbook.
- Gemini answers with the schema from `planLlmSchema()` in `src/shared/plan/plan.ts`. That's the plan's JSON Schema rewritten by `toLlmSchema()` into what Vertex enforces: `anyOf` for `oneOf`, `enum` for `const`, and no `pattern`.
- Zod and `lintPlan()` check each answer. Errors go back to Gemini with `src/shared/compile/prompts/compile-playbook-retry.md`, for up to three attempts.
- `source` is set by code: the playbook's name, and a hash of its text as the version.

`compile.ts` reads no files and calls no API itself. It's given the prompts and a `generate` function, so the Worker, the scripts and the tests (`pnpm test`) all call it the same way.

To check the compiler, we rebuild the hand-made plan from a playbook and compare:

```bash
pnpm decompile-plan src/shared/plan/admin-setup.json                       # → src/shared/compile/playbooks/admin-setup.decompiled.md
pnpm compile-playbook src/shared/compile/playbooks/admin-setup.decompiled.md --runs 10   # → compiled/admin-setup.decompiled.{1..10}.json
pnpm compare-plans src/shared/plan/admin-setup.json compiled/*.json
```

`decompile-plan` has Gemini write the playbook for a plan, with notes for the compiler in square brackets. `compile-playbook` compiles in parallel into `compiled/`, which isn't committed. `compare-plans` calls no model. It matches prompts by key and sections by title, and reports a difference in section, type, options, `required`, card, reading order, what releases an item, or draft hints given or not. Ids and `order` strings don't count, and changed wording, of prompts or hints, is reported apart. Gemini leaves an optional `draftHints` out even where the playbook has one, so `planLlmSchema()` requires it, with null for none, and `fromLlmPlan()` drops the nulls. Each call prints its time, tokens and cost. 10 of 10 compiles of the decompiled admin setup came out the same as the hand-made plan, at about 21 s and 1.8¢ each.

## Related

- [`2026-10-22-playbook-compilation/design/rfc-playbook-compilation.md`](../2026-10-22-playbook-compilation/design/rfc-playbook-compilation.md) — why playbooks compile this way, and what was measured

- [`voice-input`](../../voice-input) — `withVoiceInput` on its own
- [`design/rfc-jev-certainty.md`](../design/rfc-jev-certainty.md) — Jev judging proposed answers, not yet built
- [`structured-input`](../../structured-input) — questions as client-side tools in a chat
