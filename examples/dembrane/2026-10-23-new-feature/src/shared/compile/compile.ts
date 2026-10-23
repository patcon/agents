import type { TokenUsage, Turn } from "../../server/models/gemini";
import {
  PlanSchema,
  lintPlan,
  fromLlmPlan,
  planLlmSchema,
  type LintMessage,
  type Plan
} from "../plan/plan";
import { SETTINGS, settingsForPrompt, type Setting } from "../plan/settings";

// Compiling a markdown playbook into a plan: a model writes it, and Zod and
// lintPlan() check it. Whatever they object to goes back to the model,
// until the plan is clean or the attempts run out.
//
// This is what a host UI calls, so it reads no files and calls no API
// itself. The prompts and the model come in as arguments: the Worker imports
// src/shared/compile/prompts/*.md with `?raw` and passes generateJson(), and scripts read
// the prompts from disk.

/** Asks the model once. generateJson() with the env and model bound. */
export type Generate = (request: {
  system: string;
  prompt: Turn[];
  schema: object;
}) => Promise<{ json: unknown; usage: TokenUsage }>;

export type Attempt = {
  /** What the model answered, as it answered it. */
  json: unknown;
  /** Zod's objections and lintPlan()'s messages, warnings included. */
  messages: LintMessage[];
  usage: TokenUsage;
};

export type Compiled = {
  /** The plan, when an attempt had no errors. */
  plan?: Plan;
  /** The last attempt's messages: warnings, or the errors it gave up on. */
  messages: LintMessage[];
  attempts: Attempt[];
  usage: TokenUsage;
};

/**
 * Fills each `{{name}}` in a template. Throws when a placeholder has no
 * value or a value has no placeholder, so a template and its caller can't
 * drift apart quietly.
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>
): string {
  const used = new Set<string>();
  const filled = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in values)) throw new Error(`no value for {{${name}}}`);
    used.add(name);
    return values[name];
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length)
    throw new Error(`no {{${unused.join("}}, {{")}}} in the template`);
  return filled;
}

/** Zod's objections, or lintPlan()'s messages, in one shape. */
export function checkPlan(json: unknown): {
  plan?: Plan;
  messages: LintMessage[];
} {
  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    return {
      messages: parsed.error.issues.map((issue) => ({
        rule: "schema",
        severity: "error",
        message: `/${issue.path.join("/")}: ${issue.message}`
      }))
    };
  }
  return { plan: parsed.data, messages: lintPlan(parsed.data) };
}

function describe(message: LintMessage) {
  return `- ${message.rule}: ${message.itemId ? `${message.itemId}: ` : ""}${message.message}`;
}

/** A short hash of the playbook's text, so a plan says which text it came from. */
async function versionOf(markdown: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(markdown)
  );
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function compilePlaybook(
  markdown: string,
  options: {
    /** What `source.playbook` says, e.g. the file's name. */
    name: string;
    prompts: {
      /** src/shared/compile/prompts/compile-playbook.md: the system prompt, with `{{settings}}`. */
      system: string;
      /** src/shared/compile/prompts/compile-playbook-retry.md: asks again, with `{{errors}}`. */
      retry: string;
    };
    generate: Generate;
    settings?: Setting[];
    maxAttempts?: number;
  }
): Promise<Compiled> {
  const {
    name,
    prompts,
    generate,
    settings = SETTINGS,
    maxAttempts = 3
  } = options;
  const system = fillTemplate(prompts.system, {
    settings: settingsForPrompt(settings)
  });
  const schema = planLlmSchema();
  const source = { playbook: name, version: await versionOf(markdown) };

  const turns: Turn[] = [{ role: "user", text: markdown }];
  const attempts: Attempt[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  while (attempts.length < maxAttempts) {
    const answer = await generate({ system, prompt: turns, schema });
    usage.inputTokens += answer.usage.inputTokens;
    usage.outputTokens += answer.usage.outputTokens;

    // The model's `source` is a guess; this one is the truth.
    const written = fromLlmPlan(answer.json);
    const json =
      written && typeof written === "object"
        ? { ...written, source }
        : written;
    const { plan, messages } = checkPlan(json);
    attempts.push({ json: answer.json, messages, usage: answer.usage });

    const errors = messages.filter((m) => m.severity === "error");
    if (plan && !errors.length) return { plan, messages, attempts, usage };

    turns.push(
      { role: "model", text: JSON.stringify(answer.json) },
      {
        role: "user",
        text: fillTemplate(prompts.retry, {
          errors: errors.map(describe).join("\n")
        })
      }
    );
  }
  return { messages: attempts.at(-1)?.messages ?? [], attempts, usage };
}
