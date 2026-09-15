# Agents SDK Playground

An interactive demo application showcasing the major feature areas of the Cloudflare Agents SDK. Use it to learn the SDK, test features, and understand how agents work.

## Getting Started

From this directory, build the workspace packages this example depends on once, then start the dev server:

```bash
pnpm install
(cd ../.. && pnpm build)
pnpm start
```

("Failed to resolve entry for package `@cloudflare/ai-chat`" / "`@cloudflare/codemode` ... could not be resolved" means those packages need (re)building. To build just what the playground needs, run `pnpm build` in `packages/agents`, `packages/ai-chat`, and `packages/codemode` instead of the whole monorepo.)

Visit http://localhost:5173 to explore the playground.

## Features

The playground is organized into feature categories, each with interactive demos:

### Core

| Demo            | Description                                                              |
| --------------- | ------------------------------------------------------------------------ |
| **State**       | Real-time state synchronization with `setState()` and `onStateChanged()` |
| **Callable**    | RPC methods using the `@callable` decorator                              |
| **Streaming**   | Streaming responses with `StreamingResponse`                             |
| **Schedule**    | One-time and recurring task scheduling                                   |
| **Connections** | WebSocket lifecycle, client tracking, and broadcasting                   |
| **SQL**         | Direct SQLite queries using `this.sql` template literal                  |
| **Routing**     | Agent naming strategies (per-user, shared, per-session)                  |
| **Readonly**    | Read-only agent access                                                   |
| **Retry**       | Retry with backoff and shouldRetry                                       |

### Durable Execution

| Demo       | Description                                           |
| ---------- | ----------------------------------------------------- |
| **Fibers** | Long-running work with checkpoints and recovery hooks |

### Multi-Agent

| Demo           | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| **Supervisor** | Manager-child agent pattern using `getAgentByName()` for RPC |
| **Chat Rooms** | Lobby with room agents for multi-user chat                   |
| **Workers**    | Fan-out parallel processing                                  |
| **Pipeline**   | Chain of responsibility pattern                              |

### AI

| Demo              | Description                                              |
| ----------------- | -------------------------------------------------------- |
| **Chat**          | `AIChatAgent` with message persistence and streaming     |
| **Tools**         | Client-side tool execution with confirmation flows       |
| **Codemode**      | AI code generation and editing                           |
| **Agent Tools**   | Delegate chat work to child agents with inline timelines |
| **Think + Shell** | Assistant runtime with durable workspace and state tools |

### MCP (Model Context Protocol)

| Demo             | Description                                             |
| ---------------- | ------------------------------------------------------- |
| **Server**       | Creating MCP servers with tools, resources, and prompts |
| **Client**       | Connecting to external MCP servers                      |
| **OAuth**        | OAuth authentication for MCP connections                |
| **Advanced MCP** | Transports, elicitation, codemode, and x402 patterns    |

### Workflows

| Demo         | Description                                              |
| ------------ | -------------------------------------------------------- |
| **Basic**    | Interactive multi-step workflow simulation with progress |
| **Approval** | Human-in-the-loop approval/rejection patterns            |

### Email

| Demo               | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| **Receive**        | Receive real emails via Cloudflare Email Routing              |
| **Secure Replies** | Send HMAC-signed replies for secure routing back to the agent |

> **Note:** Email demos require deployment to Cloudflare. A warning banner is shown when running locally.

### Product Integrations

| Demo                    | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| **Integration Stories** | Email, webhooks, push, A2A, x402, and browser-tool stories |

## Project Structure

```
playground/
├── src/
│   ├── demos/           # Demo pages and agent definitions
│   │   ├── core/        # State, callable, streaming, schedule, etc.
│   │   ├── ai/          # Chat, tools, codemode
│   │   ├── durable/     # Fibers and durable execution
│   │   ├── mcp/         # Server, client, OAuth
│   │   ├── multi-agent/ # Supervisor, chat rooms, workers, pipeline
│   │   ├── workflow/    # Basic, approval
│   │   ├── email/       # Receive, secure replies
│   │   └── integrations/ # Product integration explainers
│   ├── components/      # Shared UI components
│   ├── layout/          # App layout (sidebar, wrapper)
│   ├── hooks/           # React hooks (theme, userId, logs)
│   ├── pages/           # Home page
│   ├── client.tsx       # Client entry point
│   ├── server.ts        # Worker entry point
│   └── styles.css       # Tailwind styles
├── testing.md           # Manual testing guide
├── TODO.md              # Planned improvements
└── wrangler.jsonc       # Cloudflare configuration
```

## Testing

See [testing.md](./testing.md) for a comprehensive guide on manually testing every feature.

## Configuration

Each demo has its own Durable Object agent. The full list of agents and workflows is defined in `wrangler.jsonc`.

## AI Models

The AI and voice demos pick their model in `src/model.ts`. By default they use the
Workers AI binding (`@cf/moonshotai/kimi-k2.7-code`), so no API key is needed.

To run them through [OpenRouter](https://openrouter.ai) instead, set
`OPENROUTER_API_KEY` — `src/model.ts` then builds the model with
[`@openrouter/ai-sdk-provider`](https://openrouter.ai/docs/community/vercel-ai-sdk)
and ignores the Workers AI binding:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

The model is `openrouter/free`, OpenRouter's free-models router, which picks a
currently-free model for each request; change the slug in `src/model.ts` to use
a different one. Free models are rate limited, so expect occasional `429`s.

`OPENROUTER_API_KEY` is listed in `secrets.required` in `wrangler.jsonc` —
without that entry it would not be loaded from `.env` at all.

## Environment Variables

For the email demos, set `EMAIL_SECRET` for HMAC-signed replies:

```bash
# Production
wrangler secret put EMAIL_SECRET
```

For local development, add it to a `.env` file (see `.env.example`):

```
EMAIL_SECRET=your-secret-for-email-signing
OPENROUTER_API_KEY=sk-or-v1-...  # optional, see AI Models above
```

## Email Routing Setup

To test the email demos with real emails:

1. Deploy to Cloudflare: `npm run deploy`
2. Go to Cloudflare Dashboard → Email → Email Routing
3. Add a routing rule to forward emails to your Worker
4. Send emails to:
   - `receive+instanceId@yourdomain.com` → ReceiveEmailAgent
   - `secure+instanceId@yourdomain.com` → SecureEmailAgent

## Dark Mode

Click the theme toggle in the sidebar footer to switch between Light and Dark themes.
