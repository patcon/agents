import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createWorkersAI } from "workers-ai-provider";
import { WorkersAITTS } from "agents/voice";
import type { TTSProvider } from "agents/voice";
import type { LanguageModel } from "ai";

/**
 * Model selection for the AI demos.
 *
 * By default the playground runs on Workers AI (no keys needed). Set
 * OPENROUTER_API_KEY (in .dev.vars locally, or `wrangler secret put` when
 * deployed) to route the demos through OpenRouter instead — handy if you want
 * to try a model Workers AI doesn't host.
 */
const WORKERS_AI_MODEL = "@cf/moonshotai/kimi-k2.7-code";
const OPENROUTER_MODEL = "openrouter/free";

export function getModel(
  env: Env,
  options?: { sessionAffinity?: string }
): LanguageModel {
  // Declared in wrangler.jsonc's secrets.required, but may be unset locally.
  if (env.OPENROUTER_API_KEY) {
    const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
    return openrouter(OPENROUTER_MODEL);
  }

  const workersai = createWorkersAI({ binding: env.AI });
  return workersai(WORKERS_AI_MODEL, {
    sessionAffinity: options?.sessionAffinity
  });
}

/**
 * TTS selection for the voice demo.
 *
 * Follows `getModel`: Workers AI by default, OpenRouter when
 * OPENROUTER_API_KEY is set. Set USE_OPENROUTER_TTS=false to keep speech on
 * Workers AI while the LLM still runs on OpenRouter. OpenRouter has no
 * free-model router for speech (`openrouter/free` is chat-only), so the model
 * is named explicitly.
 */
const OPENROUTER_TTS_MODEL = "deepgram/flux-tts:free";
const OPENROUTER_TTS_VOICE = "flux-bree-en";

/**
 * OpenRouter text-to-speech, via its OpenAI-compatible speech endpoint.
 *
 * Returns mp3, which is what the voice pipeline sends to the browser by
 * default (`audioFormat`), so the client decodes it without extra config.
 *
 * @see https://openrouter.ai/docs/guides/overview/multimodal/tts
 */
export class OpenRouterTTS implements TTSProvider {
  #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
  }

  async synthesize(
    text: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENROUTER_TTS_MODEL,
        input: text,
        voice: OPENROUTER_TTS_VOICE,
        response_format: "mp3"
      }),
      ...(signal ? { signal } : {})
    });

    // Mirrors WorkersAITTS: an error body (e.g. a 429) would otherwise be
    // forwarded to the client as audio bytes and fail to decode silently.
    if (!response.ok) {
      console.error(
        "OpenRouter TTS request failed",
        response.status,
        await response.text()
      );
      return null;
    }

    return await response.arrayBuffer();
  }
}

export function getTTS(env: Env): TTSProvider {
  // Defaults to on whenever there is a key; USE_OPENROUTER_TTS=false opts out.
  const enabled = env.USE_OPENROUTER_TTS !== "false";
  if (env.OPENROUTER_API_KEY && enabled) {
    return new OpenRouterTTS(env.OPENROUTER_API_KEY);
  }

  return new WorkersAITTS(env.AI);
}
