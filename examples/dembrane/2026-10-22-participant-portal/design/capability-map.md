# Capability map: hosts plan their participants' session

Status: draft, from the design discussion of 2026-10-22. Each module gets its own `spec-<module id>.md` beside this file before it's built; only `text-dictation` has one so far, and it's built.

The goal: portal setup ends with the host describing, out loud, the session they want their participants to have. That becomes the project's participant plan, which anyone who isn't the host gets when they open the project.

| Module id        | Responsibility                                                          | Depends on      |
| ---------------- | ----------------------------------------------------------------------- | --------------- |
| `text-dictation` | What's said while a text question is on screen fills its field as a draft | —               |
| `voice-drafting` | An LLM writes the field's draft from what was said, following the field's hints and the speaker's own asks | `text-dictation` |
| `planner`        | A plan item where the host describes a plan; it compiles, and they approve it | ~~`text-dictation`~~ `voice-drafting` |
| `projects`       | Project-level storage of the participant plan, roles, and project routes | `planner`       |

Build order: ~~`text-dictation` → `planner` → `projects`~~ `text-dictation` → `voice-drafting` (slice 1.1) → `planner` → `projects`

`text-dictation`, `voice-drafting` and `planner` work on the single global session, as the prototype does today. Only `projects` touches routing and auth.

## `text-dictation`

Spec: [`spec-text-dictation.md`](spec-text-dictation.md).

In short: `foldLog()` gives each text question a draft from the utterances said while it was on screen. The page already shows a draft as "Filled in from what was said" and never submits it. Live interim text shows greyed. `"dictate": false` turns it off for a prompt. No new log entries.

## `voice-drafting`

Slice 1.1, added 2026-10-22 once `text-dictation` was built: verbatim dictation is one way to draft, but people speak conversationally. They ramble, correct themselves and circle back. What we want in the field is what they mean, written the way the field asks for.

Named after the codebase's word for a field's working text, its *draft*. Voice apps call the same idea "smart dictation" (Monologue), "AI rewriting" (Wispr Flow) or custom "modes" (Superwhisper); research calls it "writing with speech" (Google's Rambler). "Paraphrase" was set aside as too narrow (restating, not condensing or keeping their words when asked), and "spoken intent" because in voice assistants an intent is a classified command, which is closer to Jev's job.

Decided so far:

- **The default for text questions.** A text question is voice-drafted unless its plan prompt says otherwise. `"dictate": false` still turns off drafting from speech altogether.
- **Hints, not modes.** A plan prompt can carry `draftHints`, natural language about style and length ("two or three sentences, plain language"; "a comma-separated list of short tags"). A playbook author writes them as prose, and the compiler carries them over. With no hints, the draft is a clean, faithful version of what they said.
- **The speaker can steer it.** What they say about the draft is treated as an instruction, not content: "just write exactly what I said", "shorter", "drop the bit about parking". So verbatim is something to ask for, by the field's hints or out loud, not a separate mode.
- **A rewrite after each utterance.** Each final utterance for a question (by the question it was started on, as now) starts a rewrite of the whole draft. It's given the question, its hints, every utterance for it in order, and the previous draft. One call per question is in flight; whatever arrives meanwhile is covered by one more after it, as Jev's runs are.
- **Verbatim dictation stays as the live layer.** The fold's draft is the latest LLM draft followed by the utterances it hasn't seen yet, verbatim, and the interim text greyed after that. So words show as soon as they're said, and the next draft takes them in. Before the first draft arrives, the field is exactly what `text-dictation` shows today.
- **Logged.** Each draft is a new log entry (e.g. `kind: "draft"`, `subjectId` the question, with the text, the last utterance it saw and the model), so every device and the server fold the same draft, and it's clear afterwards what the LLM wrote. Adding a log entry kind and an LLM pass were both "ask first" in the `text-dictation` spec; this module is that ask.
- **Typing stops it, as now.** Once the person changes the text, it's theirs, and drafting stops for that field. Revising around their edits stays a `planner` question.
- **Only what was said.** The draft may reorganise, condense and fix grammar, but adds nothing they didn't say. The prompt says so; a check (perhaps Jev judging the draft against the transcript, as in `rfc-jev-certainty.md`) can come later.
- **In the speaker's language.** The draft follows the language spoken, not the hints' language, unless the hints say otherwise.
- **Same model and tally as the agent's question.** `gemini-3.8-flash` through `src/models/gemini.ts` with a JSON schema, at low thinking; calls and tokens go in the log drawer's cost estimate. The prompt is a file beside the compiler's prompts.
- **If it fails,** the verbatim text stays, so nothing is lost.

To decide in the spec:

- **A no-LLM verbatim path.** Whether a prompt can ask for plain dictation without any LLM call (for cost, or where sending text to a model isn't wanted), e.g. `"draft": "verbatim"`, or whether hints cover it.
- **Field name:** `draftHints`, or `hints` if cards might use it for more than drafting.
- **Context:** whether the LLM sees earlier answers in the session, which helps with "same as before" but widens what each call sends.
- **Showing the work:** a "Drafting…" sign while a rewrite is in flight, and whether the person can see the verbatim transcript beside the draft, to trust it.
- **Number questions:** whether drafting can fill them from speech ("about fifty, maybe sixty" → 60), or they stay out of scope.

## `planner`

A new plan item, `kind: "planner"`, placed at the end of the admin setup plan. It's its own kind rather than a `prompt`, because:

- its answer has a side effect: submitting starts a compile;
- it has states: drafting → compiling → review → approved (or back to drafting);
- what it produces is a plan to store, not a setting value.

How it should work:

1. **Drafting.** The host talks; the field fills by ~~dictation, from `text-dictation`~~ voice drafting, with hints asking for playbook markdown (`#` title, `##` per section, a bullet per question). They can edit it.
2. ~~**Submit.** One LLM call tidies the ramble into playbook markdown (`#` title, `##` per section, a bullet per question): the format `compilePlaybook()` already reads.~~ **Submit.** The draft is already a playbook, the format `compilePlaybook()` reads, so no separate tidying call is needed.
3. **Review the playbook.** The host can edit the playbook text before compiling.
4. **Compile.** `compilePlaybook()` turns it into a plan, as `/platform-admin` does today: about 21 s per attempt, up to three attempts.
5. **Approve.** The page shows the playbook and a summary of the plan (via `compare-plans` against an empty plan: what's added). Approving is an `answer` entry on the planner item.

Why a playbook in between, not the plan JSON: the compiler already works (10 of 10 compiles of the decompiled admin setup matched the hand-made plan), and a host can read and fix markdown far more easily than approve a plan diff. It also means no decompile step is needed.

Where it runs: inside `ConversationAgent`, not in a Worker route, so a dropped connection doesn't lose the result. Results go in the log (e.g. a `plan-draft` entry), so the page picks them up from the log like everything else. The compile runs in a `runFiber()`, so a Durable Object restart mid-compile can be recovered from in `onFiberRecovered()`: retry, or log that it failed. Check `runFiber` against the current Agents SDK docs before building.

The card is a custom json-render component in `src/cards/registry.tsx`.

Carried over from `text-dictation`:

- After an edit, keep adding new speech after it, instead of stopping. Needs the draft to remember where the edit ended.
- ~~Show interim text inline after the last word instead of on a line below, if the field gets long enough for it to matter.~~ Done in `text-dictation`.
- ~~Maybe an LLM pass that tidies dictated text as it arrives, broadcast like `jev-preview` rather than logged.~~ Now `voice-drafting`, and logged.
- A `rows` prop on `TextInput` for a taller field than the default eight lines.

Open: where an approved plan is kept until `projects` exists. Probably in the conversation's log only, read by `/platform-admin`'s swap-in or a dev route.

## `projects`

Decided so far:

- **One participant plan per project**, made only through portal setup, and the project's default for anyone who isn't the host.
- **A `ProjectAgent` Durable Object per project** (`getByName(projectId)`), holding the participant plan, the settings portal setup produces, and later its admins. A conversation is its own object, as now. One object per project, never one global object.
- **On approval**, the setup conversation sends the plan to `ProjectAgent` with a server-side RPC call.
- **The server picks the plan, not the page.** Today `open()` takes the plan the page passes from localStorage (`activePlanArgs()`), so a participant could run the admin plan. Instead, `routeAgentRequest`'s `onBeforeConnect` decides the role and passes it as `props`; the conversation fixes its plan on its first `open()`, admin setup or the project's participant plan, and it can't change after.
- **Routes.** The page is at `/:projectId/conversation/:conversationId`, matching the earlier domain. Host setup is at a subpath like `/:projectId/setup`, but the role is checked on the server, not taken from the URL. The page connects with `useAgent({ agent: "ConversationAgent", name: \`${projectId}:${conversationId}\` })`, so `routeAgentRequest` stays as it is.
- **`/platform-admin` is removed**, as its TODO already says; this replaces it.

To decide:

- **`jurisdiction: "eu"`.** These objects hold voice transcripts, and it can only be set when an object is created. Cheap now, costly once real data exists. Decide before anything is deployed with real people.
- **How a host is identified.** Basic auth guards the whole Worker today; roles need something per user.
- Later, beyond this map: more than one plan per project, with a permission for who can run each.
