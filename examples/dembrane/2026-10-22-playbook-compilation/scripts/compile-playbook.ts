// Compiles a markdown playbook into a plan with COMPILE_MODEL, the way a
// host UI will: compilePlaybook() from src/compile.ts, with the prompts in
// src/prompts.
//
// Usage: pnpm compile-playbook src/playbooks/admin-setup.decompiled.md [--runs N]
// Writes src/plans/<the playbook's name>.compiled.json, or with --runs,
// .compiled.1.json and on, compiled in parallel. A run that ends with errors
// writes nothing. `pnpm compare-plans` says how close they came.

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { compilePlaybook } from "../src/compile.ts";
import { formatUsage, generator, loadEnv, root } from "./gemini.ts";

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt === -1 ? 1 : Number(args[runsAt + 1]);
const [playbookPath] = args.filter(
  (a, i) => !a.startsWith("--") && (runsAt === -1 || i !== runsAt + 1)
);
if (!playbookPath || !Number.isInteger(runs) || runs < 1) {
  console.error("Usage: pnpm compile-playbook <playbook.md> [--runs N]");
  process.exit(1);
}

const name = basename(playbookPath, ".md");
const markdown = readFileSync(playbookPath, "utf8");
const prompt = (file: string) =>
  readFileSync(join(root, "src/prompts", file), "utf8");
const prompts = {
  system: prompt("compile-playbook.md"),
  retry: prompt("compile-playbook-retry.md")
};

const env = loadEnv();
const model = env.COMPILE_MODEL;
const generate = generator(env, model);

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
    "src/plans",
    `${name}.compiled${runs === 1 ? "" : `.${outcome.run}`}.json`
  );
  writeFileSync(
    out,
    `${JSON.stringify({ $schema: "../plan.schema.json", ...plan }, null, 2)}\n`
  );
  console.log(`  wrote ${relative(root, out)}`);
}

process.exit(failed ? 1 : 0);
