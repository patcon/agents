// Helpers for .github/workflows/dembrane-deploy.yml, which deploys each
// Dembrane example as a standalone app, outside the monorepo.
//
//   node deploy.mjs apps
//     Prints a JSON array of the examples that can be deployed: folders
//     beside this one with a wrangler.jsonc and a "deploy" script.
//
//   node deploy.mjs standalone <out-dir>
//     Copies examples/dembrane into <out-dir> as a workspace of its own.
//     Siblings and packages/* still resolve through "workspace:*", and
//     dependencies on monorepo packages (agents, @cloudflare/ai-chat) switch
//     to the npm release matching the version in packages/.
//
//   node deploy.mjs secrets <app-dir> <out-file>
//     Writes the secrets the app's wrangler.jsonc lists under
//     secrets.required, taking values from the SECRETS_JSON environment
//     variable (the workflow's `toJSON(secrets)`), for
//     `wrangler deploy --secrets-file`.
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const examplesDir = new URL("..", import.meta.url).pathname;
const repoDir = join(examplesDir, "..", "..");
const skip = new Set(["node_modules", "dist", ".wrangler", ".vite"]);

const read = (path) => readFile(path, "utf8").catch(() => undefined);

// wrangler.jsonc allows comments and trailing commas; drop both, leaving
// anything inside strings alone
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

async function apps() {
  const found = [];
  for (const entry of await readdir(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(examplesDir, entry.name);
    const pkg = await read(join(dir, "package.json"));
    if (!pkg || !JSON.parse(pkg).scripts?.deploy) continue;
    if (!(await read(join(dir, "wrangler.jsonc")))) continue;
    found.push(entry.name);
  }
  console.log(JSON.stringify(found.sort()));
}

async function standalone(outDir) {
  await mkdir(outDir, { recursive: true });
  await cp(examplesDir, outDir, {
    recursive: true,
    filter: (src) =>
      !skip.has(basename(src)) && !basename(src).startsWith(".env")
  });

  const published = {};
  for (const entry of await readdir(join(repoDir, "packages"))) {
    const pkg = await read(join(repoDir, "packages", entry, "package.json"));
    if (!pkg) continue;
    const { name, version, private: isPrivate } = JSON.parse(pkg);
    if (!isPrivate) published[name] = `^${version}`;
  }

  const dirs = [
    ...(await readdir(outDir)),
    ...(await readdir(join(outDir, "packages"))).map((n) => `packages/${n}`)
  ];
  for (const dir of dirs) {
    const path = join(outDir, dir, "package.json");
    const text = await read(path);
    if (!text) continue;
    const pkg = JSON.parse(text);
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (range === "*" && published[name])
          pkg[field][name] = published[name];
      }
    }
    await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // Same pnpm as the monorepo, and the same native builds allowed
  const { packageManager } = JSON.parse(
    await readFile(join(repoDir, "package.json"), "utf8")
  );
  const root = { name: "dembrane-examples", private: true, packageManager };
  await writeFile(
    join(outDir, "package.json"),
    `${JSON.stringify(root, null, 2)}\n`
  );
  await writeFile(
    join(outDir, "pnpm-workspace.yaml"),
    [
      "packages:",
      '  - "*"',
      '  - "packages/*"',
      "allowBuilds:",
      "  core-js-pure: true",
      "  esbuild: true",
      "  sharp: true",
      "  workerd: true",
      ""
    ].join("\n")
  );
}

async function secrets(appDir, outFile) {
  const config = parseJsonc(
    await readFile(join(appDir, "wrangler.jsonc"), "utf8")
  );
  const required = config.secrets?.required ?? [];
  const available = JSON.parse(process.env.SECRETS_JSON ?? "{}");
  const missing = required.filter((name) => !available[name]);
  if (missing.length > 0) {
    console.error(`Missing GitHub secrets: ${missing.join(", ")}`);
    process.exit(1);
  }
  const values = Object.fromEntries(
    required.map((name) => [name, available[name]])
  );
  await writeFile(outFile, JSON.stringify(values));
  console.log(
    required.length > 0 ? `Secrets: ${required.join(", ")}` : "No secrets"
  );
}

const [command, ...args] = process.argv.slice(2);
if (command === "apps") await apps();
else if (command === "standalone") await standalone(args[0]);
else if (command === "secrets") await secrets(args[0], args[1]);
else {
  console.error(
    "Usage: deploy.mjs apps | standalone <out-dir> | secrets <app-dir> <out-file>"
  );
  process.exit(1);
}
