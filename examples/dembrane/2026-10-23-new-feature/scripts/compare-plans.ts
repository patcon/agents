// Says how far compiled plans are from the plan they should reconstruct,
// with comparePlans() from src/shared/compile/compare-plans.ts. No model is called.
//
// Usage: pnpm compare-plans <expected.json> <compiled.json>...
// With one compiled plan, lists what differs. With several, tallies how many
// of them each difference shows up in. Exits 1 if anything differs; a
// rewording alone doesn't count.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { comparePlans, type Difference } from "../src/shared/compile/compare-plans.ts";
import { PlanSchema } from "../src/shared/plan/plan.ts";

const [expectedPath, ...actualPaths] = process.argv.slice(2);
if (!expectedPath || !actualPaths.length) {
  console.error("Usage: pnpm compare-plans <expected.json> <compiled.json>...");
  process.exit(1);
}

const read = (path: string) =>
  PlanSchema.parse(JSON.parse(readFileSync(path, "utf8")));
const expected = read(expectedPath);
const line = (d: Difference) => `${d.kind} ${d.where}: ${d.message}`;

let differs = false;
if (actualPaths.length === 1) {
  const found = comparePlans(expected, read(actualPaths[0]));
  console.log(`${basename(actualPaths[0])} against ${basename(expectedPath)}:`);
  console.log(
    found.length ? found.map((d) => `  ${line(d)}`).join("\n") : "  the same"
  );
  differs = found.some((d) => d.kind === "differs");
} else {
  const counts = new Map<string, number>();
  for (const path of actualPaths) {
    for (const d of comparePlans(expected, read(path))) {
      counts.set(line(d), (counts.get(line(d)) ?? 0) + 1);
      if (d.kind === "differs") differs = true;
    }
  }
  console.log(`${actualPaths.length} plans against ${basename(expectedPath)}:`);
  const sorted = [...counts].sort(
    ([a, x], [b, y]) => y - x || a.localeCompare(b)
  );
  console.log(
    sorted.length
      ? sorted.map(([l, n]) => `  ${n}/${actualPaths.length} ${l}`).join("\n")
      : "  all the same"
  );
}

process.exit(differs ? 1 : 0);
