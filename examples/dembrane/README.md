# Dembrane prototypes

Prototypes built on Cloudflare Agents, each deployed as its own Worker. The landing page at https://dembrane-prototypes.patcon.workers.dev links to all of them.

| Folder                                                                           | What it is                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`2026-10-21-portal-admin-setup`](2026-10-21-portal-admin-setup)                 | A copy of `2026-10-20-portal-queued-interactions` to build on               |
| [`2026-10-20-portal-queued-interactions`](2026-10-20-portal-queued-interactions) | A voice session that collects a transcript while questions arrive           |
| [`design`](design)                                                               | RFCs not yet built in any prototype                                         |
| [`landing`](landing)                                                             | The landing page, built from the other folders' titles and descriptions     |
| [`packages/shared`](packages/shared)                                             | Code the prototypes share, used as TypeScript source (e.g. `withBasicAuth`) |
| [`packages/voice-gemini`](packages/voice-gemini)                                 | Gemini speech-to-text on Vertex AI (`@dembrane/voice-gemini`)               |
| [`scripts`](scripts)                                                             | Helpers for the deploy workflow                                             |

## Deploying

Pushes to `dembrane-examples` that touch this folder run [`.github/workflows/dembrane-deploy.yml`](../../.github/workflows/dembrane-deploy.yml). It deploys every folder here that has a `wrangler.jsonc` and a `deploy` script, each installed on its own against the npm releases of `agents` and `@cloudflare/ai-chat`, so a prototype can't rely on unreleased changes in `packages/`.

The workflow needs the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus every secret a prototype lists under `secrets.required` in its `wrangler.jsonc`.

## Adding a prototype

1. Create a folder here with a `package.json` (with a `description` and a `deploy` script), a `wrangler.jsonc` and an `index.html` whose `<title>` names it.
2. To put it behind a password, wrap its Worker's default export in `withBasicAuth` from `@dembrane/examples-shared/basic-auth`, set `"run_worker_first": true` under `assets`, and list `BASIC_AUTH_PASSWORD` under `secrets.required`.
3. Run `pnpm install` from the repo root, and add any new secrets to the repository.

It shows up on the landing page with its next deploy.

## RFCs

RFCs that haven't been built yet live in [`design`](design), so any prototype can pick them up. When a prototype implements one, move the RFC into that prototype's own `design` folder and set its status to `implemented`.
