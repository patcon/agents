# Plan: compiling a markdown playbook into a Plan

Status: working plan, temporary. An RFC replaces this once it's built.

## Goal

Rebuild the hand-made `src/plans/admin-setup.json` from a plain markdown playbook, compiled by Gemini 3.8 on Vertex AI. The compiled plan should pass `PlanSchema` and `lintPlan()`, and come out close to the hand-made one. The compiler is the module a host UI will call later, not a script-only path.

This is a parallel reconstruction: the hand-made plan is the evidence, and we arrive at it again from another source, a playbook a host could have written. Where the two disagree, either the playbook, the prompt or the plan format is missing something.

```
plans/admin-setup.json ──decompile (Gemini)──▶ src/playbooks/admin-setup.decompiled.md
                                                     │
                                        compile (Gemini + lint loop)
                                                     ▼
                                  plans/admin-setup.compiled.json ──compare──▶ plans/admin-setup.json
```

Decompiling (plan → playbook) is only here to get a first playbook. Compiling is the main use.

Paths below are relative to `examples/dembrane/2026-10-22-playbook-compilation/`.

## Setup

- Copy `2026-10-22-jev` to `2026-10-22-playbook-compilation`, leaving out `dist/`, `.wrangler/` and `node_modules/`. Copy `.env` too, since it's gitignored and holds local credentials. Rename the Worker (`wrangler.jsonc`), the package (`package.json`, with a new `description`), the `<title>`, the header in `src/client.tsx`, and the README's heading and intro.
- Prototype names drop the date: the landing page already shows each folder's date beside its link, and the link text comes from `<title>`. So each prototype's `<title>` and the header in its `src/client.tsx` become the descriptive part of its folder name: `jev`, `portal-admin-setup`, `playbook-compilation`. `2026-10-20-portal-queued-interactions` already has a descriptive title (`Portal: Queued Interactions`) and no dated header.
- These are their own commits, before any compiler work.

## The playbook (`src/playbooks/admin-setup.decompiled.md`)

Markdown a host would write. Headings for sections, a line or two per question, conditions in plain words ("only if Explore is on"), and layout hints in plain words ("languages in two columns").

No setting keys, ids, `order` strings or trigger vocabulary. Hosts don't know the keys, and they shouldn't have to.

It's in `src/` because code reads it: the compile script, and the Worker once the host UI can load a playbook.

## Settings catalog: where the keys come from

The compiler still has to write `payload.key`, and conditions refer to keys. Rather than in the playbook, the keys live in a catalog of the platform's portal settings, interpolated into the system prompt:

- `src/settings.ts`: one entry per setting: `key`, what it means in a host's words, value type, allowed values where fixed.
- Derived by hand from `admin-setup.json` for now. The platform's own field definitions (echo's `ProjectPortalEditor.tsx`, `01-admin-portal`'s `src/shared/fields.ts`) aren't checked out locally.
- No dependencies between settings in the catalog ("mode only matters if Explore is on"). Those stay in the playbook, so compiling them is part of what's tested.
- A question in a playbook that matches no setting gets a key the compiler makes up. Worth a lint warning later ("no such setting"), not now.

## The system prompt (`src/prompts/compile-playbook.md`)

A raw file with `{{placeholders}}`, loaded and substituted at run time. Finding a prompt that's enough is part of this work. Keep it short and plain: what a Plan is, the platform rules the linter enforces (one consent item, first, locked, the only thing cued at `start`; everything else waits on `consented`), how prose conditions map to trigger kinds, and to use the catalog's keys.

Placeholders, to start:

- `{{settings}}`: the catalog, rendered as one line per setting.

The schema goes in `responseJsonSchema`, not the prompt; its `.describe()` text carries the field-level detail. The playbook is the user turn.

Loading: the Worker imports it with Vite's `?raw`; Node scripts read it with `readFileSync`. `compile.ts` takes the template as a string, so it doesn't care which.

## Response schema (`src/plan.llm.schema.json`)

`plan.schema.json` uses `oneOf`, a recursive `$ref`, `pattern`/`format`, `propertyNames` and a `$schema` property; Vertex's `responseJsonSchema` may reject some of them. First step is a live call to find which. Then `toLlmSchema()` in `plan.ts` strips only what fails, and `check-plans` writes the result alongside `plan.schema.json`.

Gemini answers with a whole `Plan`, `order` strings included. No intermediate shape.

Probed 2026-10-22 against `gemini-3.8-flash` with a tiny plan (each call ~7–10k tokens in, 1–2k out, about 1–1.5 ¢):

- `oneOf` and `const` are accepted but not enforced: Gemini wrote `kind`s that don't exist. `anyOf` and a one-value `enum` are enforced.
- With branches enforced, the date-time `pattern`s stall the answer (nothing in 90 s); without them it answers in ~15 s.
- The recursive `$ref` and `propertyNames` are accepted; neither was exercised by the tiny plan.

Google documents a keyword list for the older `responseSchema`, not for `responseJsonSchema`, so these are found, not looked up.

## Compiler (`src/compile.ts`)

```ts
compilePlaybook(markdown, { template, settings, generate, maxAttempts = 3 })
  → { plan?, lint: LintMessage[], attempts, usage }
```

- `generate` has `generateJson`'s signature. The Worker passes the real one; scripts pass it an env read from `.env`; tests pass a stub.
- Loop: Gemini → `PlanSchema.safeParse` → `lintPlan`. Zod issues and lint errors go back as a follow-up turn until clean or out of attempts.
- `gemini.ts` gains an optional `temperature`, multi-turn `contents`, and a `model` argument in place of reading `AGENT_MODEL` directly.
- Compiling uses its own model, `COMPILE_MODEL` in `wrangler.jsonc`, defaulting to `gemini-3.8-flash`, so it can move to a Pro model without touching the agent.
- Later: `@callable() compilePlaybook(markdown)` on the agent for the host UI. Not in this work.

## Comparison (`src/compare-plans.ts`)

A semantic diff. Flatten both plans to reading order, match prompts by `key` and sections by title, and report: missing or extra items, a prompt in a different section, differing type, options, `required` or card, and differing triggers (by condition and target; trigger ids ignored). Prompt wording differences are reported as "reworded" and don't count against closeness. `order` strings are ignored.

## Scripts

- `pnpm decompile-plan src/plans/admin-setup.json`: writes `src/playbooks/admin-setup.decompiled.md`. Its own raw prompt (`src/prompts/decompile-plan.md`), told not to mention keys. ~~The output gets tidied by hand.~~ What it writes is a decompiled playbook (`*.decompiled.md`): ours, worded as closely as the plan, and left as generated. One a host writes comes later.
- `pnpm compile-playbook src/playbooks/admin-setup.decompiled.md`: writes `src/plans/admin-setup.compiled.json`, prints lint, attempts and tokens, then compares against the plan with the same `source.playbook`. `--runs N` compiles N times in parallel and reports how often each difference shows up, since one clean run doesn't mean the prompt is enough.

## Order of work

One commit per step, no amends.

0. Setup above: drop dates from prototype names; copy jev to `2026-10-22-playbook-compilation`.
1. Live probe of `plan.schema.json` against Vertex; `toLlmSchema()`; `check-plans` emits it.
2. `gemini.ts`: temperature, multi-turn, model argument; `COMPILE_MODEL`.
3. `settings.ts` catalog.
4. `compile.ts`, prompt template loader, `compare-plans.ts`; a stub-`generate` test of the retry loop.
5. `decompile-plan` and its prompt. Generate ~~and tidy~~ `src/playbooks/admin-setup.decompiled.md`.
6. `compile-playbook` and its prompt. Iterate on the prompt until the comparison is clean, or record what stays different.
7. README section. Then the RFC, and this file goes.
