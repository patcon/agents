// Compiles a markdown playbook into a plan with COMPILE_MODEL, the way a
// host UI will: compilePlaybook() from src/shared/compile/compile.ts, with the prompts in
// src/shared/compile/prompts.
//
// Usage: pnpm compile-playbook src/shared/compile/playbooks/admin-setup.decompiled.md [--runs N] [--thinking level]
// --thinking overrides COMPILE_THINKING in wrangler.jsonc.
// Writes compiled/<the playbook's name>.json, or with --runs, .1.json and
// on, compiled in parallel. A run that ends with errors writes nothing.
// `pnpm compare-plans` says how close they came. compiled/ isn't committed:
// a compile is one sample of what the model does; the comparison is what's
// worth keeping.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { compilePlaybook } from "../src/shared/compile/compile.ts";
import { formatUsage, generator, loadEnv, root } from "./gemini.ts";

const args = process.argv.slice(2);
/** The value after `--name`, and its index, so it isn't taken for the playbook. */
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : { at: at + 1, value: args[at + 1] };
};
const runsFlag = flag("runs");
const thinkingFlag = flag("thinking");
const runs = runsFlag ? Number(runsFlag.value) : 1;
const [playbookPath] = args.filter(
  (a, i) => !a.startsWith("--") && i !== runsFlag?.at && i !== thinkingFlag?.at
);
if (!playbookPath || !Number.isInteger(runs) || runs < 1) {
  console.error(
    "Usage: pnpm compile-playbook <playbook.md> [--runs N] [--thinking level]"
  );
  process.exit(1);
}

const name = basename(playbookPath, ".md");
const markdown = readFileSync(playbookPath, "utf8");
const prompt = (file: string) =>
  readFileSync(join(root, "src/shared/compile/prompts", file), "utf8");
const prompts = {
  system: prompt("compile-playbook.md"),
  retry: prompt("compile-playbook-retry.md")
};

const env = loadEnv();
const model = env.COMPILE_MODEL;
// A whole plan takes a while: 50 s for the first one
const generate = generator(
  env,
  model,
  180_000,
  thinkingFlag?.value ?? env.COMPILE_THINKING
);

const results = await Promise.all(
  Array.from({ length: runs }, (_, i) =>
    compilePlaybook(markdown, { name, prompts, generate }).then(
      (result) => ({ run: i + 1, result }),
      (error: Error) => ({ run: i + 1, error })
    )
  )
);

let failed = false;
for (const outcome of results) {
  const label = runs === 1 ? name : `${name}, run ${outcome.run}`;
  if ("error" in outcome) {
    console.log(`\n${label}: failed: ${outcome.error.message}`);
    failed = true;
    continue;
  }
  const { plan, messages, attempts, usage } = outcome.result;
  console.log(
    `\n${label}: ${plan ? "compiled" : "gave up"} after ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}, ${formatUsage(model, usage)}`
  );
  attempts.forEach((attempt, i) => {
    const errors = attempt.messages.filter(
      (m) => m.severity === "error"
    ).length;
    console.log(
      `  attempt ${i + 1}: ${errors} error${errors === 1 ? "" : "s"}`
    );
  });
  for (const m of messages) {
    console.log(
      `  ${m.severity} ${m.rule}: ${m.itemId ? `${m.itemId}: ` : ""}${m.message}`
    );
  }
  if (!plan) {
    failed = true;
    continue;
  }
  const out = join(
    root,
    "compiled",
    `${name}${runs === 1 ? "" : `.${outcome.run}`}.json`
  );
  mkdirSync(join(root, "compiled"), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ $schema: "../src/shared/plan/plan.schema.json", ...plan }, null, 2)}\n`
  );
  console.log(`  wrote ${relative(root, out)}`);
}

process.exit(failed ? 1 : 0);
