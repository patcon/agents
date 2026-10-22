// What the scripts that call Gemini share: the env from .env, the model
// wrangler.jsonc names, and generateJson() with a timeout that says what
// it's doing and what it cost.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateJson, type TokenUsage } from "../src/gemini.ts";

export const root = join(import.meta.dirname, "..");

const prices = JSON.parse(readFileSync(join(root, "src/prices.json"), "utf8"));

export function loadEnv(): Env {
  const env = Object.fromEntries(
    readFileSync(join(root, ".env"), "utf8")
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
      .filter((m) => m !== null)
      // Single quotes keep a service account key's \n escapes as they are
      .map(([, key, value]) => [key, value.replace(/^'(.*)'$/, "$1")])
  );
  const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  for (const name of ["AGENT_MODEL", "COMPILE_MODEL"]) {
    const model = wrangler.match(new RegExp(`"${name}":\\s*"([^"]+)"`))?.[1];
    if (model) env[name] ??= model;
  }
  return env as unknown as Env;
}

/** Today's price of `usage` in dollars, if prices.json knows the model. */
export function costOf(model: string, usage: TokenUsage): number | undefined {
  const rates = (
    prices.models as Record<string, { input: number; output: number }[]>
  )[model];
  const rate = rates?.[0];
  if (!rate) return undefined;
  return (
    (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1e6
  );
}

export function formatUsage(model: string, usage: TokenUsage) {
  const cost = costOf(model, usage);
  return `${usage.inputTokens} tokens in, ${usage.outputTokens} out${
    cost === undefined ? "" : `, about $${cost.toFixed(4)}`
  }`;
}

/**
 * generateJson() for one model, giving up after `timeoutMs`, and logging
 * each call as it starts and ends.
 */
export function generator(env: Env, model: string, timeoutMs = 90_000) {
  let calls = 0;
  return async (
    request: Omit<Parameters<typeof generateJson>[1], "model" | "signal">
  ) => {
    const call = ++calls;
    const started = Date.now();
    console.error(
      `${model} call ${call}: asking (gives up after ${timeoutMs / 1000} s)...`
    );
    const answer = await generateJson(env, {
      ...request,
      model,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.error(
      `${model} call ${call}: answered in ${seconds} s, ${formatUsage(model, answer.usage)}`
    );
    return answer;
  };
}
