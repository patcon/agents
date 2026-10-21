# Voice Questionnaire

A continuous voice session that collects a transcript while questions arrive on a schedule, on demand from the host, and from an agent — all stored as an append-only `UIMessage` log in one Durable Object.

## Run it

```bash
cp .env.example .env   # then set GOOGLE_CLOUD_PROJECT
pnpm install
pnpm google-token      # writes a fresh GOOGLE_ACCESS_TOKEN to .env (lasts about an hour)
pnpm run start
```

Transcription and the agent's question both use Gemini on Vertex AI, so you need a Google Cloud project with Vertex AI enabled and `gcloud` signed in. Transcription streams to `gemini-3.5-transcribe-live-preview` through `GeminiLiveSTT`, vendored in `src/voice-gemini/`; the agent's question comes from `gemini-3.8-flash`. Both models are set in `wrangler.jsonc`.

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
| Schedule | `this.schedule(15, "askScheduled", { index })` appends a question |
| Host     | `@callable() pushHostQuestion()`                                  |
| Person   | `@callable() answer(questionId, value, skipped)`                  |

The agent is woken without a human message: a `trigger` entry is appended with `saveMessages()`, which runs `onChatMessage()`. That asks Gemini for a question shaped by a JSON schema (`src/gemini.ts`), appends it, and replies with a short assistant message saying what it asked. The trigger stays in the log, so it's clear why the turn ran.

```ts
await this.saveMessages((messages) => [...messages, triggerEntry]);
```

### Client (`src/client.tsx`)

`useAgentChat` keeps the log in sync; `useVoiceInput` streams the microphone to the same agent instance. The page shows one question at a time with Back / Next. New questions stack behind the current one and show as a count on Next. The transcript and the raw message log live in drawers.

## Related

- [`voice-input`](../voice-input) — `withVoiceInput` on its own
- [`structured-input`](../structured-input) — questions as client-side tools in a chat
