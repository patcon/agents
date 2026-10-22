// Turns a plan back into the markdown playbook a host would have written for
// it, with COMPILE_MODEL. It's not the main use: what it writes is a decompiled
// playbook, ours rather than a host's, worded as closely as the plan.
//
// Usage: pnpm decompile-plan src/plans/admin-setup.json [--force]
// Writes src/playbooks/<the plan's file name>.decompiled.md, and won't overwrite
// one unless --force says to.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { PlanSchema } from "../src/plan.ts";
import { generator, loadEnv, root } from "./gemini.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const [planPath] = args.filter((a) => !a.startsWith("--"));
if (!planPath) {
  console.error("Usage: pnpm decompile-plan <plan.json> [--force]");
  process.exit(1);
}

const plan = PlanSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
const out = join(
  root,
  "src/playbooks",
  `${basename(planPath, ".json")}.decompiled.md`
);
if (existsSync(out) && !force) {
  console.error(`${relative(root, out)} exists; --force overwrites it`);
  process.exit(1);
}

const env = loadEnv();
const generate = generator(env, env.COMPILE_MODEL);
const { json } = await generate({
  system: readFileSync(join(root, "src/prompts/decompile-plan.md"), "utf8"),
  prompt: JSON.stringify({ items: plan.items, triggers: plan.triggers }),
  schema: {
    type: "object",
    properties: { markdown: { type: "string" } },
    required: ["markdown"]
  }
});

mkdirSync(join(root, "src/playbooks"), { recursive: true });
writeFileSync(out, `${(json as { markdown: string }).markdown.trim()}\n`);
console.error(`wrote ${relative(root, out)}`);
