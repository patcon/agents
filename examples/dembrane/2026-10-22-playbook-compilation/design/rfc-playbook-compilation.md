# RFC: Compiling a markdown playbook into a plan with Gemini

Status: implemented in [`2026-10-22-playbook-compilation`](..); a host UI doesn't call it yet.

## The problem

A session runs from a plan (`src/plan.ts`): a typed list of sections and prompts, and the triggers that release them. Plans are rigid on purpose, so the runtime can walk them and `lintPlan()` can check them. Nobody should have to write one. The admin setup plan, `src/plans/admin-setup.json`, was written by hand.

Hosts should write a playbook instead, in markdown and their own words, and a model should compile it into a plan. That raises two questions:

- **Can a model compile reliably?** The output has to pass Zod and the linter, and mean what the playbook meant.
- **How would we know?** We need a way to measure a compiled plan against what it should have been.

## The proposal

### Check the compiler by reconstructing a plan we already have

The hand-made plan is the evidence. We reach it again from another source, a playbook, and measure the distance:

```
src/plans/admin-setup.json ──decompile──▶ src/playbooks/admin-setup.decompiled.md
                                                       │
                                                    compile
                                                       ▼
            compiled/admin-setup.decompiled.json ──compare──▶ src/plans/admin-setup.json
```

Three scripts do it:

- **`pnpm decompile-plan <plan.json>`** has Gemini write the playbook for a plan. It's only how we got a first playbook. What it writes is ours, worded as closely as the plan, not a host's.
- **`pnpm compile-playbook <playbook.md> [--runs N]`** compiles a playbook, in parallel when `--runs` is given. It writes to `compiled/`, which isn't committed: a compile is one sample, and the comparison is what's worth keeping.
- **`pnpm compare-plans <expected.json> <compiled.json>...`** compares compiled plans with the expected one. It calls no model, so it's free to rerun. With several plans it tallies how many show each difference.

`comparePlans()` matches prompts by setting key and sections by title. It reports a difference in section, type, options, `required`, card, reading order, or **what releases an item**: the item's own triggers, or else its section's. So cueing a section and cueing each of its prompts count as the same. Ids and `order` strings don't count. Changed wording is reported apart, as "reworded".

### The playbook has no setting keys; a catalog does

A playbook is a `#` title, a `##` heading per section, and one bullet per question. Hosts don't know setting keys, so the playbook leaves them out. `src/settings.ts` lists the platform's portal settings instead, each with its key, what it controls in a host's words, its value shape and its options. That list goes into the system prompt, and the compiler maps the playbook's words to keys.

The catalog doesn't say which setting depends on which. That stays in the playbook ("only if Explore is on"), so turning it into triggers is the compiler's job and gets tested.

In the decompiled playbook, notes for the compiler go in square brackets, and everything outside them is the question word for word:

```markdown
- How should titles be written? (optional custom prompt) [optional] [only if Generate conversation titles and tags automatically? is Yes]
```

Without brackets, the compiler couldn't tell a note from the question: in one compile, 17 questions kept their notes in the text, and in the next, four lost real instructions ("Separate them with commas."). The compile prompt treats brackets as the clear case, and still asks for notes to be separated from questions when a host doesn't use them.

### One module, as a host UI will call it

```ts
compilePlaybook(markdown, { name, prompts: { system, retry }, generate, maxAttempts = 3 })
  → { plan?, messages, attempts, usage }
```

`src/compile.ts` reads no files and calls no API itself. The prompts are raw files in `src/prompts/` with `{{placeholders}}`, which the Worker would import with `?raw` and the scripts read from disk. `generate` is `generateJson()` with the model bound.

Each answer is checked with Zod, then `lintPlan()`. Any errors go back to Gemini as another turn (`compile-playbook-retry.md`), until the plan is clean or three attempts are used. The code sets `source` itself, rather than trusting the model: the playbook's name, plus the first 8 hex characters of a SHA-256 of its text as the version.

### Gemini enforces only part of JSON Schema

Vertex accepts the full plan schema as `responseJsonSchema` but doesn't enforce all of it. Probed with `gemini-3.8-flash`:

| Keyword                             | What happens                                     | So `toLlmSchema()`                |
| ----------------------------------- | ------------------------------------------------ | --------------------------------- |
| `oneOf`                             | Accepted, not enforced                           | Rewrites it as `anyOf`            |
| `const`                             | Accepted, not enforced: every `kind` was made up | Rewrites it as a one-value `enum` |
| `pattern` (Zod's date-time regexes) | Once branches are enforced, no answer in 90 s    | Drops it, along with `format`     |

Google documents a keyword list only for the older `responseSchema`, so this was found by testing, not looked up. Zod still checks whatever comes back.

### Low thinking

`COMPILE_THINKING` is `low`. It's as accurate as Gemini's default level, and much faster and steadier:

| Thinking         | Same as the hand-made plan             | Time        | Tokens out  | Cost each  |
| ---------------- | -------------------------------------- | ----------- | ----------- | ---------- |
| Gemini's default | 2 of 2 finished; 1 of 3 ran past 180 s | 44 s, 127 s | 6.8k, 17.4k | 3.2¢, 7.1¢ |
| `low`            | 10 of 10, each on its first attempt    | 14–28 s     | about 3.2k  | about 1.8¢ |

Each compile sends about 8.2k tokens. Most of that is the schema, which counts as input on every call. At low thinking, Gemini first wrapped the language card in an extra `Stack`, sometimes repeating the question inside it, where the default level hadn't. One sentence in the prompt fixed it: a card is only what goes between the question and Submit.

## The alternatives

- **Setting keys in the playbook.** That's simplest for the compiler, but hosts don't know the keys and shouldn't have to.
- **A simpler shape that code turns into a plan.** Once rewritten by `toLlmSchema()`, the plan schema works directly, which keeps one schema.
- **Echo's labels and stored values.** Echo stores `nl`, not `Dutch`, and calls Summarize "Default". Carrying labels and values through options would touch `Question`, Jev, conditions and the linter. That pays off only once something writes answers back to echo. The catalog keeps our wording, and our options.
- **A template that decompiles without a model.** That would just serialize the plan. A model writes prose, which is what tests the compiler.
- **Comparing inside `compile-playbook`.** Compiling costs money and comparing doesn't, and a host UI compiles without comparing.
- **Committing compiled plans.** Each is one sample of a model that isn't deterministic, and it's rewritten on every run.

## Open questions

- **A playbook a host writes.** The decompiled playbook is ours, close to the plan, and the catalog hands the compiler the exact options. How the compiler does on looser, host-written text isn't measured yet.
- **The catalog.** It was written by hand from the plan. Echo's `FormSchema` in `ProjectPortalEditor.tsx` is the real source. `default_conversation_ask_for_participant_details` is one checkbox where echo has two booleans.
- **Editing.** The compiler rewrites the whole plan. Edits made during a session would be smaller as `PlanOp`s.
- **Prices.** `gemini-3.8-flash` doubles in price on 2027-01-01.

## The decision

Accepted for the prototypes. Compile with `gemini-3.8-flash` (`COMPILE_MODEL`) at low thinking (`COMPILE_THINKING`), with the schema from `toLlmSchema()`, the settings catalog in the prompt, and Zod and lint errors sent back for up to three attempts. Measure prompt changes against a known plan with `compile-playbook --runs N` and `compare-plans`.

Next: compile a playbook a host writes, then call `compilePlaybook()` from the host UI.
