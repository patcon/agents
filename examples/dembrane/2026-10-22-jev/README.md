# 2026-10-22-jev

A continuous voice session that walks a host through setting up their project's portal. The setup questions come from a plan compiled from a playbook (`src/plans/admin-setup.json`); more can come on demand from the host and from an agent. Everything is stored as an append-only `UIMessage` log in one Durable Object.

On top of the 2026-10-21 portal admin setup, this one has [Jev](https://docs.typesafe.ai), TypeSafe's System One model, listen along: every card with options shows how likely each option is to be what the speaker chose, and fills in the likely ones.

## Run it

```bash
cp .env.example .env   # then set GOOGLE_CLOUD_PROJECT, and TYPESAFE_API_KEY for Jev
pnpm install
pnpm google-token      # writes a fresh GOOGLE_ACCESS_TOKEN to .env (lasts about an hour)
                       # or: pnpm google-key key.json, for a service account key that doesn't expire
pnpm run start
```

Transcription and the agent's question both use Gemini on Vertex AI, so you need a Google Cloud project with Vertex AI enabled and `gcloud` signed in. Deploys use a JSON key for a service account with `roles/aiplatform.user` instead, as `GOOGLE_SERVICE_ACCOUNT_KEY`: the Worker trades it for access tokens with `serviceAccountToken`, and fetches a new one before each expires. Transcription streams to `gemini-3.5-transcribe-live-preview` through `VertexLiveSTT` from [`@dembrane/voice-google`](../packages/voice-google); the agent's question comes from `gemini-3.8-flash`. Both models are set in `wrangler.jsonc`.

## How it works

### The log

Every event is a new `UIMessage` with its own id. Nothing is edited in place. `metadata.subjectId` names the logical thing an entry is about, so answering a question twice appends two `answer` entries for the same subject, and the last one wins:

```ts
type LogMeta =
  | { kind: "utterance"; subjectId: string; at: number }
  | { kind: "question"; subjectId: string; at: number }
  | { kind: "answer"; subjectId: string; at: number }
  | { kind: "trigger"; subjectId: string; at: number }
  | { kind: "status"; subjectId: "session"; at: number };
```

`foldLog()` in `src/shared.ts` turns the log into current state. The client renders it, and the server feeds the same view to the model.

### Server (`src/server.ts`)

`ConversationAgent` is `withVoiceInput(AIChatAgent)`. Each source of events appends to the log with `persistMessages()`, which writes without starting a model turn:

| Source   | How it appends                                                    |
| -------- | ----------------------------------------------------------------- |
| Voice    | `onTranscript()` appends an `utterance`                           |
| Plan     | `begin()` and `answer()` append the questions the plan releases   |
| Host     | `@callable() pushHostQuestion()`                                  |
| Person   | `@callable() answer(questionId, value, skipped)`                  |

The agent is woken without a human message: a `trigger` entry is appended with `saveMessages()`, which runs `onChatMessage()`. That asks Gemini for a question shaped by a JSON schema (`src/gemini.ts`), appends it, and replies with a short assistant message saying what it asked. The trigger stays in the log, so it's clear why the turn ran.

```ts
await this.saveMessages((messages) => [...messages, triggerEntry]);
```

### Client (`src/client.tsx`)

`useAgentChat` keeps the log in sync; `useVoiceInput` streams the microphone to the same agent instance. The page shows one question at a time with Back / Next. Each question's input is a [json-render](https://github.com/vercel-labs/json-render) card: a plan can give a prompt its own `card` (the language question lays its options out in two columns), and any question without one gets a default for its type. `src/cards.ts` holds the catalog of components a card can use and the platform's own cards, like consent, which a plan can place but not change; `src/card-registry.tsx` draws them. New questions stack behind the current one and show as a count on Next. The transcript and the raw message log live in drawers. The log drawer also estimates what the session has cost so far, at today's prices and at any announced change, from the audio seconds streamed and the tokens Gemini reports. The tally lives in the agent's state, not the log. `pnpm update-prices` rewrites `src/prices.json` for the models in `wrangler.jsonc`, taking today's Vertex AI rate from [LiteLLM](https://models.litellm.ai) and announced changes from [pydantic/genai-prices](https://github.com/pydantic/genai-prices).

### Jev (`src/jev.ts`)

Jev is on whenever `TYPESAFE_API_KEY` is set. `JEV_ENABLED=false` turns it off with the key still set.

As soon as an utterance arrives, or 100 ms after a question does, the server asks Jev about every unanswered question whose card presents options (radio and checkbox), in one request over the last 40 utterances. Only one request is in flight; whatever arrives meanwhile is covered by one more after it.

| Card     | What Jev is asked                                                                                 | An option's likelihood |
| -------- | ------------------------------------------------------------------------------------------------- | ---------------------- |
| radio    | `pick`, a Choice over the options, and `stated`, a Noul: has the speaker answered this at all?    | `pick × stated`        |
| checkbox | A Noul per option: has the speaker said this one applies?                                         | That Noul              |

The page calls `show(questionId)` whenever a question comes on screen, which appends a `shown` entry. Each utterance in Jev's state says which question was on screen when it was said, and Jev is told those lines answer that question directly, while anything said before it appeared counts only if it clearly settles it. Questions arrive filled in from what was said earlier, but what's said while a question is showing counts for more.

Each run appends an `assessment` entry with Jev's raw probabilities, the model version, the last utterance it saw, the question on screen, and for each question the utterances said while it was showing (`heardOnScreen`). `foldLog()` turns the latest one into a `likelihood` per option and a `suggested` answer, so thresholds can change without calling Jev again. An option is filled in at 80% and stays filled until it drops below 30% (`AUTO_SELECT` in `src/shared.ts`).

On the page, each option has a bar behind it as wide as its likelihood, which grows from zero when Jev's first likelihood arrives. Below the auto-select threshold it's dim and blurred; above it, crisp. Cards read the likelihoods from `/likelihood` in their state, so custom cards get bars too. Until someone touches a card, an unanswered question shows Jev's suggestion as its draft, with a "Filled in from what was said" badge; it's never submitted for them. A plan can turn Jev off for a prompt with `"assess": false`.

The model is pinned in `wrangler.jsonc` (`jev-1.13.0`), and Jev's input tokens show in the log drawer's cost estimate ($0.042 per million; output is free).

`pnpm try-jev` runs short Dutch and English transcripts past Jev with every option question in the admin setup plan, and prints the likelihoods: `pnpm try-jev nl` for just the Dutch ones, `JEV_MODEL=jev-1.14.0 pnpm try-jev` to try another model.

## Related

- [`voice-input`](../../voice-input) — `withVoiceInput` on its own
- [`design/rfc-jev-certainty.md`](../design/rfc-jev-certainty.md) — Jev judging proposed answers, not yet built
- [`structured-input`](../../structured-input) — questions as client-side tools in a chat
