# @dembrane/voice-google

Google speech-to-text for the [Cloudflare Agents](https://github.com/cloudflare/agents) voice pipeline. Google sells speech through several services, which differ in auth, regions and models, so each class is named for the service it calls. So far they all call Gemini models on Vertex AI:

- `VertexLiveSTT` streams, over the `BidiGenerateContent` WebSocket. It's a `Transcriber`.
- `VertexBatchSTT` transcribes a finished recording with `generateContent`, and can tell speakers apart.

Dembrane maintains it for the prototypes in [`examples/dembrane`](../..), which use it through a pnpm workspace. It's `private`, and shaped like the providers in [cloudflare/agents `voice-providers/`](https://github.com/cloudflare/agents/tree/main/voice-providers). It isn't built: `exports` points at the TypeScript source, which Vite bundles.

It needs no Workers AI binding. It only opens an outbound WebSocket with `fetch`, so it works in any Worker or Durable Object that can reach `aiplatform.googleapis.com`.

## Layout

| File                     | What's in it                                             |
| ------------------------ | -------------------------------------------------------- |
| `src/index.ts`           | The public exports                                       |
| `src/live.ts`            | `VertexLiveSTT`, a streaming `Transcriber`               |
| `src/batch.ts`           | `VertexBatchSTT`, for a finished recording               |
| `src/vertex.ts`          | What both share: options, host, access token             |
| `src/service-account.ts` | `serviceAccountToken`, tokens from a service account key |

Tests are split the same way, in `tests/live.test.ts`, `tests/batch.test.ts` and `tests/service-account.test.ts`.

## Usage

```typescript
import { Agent } from "agents";
import { withVoiceInput } from "agents/voice";
import { VertexLiveSTT } from "@dembrane/voice-google";

const InputAgent = withVoiceInput(Agent);

export class MyAgent extends InputAgent<Env> {
  transcriber = new VertexLiveSTT({
    accessToken: this.env.GOOGLE_ACCESS_TOKEN,
    project: this.env.GOOGLE_CLOUD_PROJECT
  });
}
```

It works with `withVoice` too, for a full voice agent, alongside any TTS provider.

### Tokens that last

A token from `gcloud auth print-access-token` lasts an hour. For a deployed Worker, pass `serviceAccountToken` a service account's JSON key instead. It signs a JWT with WebCrypto, exchanges it at Google's token endpoint, and reuses the token until 5 minutes before it expires. The cache is per isolate, so every session shares one token. The account needs a role that can call Vertex AI, such as `roles/aiplatform.user`.

```typescript
import { VertexLiveSTT, serviceAccountToken } from "@dembrane/voice-google";

transcriber = new VertexLiveSTT({
  accessToken: serviceAccountToken(this.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  project: this.env.GOOGLE_CLOUD_PROJECT
});
```

### Batch

`VertexBatchSTT` isn't a `Transcriber`. The pipeline drops anything a session sends after the call ends, so call it yourself once the recording is finished, such as from a `@callable()` method:

```typescript
import { VertexBatchSTT } from "@dembrane/voice-google";

const stt = new VertexBatchSTT({
  accessToken: this.env.GOOGLE_ACCESS_TOKEN,
  project: this.env.GOOGLE_CLOUD_PROJECT
});
// [{ speaker: 0, text: "Hello." }, { speaker: 1, text: "Hi there." }]
const segments = await stt.transcribe(wav, { diarize: true });
```

Speakers are numbered from 0, in the order they're first heard. Without `diarize`, `speaker` is `null`. It takes the same `accessToken`, `project` and `location` options as `VertexLiveSTT`. `model` defaults to `"gemini-3.5-transcribe-preview"`, which Vertex only serves from `global`.

## Options

For `VertexLiveSTT`:

| Option              | Default                                | Description                                                                                                                                      |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accessToken`       | (required)                             | OAuth token for Vertex AI, or a function that returns one. The function runs for each session.                                                   |
| `project`           | (required)                             | Google Cloud project with Vertex AI enabled                                                                                                      |
| `location`          | `"global"`                             | Vertex location. Each model is only served from some.                                                                                            |
| `model`             | `"gemini-3.5-transcribe-live-preview"` | Model ID. It must answer with text, since only its input transcription is used.                                                                  |
| `activityDetection` | Gemini's defaults                      | `realtimeInputConfig.automaticActivityDetection`: sensitivities, silence and prefix padding, or `disabled` to make the whole session one segment |

## How it works

1. When the session starts, it opens a WebSocket to Vertex and sends a `setup` message asking for input transcription and a text-only response.
2. Audio from `feed()` is buffered until Vertex sends `setupComplete`, then sent as base64 16kHz PCM in `realtimeInput` messages.
3. `voiceActivity` `ACTIVITY_START` becomes `onSpeechStart`, `interimInputTranscription` becomes `onInterim`, and `inputTranscription`, sent once Gemini's voice detection ends the turn, becomes `onUtterance`.
4. For long sessions, the setup also asks for `contextWindowCompression.slidingWindow`, since an audio session without it ends after 15 minutes, and for `sessionResumption` handles. On `goAway`, or a connection that drops once there's a handle, it opens a new connection with the latest resumable handle. Audio fed meanwhile is buffered, as before the first setup. An expired token, or 3 resumes in a row that never reach setup, still fail the session. Handles are valid for 2 hours, per the [Live API docs](https://ai.google.dev/gemini-api/docs/live-session).

## Tests

```bash
pnpm test
```

## Still to do

To match the other providers, and to be upstreamed:

- **Other Google services.** Classes for the Gemini API (`generativelanguage.googleapis.com`, with an API key that doesn't expire), and for Cloud Speech-to-Text.
- **Long sessions, checked live.** Resumption is tested against a mock socket. On 1 October 2026, `gemini-3.5-transcribe-live-preview` accepted `contextWindowCompression` and `sessionResumption` in its setup, but no session has run past Vertex's limits yet.
- **Stopping mid-sentence.** `close()` sends `realtimeInput.audioStreamEnd`, but any transcript Gemini sends back is dropped, so words spoken just before stopping are lost. No provider waits for one, because `TranscriberSession.close()` can't: it returns `void`, and the pipeline forgets the session straight away. This needs an SDK change upstream, such as `close()` returning a promise.
- **Language.** Map the session's `language` option onto Gemini's config, once we know which field the transcribe model honours.
- **Vocabulary.** The others take `keyterms` or a `prompt`. Find out whether a `systemInstruction` biases the transcribe model.
- **Agent context.** Implement `updateAgentContext()` if Gemini can take the agent's last reply as context without answering it.
- **Packaging.** A `tsdown` build to `dist/`, a CHANGELOG, a changeset, and the `repository` fields, as the upstream packages have.
