/**
 * `VertexTTS`: text-to-speech over Vertex AI's `generateContent`, and
 * `streamGenerateContent` for streaming.
 */

import type { StreamingTTSProvider, TTSProvider } from "agents/voice";
import {
  logVoiceError,
  toVoiceError,
  VoiceProviderError
} from "agents/voice/errors";
import {
  base64ToArrayBuffer,
  resolveAccessToken,
  vertexHost,
  type VertexOptions
} from "./vertex";
import {
  VERTEX_TTS_MODELS,
  VERTEX_TTS_MODELS_CHECKED
} from "./vertex-tts-models";

/** Gemini TTS answers with mono 16-bit PCM at this rate. */
export const VERTEX_TTS_SAMPLE_RATE = 24_000;

export interface VertexTTSOptions extends VertexOptions {
  /**
   * Model ID, such as `gemini-3.8-flash-lite-tts` for lower latency. Any
   * model in `VERTEX_TTS_MODELS` works.
   * @default "gemini-3.8-flash-tts"
   */
  model?: string;
  /**
   * Prebuilt voice name, such as `Puck` or `Charon`.
   * @default "Kore"
   */
  voice?: string;
}

/**
 * Gemini text-to-speech for the Agents voice pipeline, over Vertex AI.
 *
 * Implements both `TTSProvider` and `StreamingTTSProvider`. Audio is raw
 * mono PCM16 at 24 kHz, so the agent must declare it with
 * `audioFormat: "pcm16"` and `sampleRate: VERTEX_TTS_SAMPLE_RATE`.
 *
 * - `synthesize(text)` waits for the whole sentence, from `generateContent`.
 * - `synthesizeStream(text)` yields chunks as they arrive, from
 *   `streamGenerateContent` over SSE.
 *
 * To steer delivery, put it in the text, such as "Say warmly: ...".
 *
 * @example
 * ```typescript
 * const VoiceAgent = withVoice(Agent, {
 *   audioFormat: "pcm16",
 *   sampleRate: VERTEX_TTS_SAMPLE_RATE
 * });
 *
 * export class MyAgent extends VoiceAgent<Env> {
 *   tts = new VertexTTS({
 *     accessToken: env.GOOGLE_ACCESS_TOKEN,
 *     project: env.GOOGLE_CLOUD_PROJECT
 *   });
 * }
 * ```
 */
export class VertexTTS implements TTSProvider, StreamingTTSProvider {
  #options: VertexTTSOptions;

  constructor(options: VertexTTSOptions) {
    this.#options = options;
  }

  async synthesize(
    text: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    try {
      const resp = await this.#request("generateContent", text, signal);
      if (!resp.ok) {
        await logRequestError(resp, "synthesize", this.#options);
        return null;
      }
      const chunks = _parseAudio(await resp.json());
      return chunks.length > 0 ? concat(chunks) : null;
    } catch (error) {
      logVoiceError({
        component: "VertexTTS",
        stage: "synthesize",
        message: "Gemini TTS request failed",
        error: toVoiceError(error, "Gemini TTS request failed")
      });
      return null;
    }
  }

  async *synthesizeStream(
    text: string,
    signal?: AbortSignal
  ): AsyncGenerator<ArrayBuffer> {
    try {
      const resp = await this.#request("streamGenerateContent", text, signal);
      if (!resp.ok || !resp.body) {
        await logRequestError(resp, "synthesize_stream", this.#options);
        return;
      }
      const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += value;
        // SSE events end with a blank line; keep any partial one for later.
        const events = buffered.split(/\r?\n\r?\n/);
        buffered = events.pop() ?? "";
        for (const event of events) yield* _parseSSEEvent(event);
      }
      yield* _parseSSEEvent(buffered);
    } catch (error) {
      logVoiceError({
        component: "VertexTTS",
        stage: "synthesize_stream",
        message: "Gemini TTS stream failed",
        error: toVoiceError(error, "Gemini TTS stream failed")
      });
    }
  }

  async #request(
    method: "generateContent" | "streamGenerateContent",
    text: string,
    signal?: AbortSignal
  ): Promise<Response> {
    const config = this.#options;
    const accessToken = await resolveAccessToken(config.accessToken, "Gemini");
    return fetch(_buildTTSUrl(config, method), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(_buildTTSRequest(text, config.voice)),
      signal
    });
  }
}

async function logRequestError(
  resp: Response,
  stage: string,
  opts: VertexTTSOptions
): Promise<void> {
  // Vertex puts the reason, such as an expired token, in the body.
  const body = await resp.text().catch(() => "");
  const error = new VoiceProviderError(
    `Gemini TTS request failed (${resp.status}): ${body}${_notServedHint(opts, resp.status)}`,
    { status: resp.status }
  );
  logVoiceError({
    component: "VertexTTS",
    stage,
    message: error.message,
    error
  });
}

function concat(chunks: ArrayBuffer[]): ArrayBuffer {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

const DEFAULT_MODEL = "gemini-3.8-flash-tts";

/**
 * Underscore-prefixed: internal helper, exported only for unit tests.
 * Without a `location`, a model in `VERTEX_TTS_MODELS` goes to the first
 * location that served it, and any other model to `global`.
 */
export function _resolveLocation(opts: VertexTTSOptions): string {
  const model = VERTEX_TTS_MODELS[opts.model ?? DEFAULT_MODEL];
  return opts.location ?? model?.locations[0] ?? "global";
}

/**
 * Underscore-prefixed: internal helper, exported only for unit tests.
 * Vertex answers 404 for a model it doesn't serve in that location, so say
 * where it was served instead.
 */
export function _notServedHint(opts: VertexTTSOptions, status: number): string {
  const id = opts.model ?? DEFAULT_MODEL;
  const model = VERTEX_TTS_MODELS[id];
  if (status !== 404 || !model) return "";
  return ` (on ${VERTEX_TTS_MODELS_CHECKED}, Vertex served ${id} from ${model.locations.join(", ")})`;
}

/** Underscore-prefixed: internal helper, exported only for unit tests. */
export function _buildTTSUrl(
  opts: VertexTTSOptions,
  method: "generateContent" | "streamGenerateContent"
): string {
  const location = _resolveLocation(opts);
  const model = opts.model ?? DEFAULT_MODEL;
  const query = method === "streamGenerateContent" ? "?alt=sse" : "";
  return `https://${vertexHost(location)}/v1beta1/projects/${opts.project}/locations/${location}/publishers/google/models/${model}:${method}${query}`;
}

/** Underscore-prefixed: internal helper, exported only for unit tests. */
export function _buildTTSRequest(text: string, voice = "Kore") {
  return {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
      }
    }
  };
}

interface GenerateContentResponse {
  candidates?: {
    content?: {
      parts?: { inlineData?: { mimeType?: string; data?: string } }[];
    };
  }[];
}

/** Underscore-prefixed: internal helper, exported only for unit tests. */
export function _parseAudio(response: GenerateContentResponse): ArrayBuffer[] {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.flatMap(({ inlineData }) => {
    if (!inlineData?.data) return [];
    const audio = base64ToArrayBuffer(inlineData.data);
    return [inlineData.mimeType === "audio/wav" ? _wavToPCM(audio) : audio];
  });
}

/**
 * Underscore-prefixed: internal helper, exported only for unit tests.
 * Gemini 3.8 TTS answers `generateContent` with a whole WAV file, though it
 * streams bare PCM. Returns the samples from its `data` chunk.
 */
export function _wavToPCM(wav: ArrayBuffer): ArrayBuffer {
  const view = new DataView(wav);
  // Chunks follow the 12-byte RIFF header: a 4-byte ID, then a 4-byte size.
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(wav, offset, 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      return wav.slice(offset + 8, Math.min(offset + 8 + size, wav.byteLength));
    }
    // Chunks are padded to an even length.
    offset += 8 + size + (size % 2);
  }
  throw new VoiceProviderError("Gemini TTS sent a WAV file with no data chunk");
}

/**
 * Underscore-prefixed: internal helper, exported only for unit tests.
 * Each SSE event's `data:` lines hold one `GenerateContentResponse`.
 */
export function _parseSSEEvent(event: string): ArrayBuffer[] {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? _parseAudio(JSON.parse(data)) : [];
}
