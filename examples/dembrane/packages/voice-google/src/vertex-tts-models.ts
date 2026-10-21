/**
 * Gemini TTS models on Vertex AI, as `scripts/probe-vertex-tts.mjs` found
 * them on 2026-10-21. Regenerate with `pnpm probe-vertex-tts`; don't edit
 * by hand. The Gemini API serves a different set.
 */

export interface VertexTTSModel {
  /** `shutdown` is when Google retires it, from the Gemini API docs. */
  status: "stable" | "preview";
  shutdown?: string;
  /** Vertex locations that served it, `global` first when it does. */
  locations: string[];
  /** The mime types it answered each method with. */
  audio: { generateContent: string; streamGenerateContent: string };
  sampleRate: number;
  /** From one streamed sentence, so only a rough guide. */
  firstAudioMs: number;
}

export const VERTEX_TTS_MODELS_CHECKED = "2026-10-21";

export const VERTEX_TTS_MODELS: Record<string, VertexTTSModel> = {
  "gemini-3.8-flash-tts": {
    status: "stable",
    locations: ["global"],
    audio: {
      generateContent: "audio/wav",
      streamGenerateContent: "audio/l16; rate=24000; channels=1"
    },
    sampleRate: 24000,
    firstAudioMs: 773
  },
  "gemini-3.8-flash-lite-tts": {
    status: "stable",
    locations: ["global"],
    audio: {
      generateContent: "audio/wav",
      streamGenerateContent: "audio/l16; rate=24000; channels=1"
    },
    sampleRate: 24000,
    firstAudioMs: 389
  },
  "gemini-3.1-flash-tts-preview": {
    status: "preview",
    shutdown: "2026-11-17",
    locations: ["global", "us-central1"],
    audio: {
      generateContent: "audio/l16; rate=24000; channels=1",
      streamGenerateContent: "audio/l16; rate=24000; channels=1"
    },
    sampleRate: 24000,
    firstAudioMs: 1033
  },
  "gemini-2.5-flash-tts": {
    status: "stable",
    locations: [
      "global",
      "us-central1",
      "us-east1",
      "us-east4",
      "us-east5",
      "us-south1",
      "us-west1",
      "us-west4",
      "northamerica-northeast1",
      "europe-west1",
      "europe-west4",
      "europe-north1",
      "europe-southwest1",
      "europe-central2"
    ],
    audio: {
      generateContent: "audio/L16;codec=pcm;rate=24000",
      streamGenerateContent: "audio/L16;codec=pcm;rate=24000"
    },
    sampleRate: 24000,
    firstAudioMs: 785
  },
  "gemini-2.5-pro-tts": {
    status: "stable",
    locations: [
      "global",
      "us-central1",
      "us-east1",
      "us-east4",
      "us-east5",
      "us-south1",
      "us-west1",
      "us-west4",
      "europe-west1",
      "europe-west4",
      "europe-west8",
      "europe-north1",
      "europe-southwest1",
      "europe-central2"
    ],
    audio: {
      generateContent: "audio/L16;codec=pcm;rate=24000",
      streamGenerateContent: "audio/L16;codec=pcm;rate=24000"
    },
    sampleRate: 24000,
    firstAudioMs: 1189
  },
  "gemini-2.5-flash-lite-preview-tts": {
    status: "preview",
    locations: [
      "global",
      "us-central1",
      "us-east1",
      "us-east4",
      "us-east5",
      "us-south1",
      "us-west1",
      "us-west4",
      "northamerica-northeast1",
      "europe-west1",
      "europe-west4",
      "europe-north1",
      "europe-southwest1",
      "europe-central2"
    ],
    audio: {
      generateContent: "audio/L16;codec=pcm;rate=24000",
      streamGenerateContent: "audio/L16;codec=pcm;rate=24000"
    },
    sampleRate: 24000,
    firstAudioMs: 716
  }
};
