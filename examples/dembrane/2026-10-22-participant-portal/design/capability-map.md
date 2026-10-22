# Capability map: hosts plan their participants' session

Status: draft, from the design discussion of 2026-10-22. Each module gets its own `spec-<module id>.md` beside this file before it's built; only `text-dictation` has one so far.

The goal: portal setup ends with the host describing, out loud, the session they want their participants to have. That becomes the project's participant plan, which anyone who isn't the host gets when they open the project.

| Module id        | Responsibility                                                          | Depends on      |
| ---------------- | ----------------------------------------------------------------------- | --------------- |
| `text-dictation` | What's said while a text question is on screen fills its field as a draft | —               |
| `planner`        | A plan item where the host describes a plan; it compiles, and they approve it | `text-dictation` |
| `projects`       | Project-level storage of the participant plan, roles, and project routes | `planner`       |

Build order: `text-dictation` → `planner` → `projects`

`text-dictation` and `planner` work on the single global session, as the prototype does today. Only `projects` touches routing and auth.

## `text-dictation`

Spec: [`spec-text-dictation.md`](spec-text-dictation.md).

In short: `foldLog()` gives each text question a draft from the utterances said while it was on screen. The page already shows a draft as "Filled in from what was said" and never submits it. Live interim text shows greyed. `"dictate": false` turns it off for a prompt. No new log entries.

## `planner`

A new plan item, `kind: "planner"`, placed at the end of the admin setup plan. It's its own kind rather than a `prompt`, because:

- its answer has a side effect: submitting starts a compile;
- it has states: drafting → compiling → review → approved (or back to drafting);
- what it produces is a plan to store, not a setting value.

How it should work:

1. **Drafting.** The host talks; the field fills by dictation, from `text-dictation`. They can edit it.
2. **Submit.** One LLM call tidies the ramble into playbook markdown (`#` title, `##` per section, a bullet per question): the format `compilePlaybook()` already reads.
3. **Review the playbook.** The host can edit the playbook text before compiling.
4. **Compile.** `compilePlaybook()` turns it into a plan, as `/platform-admin` does today: about 21 s per attempt, up to three attempts.
5. **Approve.** The page shows the playbook and a summary of the plan (via `compare-plans` against an empty plan: what's added). Approving is an `answer` entry on the planner item.

Why a playbook in between, not the plan JSON: the compiler already works (10 of 10 compiles of the decompiled admin setup matched the hand-made plan), and a host can read and fix markdown far more easily than approve a plan diff. It also means no decompile step is needed.

Where it runs: inside `ConversationAgent`, not in a Worker route, so a dropped connection doesn't lose the result. Results go in the log (e.g. a `plan-draft` entry), so the page picks them up from the log like everything else. The compile runs in a `runFiber()`, so a Durable Object restart mid-compile can be recovered from in `onFiberRecovered()`: retry, or log that it failed. Check `runFiber` against the current Agents SDK docs before building.

The card is a custom json-render component in `src/cards/registry.tsx`.

Carried over from `text-dictation`:

- After an edit, keep adding new speech after it, instead of stopping. Needs the draft to remember where the edit ended.
- Show interim text inline after the last word instead of on a line below, if the field gets long enough for it to matter.
- Maybe an LLM pass that tidies dictated text as it arrives, broadcast like `jev-preview` rather than logged.

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
