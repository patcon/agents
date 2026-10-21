/**
 * @dembrane/voice-google — Google speech-to-text and text-to-speech for
 * the Cloudflare Agents voice pipeline. Each class is named for the Google
 * service it calls; so far, Gemini models on Vertex AI. See README.md.
 *
 * - `VertexLiveSTT` (`./live.ts`) streams over `BidiGenerateContent`, and
 *   resumes the session on a new connection when Vertex closes the old one.
 * - `VertexBatchSTT` (`./batch.ts`) transcribes a finished recording with
 *   `generateContent`.
 * - `VertexTTS` (`./tts.ts`) speaks, whole sentences or streamed.
 */

export {
  VertexLiveSTT,
  type ActivityDetection,
  type VertexLiveSTTOptions
} from "./live";
export {
  VertexBatchSTT,
  type VertexBatchSTTOptions,
  type TranscribeOptions,
  type TranscriptSegment
} from "./batch";
export {
  VERTEX_TTS_SAMPLE_RATE,
  VertexTTS,
  type VertexTTSOptions
} from "./tts";
export {
  VERTEX_TTS_MODELS,
  VERTEX_TTS_MODELS_CHECKED,
  type VertexTTSModel
} from "./vertex-tts-models";
export { resolveAccessToken, vertexHost, type VertexOptions } from "./vertex";
export { serviceAccountToken, type ServiceAccountKey } from "./service-account";
