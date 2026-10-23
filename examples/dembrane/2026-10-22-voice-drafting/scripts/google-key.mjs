// Puts a service account's JSON key in .env as GOOGLE_SERVICE_ACCOUNT_KEY,
// on one line, leaving the other lines alone.
//
//   pnpm google-key path/to/key.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [path] = process.argv.slice(2);
if (!path) {
  console.error("Usage: pnpm google-key <key.json>");
  process.exit(1);
}
const key = JSON.stringify(JSON.parse(readFileSync(path, "utf8")));

const file = ".env";
const lines = existsSync(file)
  ? readFileSync(file, "utf8").split("\n")
  : readFileSync(".env.example", "utf8").split("\n");
// Single quotes keep the key's \n escapes as they are
const line = `GOOGLE_SERVICE_ACCOUNT_KEY='${key}'`;
const i = lines.findIndex((l) => l.startsWith("GOOGLE_SERVICE_ACCOUNT_KEY="));
if (i === -1) lines.push(line);
else lines[i] = line;
writeFileSync(file, lines.join("\n"));
console.log(`Wrote GOOGLE_SERVICE_ACCOUNT_KEY to ${file}`);
