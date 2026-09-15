import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createWorkersAI } from "workers-ai-provider";
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
