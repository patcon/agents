# Voice Input

Voice-to-text dictation example using the `useVoiceInput` hook from `agents/voice`.

Captures microphone audio, streams it to an Agent Durable Object for real-time speech-to-text using Workers AI, and displays the transcript in a text area.

## Run it

From this directory, build the `agents` workspace package once, then start the example:

```bash
pnpm install
(cd ../../packages/agents && pnpm build)
pnpm start
```

("Failed to resolve entry for package agents" / "agents/voice ... could not be resolved" means `agents` needs (re)building.)

No API keys needed — uses Workers AI (bound via `wrangler.jsonc`).

## Running with a local-only model

For fully offline dev (no Cloudflare account, no network calls), swap in
[`LocalWhisperfileSTT`](./src/local-whisper-stt.ts), which sends audio to a
[whisperfile](https://huggingface.co/Mozilla/whisperfile) server running on
your machine instead of Workers AI. Quality and latency are both noticeably
worse than the hosted Nova 3 model — this is meant for quick local dev, not
production.

```bash
pnpm stt:setup    # one-time: downloads whisper-tiny.en.llamafile (~90MB)
pnpm stt:server   # leave running in its own terminal
pnpm start:whisper
```

`start:whisper` sets two env vars:

- `VITE_STT_PROVIDER=local`, which `src/server.ts` reads to pick
  `LocalWhisperfileSTT` over `WorkersAINova3STT`.
- `CLOUDFLARE_VITE_FORCE_LOCAL=true`, which tells `@cloudflare/vite-plugin`
  to skip connecting to Cloudflare for the `AI` binding (configured as
  `remote: true` in `wrangler.jsonc`) instead of trying and failing while
  offline. Safe here since this mode never calls `env.AI`.

No code changes needed to switch back — just run `pnpm start` instead.

## How it works

### Server (`src/server.ts`)

Uses `withVoiceInput` — a lightweight mixin that only does STT. No TTS provider, no `onTurn` handler needed:

```typescript
import { Agent } from "agents";
import { withVoiceInput, WorkersAINova3STT } from "agents/voice";

const InputAgent = withVoiceInput(Agent);

export class VoiceInputAgent extends InputAgent<Env> {
  transcriber = new WorkersAINova3STT(this.env.AI);

  onTranscript(text, connection) {
    console.log("User said:", text);
  }
}
```

### Client (`src/client.tsx`)

Uses `useVoiceInput` — a lightweight React hook that accumulates transcripts into a single string:

```tsx
import { useVoiceInput } from "agents/voice/react";

const { transcript, interimTranscript, isListening, start, stop, clear } =
  useVoiceInput({ agent: "VoiceInputAgent" });
```

Returns:

- **`transcript`** — accumulated final text from all utterances
- **`interimTranscript`** — real-time partial transcript (updates as you speak)
- **`isListening`** — whether the mic is active
- **`audioLevel`** — current audio level for visual feedback
- **`start()` / `stop()`** — control listening
- **`toggleMute()`** — mute without stopping
- **`clear()`** — reset the transcript

## Related

- [`examples/playground`](../playground) — full voice agent with conversation
- [`agents/voice`](../../packages/agents) — the Agents package Voice exports
