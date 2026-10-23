// Writes dist/index.html: one link per sibling example, i.e. each folder in
// examples/dembrane with a wrangler.jsonc, other than this one.
//
// Links point at each Worker's workers.dev address, so set
// WORKERS_DEV_SUBDOMAIN to the account's subdomain (the "<subdomain>" in
// https://<worker>.<subdomain>.workers.dev).
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const here = new URL("..", import.meta.url).pathname;
const examplesDir = join(here, "..");
const subdomain = process.env.WORKERS_DEV_SUBDOMAIN;
if (!subdomain) {
  console.warn(
    "WORKERS_DEV_SUBDOMAIN isn't set, so links use a <subdomain> placeholder"
  );
}

const read = (path) => readFile(path, "utf8").catch(() => undefined);
const escape = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );

const examples = [];
for (const entry of await readdir(examplesDir, { withFileTypes: true })) {
  const dir = join(examplesDir, entry.name);
  if (!entry.isDirectory() || entry.name === "landing") continue;
  const wrangler = await read(join(dir, "wrangler.jsonc"));
  if (!wrangler) continue;
  // The Worker's own name is the first "name" in the file
  const worker = wrangler.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
  if (!worker) continue;
  const pkg = JSON.parse((await read(join(dir, "package.json"))) ?? "{}");
  const html = await read(join(dir, "index.html"));
  examples.push({
    // Folders named like 2026-10-20-some-prototype show that date
    date: entry.name.match(/^\d{4}-\d{2}-\d{2}/)?.[0],
    title: html?.match(/<title>([^<]*)<\/title>/)?.[1] ?? entry.name,
    description: pkg.description ?? "",
    url: `https://${worker}.${subdomain ?? "<subdomain>"}.workers.dev`
  });
}
// Newest first, then anything undated by title
examples.sort(
  (a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title)
);

const items = examples
  .map(
    (e) => `      <li>${
      e.date
        ? `
        <time datetime="${e.date}">${e.date}</time>`
        : ""
    }
        <a href="${escape(e.url)}">${escape(e.title)}</a>
        <p>${escape(e.description)}</p>
      </li>`
  )
  .join("\n");

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dembrane examples</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #fafafa;
        --fg: #1a1a1a;
        --muted: #666;
        --link: #0b57d0;
        --border: #e2e2e2;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #141414;
          --fg: #ececec;
          --muted: #9a9a9a;
          --link: #8ab4f8;
          --border: #2c2c2c;
        }
      }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.5 system-ui, sans-serif;
      }
      main {
        max-width: 40rem;
        margin: 0 auto;
        padding: 3rem 1rem;
      }
      h1 {
        font-size: 1.5rem;
        margin: 0 0 1.5rem;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        padding: 1rem 0;
        border-top: 1px solid var(--border);
      }
      time {
        display: block;
        color: var(--muted);
        font-size: 0.8rem;
        font-variant-numeric: tabular-nums;
      }
      a {
        color: var(--link);
        font-weight: 600;
      }
      p {
        margin: 0.25rem 0 0;
        color: var(--muted);
      }
      .intro {
        margin: 0 0 1.5rem;
      }
      .intro a {
        font-weight: normal;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Dembrane examples</h1>
      <p class="intro">
        Source:
        <a href="https://github.com/patcon/dembrane-prototypes/tree/dembrane-examples/examples/dembrane">patcon/dembrane-prototypes</a>.
        The password is written on the bottom-left corner of the office
        whiteboard, or ask <a href="https://github.com/patcon">@patcon</a>.
      </p>
      <ul>
${items}
      </ul>
    </main>
  </body>
</html>
`;

await mkdir(join(here, "dist"), { recursive: true });
await writeFile(join(here, "dist", "index.html"), page);
console.log(`Wrote dist/index.html with ${examples.length} example(s)`);
