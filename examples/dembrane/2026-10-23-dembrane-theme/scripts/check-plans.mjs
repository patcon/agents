// Writes src/shared/plan/plan.schema.json from the Zod schemas in src/shared/plan/plan.ts, and
// src/shared/plan/plan.llm.schema.json, the same for Gemini's structured output. Then
// checks every plan in src/shared/plan three ways: against that JSON Schema,
// against the Zod schema, and with lintPlan(). Exits 1 on any error.
//
// Usage: pnpm check-plans

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import { PlanSchema, lintPlan, planLlmSchema } from "../src/shared/plan/plan.ts";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "shared", "plan");

const schema = z.toJSONSchema(PlanSchema);
writeFileSync(
  join(src, "plan.schema.json"),
  `${JSON.stringify(schema, null, 2)}\n`
);
console.log("wrote src/shared/plan/plan.schema.json");

writeFileSync(
  join(src, "plan.llm.schema.json"),
  `${JSON.stringify(planLlmSchema(), null, 2)}\n`
);
console.log("wrote src/shared/plan/plan.llm.schema.json");

// Zod writes a `pattern` alongside each `format`, so formats can stay
// annotations rather than needing ajv-formats.
const validate = new Ajv2020({
  allErrors: true,
  validateFormats: false
}).compile(schema);

let failed = false;
// The schemas share the folder with the plans.
for (const file of readdirSync(src).filter(
  (f) => f.endsWith(".json") && !f.endsWith(".schema.json")
)) {
  const json = JSON.parse(readFileSync(join(src, file), "utf8"));
  const problems = [];

  // Zod's messages are the precise ones; Ajv lists a failure for every
  // branch of a oneOf. So Ajv only speaks up when it disagrees with Zod,
  // which would mean the generated schema doesn't say what plan.ts says.
  const parsed = PlanSchema.safeParse(json);
  if (validate(json) !== parsed.success) {
    problems.push(
      `error json-schema: disagrees with Zod (${parsed.success ? "rejects" : "accepts"} it)`
    );
    for (const e of validate.errors ?? []) {
      problems.push(`  ${e.instancePath || "/"} ${e.message}`);
    }
  }
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`error zod: /${issue.path.join("/")} ${issue.message}`);
    }
  } else {
    for (const m of lintPlan(parsed.data)) {
      problems.push(
        `${m.severity} ${m.rule}: ${m.itemId ? `${m.itemId}: ` : ""}${m.message}`
      );
    }
  }

  console.log(`\n${file}: ${problems.length ? "" : "ok"}`);
  for (const p of problems) console.log(`  ${p}`);
  if (problems.some((p) => p.startsWith("error"))) failed = true;
}

process.exit(failed ? 1 : 0);
