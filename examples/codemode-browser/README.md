# Browser Codemode Example

A minimal codemode app where the LLM calls a single `codemode` client tool, and
that tool runs generated JavaScript in a browser iframe sandbox via
`IframeSandboxExecutor`.

This example is intentionally separate from `examples/codemode`, which remains
the server-side `DynamicWorkerExecutor` example with SQLite-backed tools and MCP
server management.

## What it demonstrates

**Server (`src/server/`):**

- `AIChatAgent` with `createToolsFromClientSchemas()`
- no server-side code executor — the server only streams model responses and
  advertises client-provided tool schemas
- the workspace (projects, tasks, side-panel view) stored as agent state, so it
  survives reloads and syncs across tabs

**Client (`src/client/`), sharing `src/shared/schemas.ts` with the server:**

- `createBrowserCodeTool()` from `@cloudflare/codemode/browser`
- `IframeSandboxExecutor` for sandboxed browser execution
- `useAgentChat({ tools, onToolCall })` to execute the client-side codemode tool
- browser tools that change a live workspace shown in a side panel; edits you
  make by hand there are visible to the agent
- agent-rendered views: the model describes a view as data (task list, project
  summary, table, form) and the page renders it with its own components
- forms bound to a tool: submitting runs the tool directly in the page, with no
  chat message or model turn

| File                                | Role                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/shared/schemas.ts`             | zod schemas: types, argument validation, and the JSON Schema the model sees as TypeScript types |
| `src/client/workspace.ts`           | the actions that change projects, tasks and the view                                            |
| `src/client/tools.ts`               | the `codemode.*` tools: thin, validated wrappers around the actions                             |
| `src/client/store.ts`               | the external store shared by the tools and React                                                |
| `src/client/use-workspace-agent.ts` | connects to the agent and persists the workspace as its state                                   |
| `src/client/views.tsx`              | components for agent-rendered views                                                             |
| `src/client/side-panel.tsx`         | the workspace side panel                                                                        |
| `src/client/tool-card.tsx`          | renders a codemode tool call in the chat                                                        |
| `src/client/index.tsx`              | app wiring                                                                                      |

## Running

```bash
npm install   # from repo root
npm run build --workspace agents
npm run build --workspace @cloudflare/ai-chat
npm run build --workspace @cloudflare/codemode
npm start     # from this directory
```

Uses Workers AI through the `AI` binding.

For security details and current browser iframe limitations, see
[`docs/agents/codemode.md`](../../docs/agents/codemode.md#security-considerations).

## Try it

- "Create a project called Alpha with three tasks, then show a project summary"
- "Show me a form to add tasks to Alpha" — then add a few; the agent isn't
  messaged for each one
- Tick a task off in the side panel, then ask "What's done so far?"
- Reload the page: the workspace comes back. **Clear** resets the chat and the
  workspace.
- "What is the current page title?"
