# @dembrane/voice-google

Google speech-to-text and text-to-speech for the [Cloudflare Agents](https://github.com/cloudflare/agents) voice pipeline. Google sells speech through several services, which differ in auth, regions and models, so each class is named for the service it calls. So far they all call Gemini models on Vertex AI:

- `VertexLiveSTT` streams, over the `BidiGenerateContent` WebSocket. It's a `Transcriber`.
- `VertexBatchSTT` transcribes a finished recording with `generateContent`, and can tell speakers apart.
- `VertexTTS` speaks, with `generateContent`, or `streamGenerateContent` to stream. It's a `TTSProvider` and a `StreamingTTSProvider`.

Dembrane maintains it for the prototypes in [`examples/dembrane`](../..), which use it through a pnpm workspace. It's `private`, and shaped like the providers in [cloudflare/agents `voice-providers/`](https://github.com/cloudflare/agents/tree/main/voice-providers). It isn't built: `exports` points at the TypeScript source, which Vite bundles.

It needs no Workers AI binding. It only opens an outbound WebSocket, and makes requests, with `fetch`, so it works in any Worker or Durable Object that can reach `aiplatform.googleapis.com`.

## Layout

| File                       | What's in it                                              |
| -------------------------- | --------------------------------------------------------- |
| `src/index.ts`             | The public exports                                        |
| `src/live.ts`              | `VertexLiveSTT`, a streaming `Transcriber`                |
| `src/batch.ts`             | `VertexBatchSTT`, for a finished recording                |
| `src/tts.ts`               | `VertexTTS`, text-to-speech                               |
| `src/vertex.ts`            | What they share: options, host, access token              |
| `src/vertex-tts-models.ts` | Which TTS models Vertex serves, where, and in what format |
| `src/service-account.ts`   | `serviceAccountToken`, tokens from a service account key  |

Tests are split the same way, in `tests/live.test.ts`, `tests/batch.test.ts`, `tests/tts.test.ts` and `tests/service-account.test.ts`. `tests/tts.live.test.ts` calls Vertex, and only runs when given a token; see [Tests](#tests).

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

### Text-to-speech

`VertexTTS` answers with raw mono PCM16 at 24 kHz, so tell the voice pipeline to expect it:

```typescript
import { Agent } from "agents";
import { withVoice } from "agents/voice";
import {
  VERTEX_TTS_SAMPLE_RATE,
  VertexLiveSTT,
  VertexTTS
} from "@dembrane/voice-google";

const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: VERTEX_TTS_SAMPLE_RATE
});

export class MyAgent extends VoiceAgent<Env> {
  transcriber = new VertexLiveSTT({ ... });
  tts = new VertexTTS({
    accessToken: this.env.GOOGLE_ACCESS_TOKEN,
    project: this.env.GOOGLE_CLOUD_PROJECT,
    voice: "Kore"
  });
}
```

The pipeline streams with `synthesizeStream()`, which yields audio in chunks of about 40 ms as Vertex sends them over SSE. On a failed request, both methods log the error and return no audio, as the other providers do. To steer delivery, put it in the text, such as `"Say warmly: Thanks for joining."`. It takes the same `accessToken`, `project` and `location` options as `VertexLiveSTT`, plus `voice`, a [prebuilt voice name](https://cloud.google.com/text-to-speech/docs/gemini-tts) that defaults to `"Kore"`, and `model`, which defaults to `"gemini-3.8-flash-tts"`.

#### Models

Any model in `VERTEX_TTS_MODELS` works: set `model`, and leave out `location` to have it sent where Vertex serves it. If you set a location that doesn't serve the model, the logged 404 says where it was served. Gemini 3.8 answers `generateContent` with a WAV file, though it streams bare PCM, so `synthesize()` takes the samples out of any WAV before returning them.

On 21 October 2026, for one project:

| Model                               | Status                          | Locations                          | First audio |
| ----------------------------------- | ------------------------------- | ---------------------------------- | ----------- |
| `gemini-3.8-flash-tts` (default)    | stable                          | `global`                           | ~0.7 s      |
| `gemini-3.8-flash-lite-tts`         | stable                          | `global`                           | ~0.4 s      |
| `gemini-3.1-flash-tts-preview`      | preview, shuts down 17 Nov 2026 | `global`, `us-central1`            | ~1.0 s      |
| `gemini-2.5-flash-tts`              | stable                          | `global`, and 13 US and EU regions | ~1.0 s      |
| `gemini-2.5-pro-tts`                | stable                          | `global`, and 13 US and EU regions | ~1.5 s      |
| `gemini-2.5-flash-lite-preview-tts` | preview                         | `global`, and 13 US and EU regions | ~0.7 s      |

`src/vertex-tts-models.ts` has the full region lists and the mime types each method answered with. It's written by a script that calls every model in 25 locations, since Vertex's model catalog leaves out the 3.x TTS models. Rerun it to refresh the table:

```bash
pnpm probe-vertex-tts [project]
```

The Gemini API, at `generativelanguage.googleapis.com` with an API key, is a separate service with its own models and request shape, documented at [ai.google.dev](https://ai.google.dev/gemini-api/docs/speech-generation). `VertexTTS` only calls Vertex, and the table only covers Vertex. First audio is from one streamed sentence each, so it's a rough guide.

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

To also call Vertex with every TTS model in `VERTEX_TTS_MODELS`:

```bash
GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token) \
GOOGLE_CLOUD_PROJECT=my-project pnpm test tts.live
```

## Still to do

To match the other providers, and to be upstreamed:

- **Other Google services.** Classes for the Gemini API (`generativelanguage.googleapis.com`, with an API key that doesn't expire, such as a `GeminiApiTTS`), and for Cloud Text-to-Speech's Chirp 3 HD voices, each with its own model table like `src/vertex-tts-models.ts`.
- **Long sessions, checked live.** Resumption is tested against a mock socket. On 1 October 2026, `gemini-3.5-transcribe-live-preview` accepted `contextWindowCompression` and `sessionResumption` in its setup, but no session has run past Vertex's limits yet.
- **Stopping mid-sentence.** `close()` sends `realtimeInput.audioStreamEnd`, but any transcript Gemini sends back is dropped, so words spoken just before stopping are lost. No provider waits for one, because `TranscriberSession.close()` can't: it returns `void`, and the pipeline forgets the session straight away. This needs an SDK change upstream, such as `close()` returning a promise.
- **Language.** Map the session's `language` option onto Gemini's config, once we know which field the transcribe model honours.
- **Vocabulary.** The others take `keyterms` or a `prompt`. Find out whether a `systemInstruction` biases the transcribe model.
- **Agent context.** Implement `updateAgentContext()` if Gemini can take the agent's last reply as context without answering it.
- **Packaging.** A `tsdown` build to `dist/`, a CHANGELOG, a changeset, and the `repository` fields, as the upstream packages have.
