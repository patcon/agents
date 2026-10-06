import { routeAgentRequest } from "agents";
import { AIChatAgent, createToolsFromClientSchemas } from "@cloudflare/ai-chat";
import { convertToModelMessages, streamText, isStepCount } from "ai";
import { createWorkersAI } from "workers-ai-provider";

/**
 * The browser owns the workspace (projects, tasks, side-panel view); the
 * agent only stores it so it survives reloads and syncs across tabs. Its
 * shape is defined client-side in `store.ts`.
 */
type WorkspaceState = { projects: unknown[]; tasks: unknown[]; view: unknown };

export class BrowserCodemode extends AIChatAgent<Env, WorkspaceState> {
  initialState: WorkspaceState = { projects: [], tasks: [], view: null };

  async onChatMessage(
    _onFinish?: unknown,
    options?: {
      clientTools?: Parameters<typeof createToolsFromClientSchemas>[0];
    }
  ) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/zai-org/glm-4.7-flash", {
        sessionAffinity: this.sessionAffinity
      }),
      instructions:
        "You are a browser codemode assistant. " +
        "Use the codemode tool to write JavaScript that calls functions on the `codemode` object. " +
        "The generated code runs in an iframe sandbox in the user's browser and can call browser-provided tools.",
      messages: await convertToModelMessages(this.messages),
      tools: createToolsFromClientSchemas(options?.clientTools),
      stopWhen: isStepCount(10)
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
