import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat, type AITool } from "@cloudflare/ai-chat/react";
import {
  IframeSandboxExecutor,
  createBrowserCodeTool,
  type JsonSchemaExecutableToolDescriptor,
  type JsonSchemaExecutableToolDescriptors
} from "@cloudflare/codemode/browser";
import type { z } from "zod";
import { isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  PoweredByCloudflare,
  Surface,
  Text
} from "@cloudflare/kumo";
import {
  BrainIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CodeIcon,
  LightningIcon,
  PaperPlaneRightIcon,
  TerminalIcon,
  TrashIcon,
  WarningCircleIcon,
  MoonIcon,
  SunIcon
} from "@phosphor-icons/react";
import { appStore } from "./store";
import {
  emptyWorkspace,
  parseArgs,
  toolArgs,
  toolInputSchema,
  type ToolName,
  type Workspace
} from "./schemas";
import { SidePanel, type FormHandlers } from "./side-panel";
import "./styles.css";

type ToolPart = {
  type: string;
  state?: string;
  errorText?: string;
  input?: { code?: string; [key: string]: unknown };
  output?: { code?: string; result?: unknown; logs?: string[] };
};

function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

/**
 * Build a browser tool from its zod schema: the model sees the generated
 * JSON Schema, arguments are validated before `run`, and thrown errors come
 * back to the model as `{ error }` so it can correct itself.
 */
function defineTool<Name extends ToolName>(
  name: Name,
  description: string,
  run: (args: z.output<(typeof toolArgs)[Name]>) => unknown
): JsonSchemaExecutableToolDescriptor {
  return {
    description,
    inputSchema: toolInputSchema(
      name
    ) as JsonSchemaExecutableToolDescriptor["inputSchema"],
    execute: async (input) => {
      try {
        const args = parseArgs(toolArgs[name], input);
        return await run(args as z.output<(typeof toolArgs)[Name]>);
      } catch (error) {
        return { error: (error as Error).message };
      }
    }
  };
}

const browserTools: JsonSchemaExecutableToolDescriptors = {
  getPageInfo: defineTool(
    "getPageInfo",
    "Get information about the current browser page",
    () => ({ title: document.title, url: location.href })
  ),
  getState: defineTool(
    "getState",
    "Get all projects and tasks, including edits the user made by hand in the side panel. Call this before modifying existing data.",
    () => {
      const { projects, tasks } = appStore.get();
      return { projects, tasks };
    }
  ),
  createProject: defineTool(
    "createProject",
    "Create a project (shown live in the user's side panel)",
    ({ name }) => {
      const project = { id: nextId(appStore.get().projects), name };
      appStore.set((s) => ({ ...s, projects: [...s.projects, project] }));
      return project;
    }
  ),
  listProjects: defineTool(
    "listProjects",
    "List projects",
    () => appStore.get().projects
  ),
  createTask: defineTool(
    "createTask",
    "Create a task in a project",
    ({ projectId, title }) => {
      if (!appStore.get().projects.some((p) => p.id === projectId)) {
        throw new Error("Project not found");
      }
      const task = {
        id: nextId(appStore.get().tasks),
        projectId,
        title,
        done: false
      };
      appStore.set((s) => ({ ...s, tasks: [...s.tasks, task] }));
      return task;
    }
  ),
  listTasks: defineTool(
    "listTasks",
    "List tasks, optionally by project",
    ({ projectId }) => {
      const { tasks } = appStore.get();
      return projectId == null
        ? tasks
        : tasks.filter((task) => task.projectId === projectId);
    }
  ),
  updateTask: defineTool(
    "updateTask",
    "Update a task's title or done status",
    ({ id, title, done }) => {
      const task = appStore.get().tasks.find((item) => item.id === id);
      if (!task) throw new Error("Task not found");
      const updated = {
        ...task,
        ...(title !== undefined && { title }),
        ...(done !== undefined && { done })
      };
      appStore.set((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === id ? updated : t))
      }));
      return updated;
    }
  ),
  deleteTask: defineTool(
    "deleteTask",
    "Delete a task. The user is asked to confirm; returns an error if they decline.",
    ({ id }) => {
      const task = appStore.get().tasks.find((item) => item.id === id);
      if (!task) throw new Error("Task not found");
      // Tools run in the main page, so they can pause for the user.
      if (!window.confirm(`Delete task "${task.title}"?`)) {
        throw new Error("User declined to delete the task");
      }
      appStore.set((s) => ({
        ...s,
        tasks: s.tasks.filter((t) => t.id !== id)
      }));
      return { deleted: id };
    }
  ),
  showView: defineTool(
    "showView",
    "Display a view in the user's side panel, replacing any previous view. " +
      "Prefer binding forms to an action: on submit the page calls that tool directly with { ...action.args, ...fieldValues }, " +
      "so field names must be the tool's parameter names (e.g. 'title', not 'taskTitle'). " +
      "The form stays open for more entries, without involving you. " +
      "E.g. to let the user add tasks: { action: { tool: 'createTask', args: { projectId: 1 } }, fields: [{ name: 'title', label: 'Task' }] }. " +
      "Set notifyAgent only if you need to react to each submission. " +
      "A form without an action always sends its values to you as a chat message.",
    (spec) => {
      appStore.set((s) => ({
        ...s,
        view: { ...spec, id: (s.view?.id ?? 0) + 1 }
      }));
      return { shown: spec.component };
    }
  ),
  clearView: defineTool(
    "clearView",
    "Remove the view from the user's side panel",
    () => {
      appStore.set((s) => ({ ...s, view: null }));
      return { cleared: true };
    }
  )
};

function extractFunctionCalls(code?: string): string[] {
  if (!code) return [];
  return [
    ...new Set(
      code.match(/codemode\.(\w+)/g)?.map((m) => m.replace("codemode.", "")) ??
        []
    )
  ];
}

function ToolCard({ part }: { part: ToolPart }) {
  const [expanded, setExpanded] = useState(true);
  const calls = extractFunctionCalls(part.output?.code ?? part.input?.code);
  const hasError = part.state === "output-error" || !!part.errorText;
  const isDone = part.state === "output-available";
  const isRunning = !isDone && !hasError;

  return (
    <Surface
      className={`rounded-xl ring ${hasError ? "ring-2 ring-red-500/30" : "ring-kumo-line"} overflow-hidden`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-kumo-elevated transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <LightningIcon size={14} className="text-orange-500" />
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Text size="xs" bold>
            Browser iframe codemode
          </Text>
          {calls.length > 0 && (
            <>
              <span className="text-kumo-inactive">&middot;</span>
              <span className="font-mono text-xs text-kumo-secondary truncate">
                {calls.join(", ")}
              </span>
            </>
          )}
        </div>
        {isDone && <CheckCircleIcon size={14} className="text-green-500" />}
        {hasError && <WarningCircleIcon size={14} className="text-red-500" />}
        {isRunning && (
          <CircleNotchIcon
            size={14}
            className="text-kumo-inactive animate-spin"
          />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-kumo-line space-y-2 pt-2">
          {part.output?.code && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <CodeIcon size={10} className="text-kumo-inactive" />
                <Text size="xs" variant="secondary" bold>
                  Code
                </Text>
              </div>
              <pre className="font-mono text-xs text-kumo-subtle bg-kumo-elevated rounded p-2 overflow-x-auto whitespace-pre-wrap wrap-break-word">
                {part.output.code}
              </pre>
            </div>
          )}
          {!part.output?.code && part.input?.code && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <CodeIcon size={10} className="text-kumo-inactive" />
                <Text size="xs" variant="secondary" bold>
                  Code
                </Text>
              </div>
              <pre className="font-mono text-xs text-kumo-subtle bg-kumo-elevated rounded p-2 overflow-x-auto whitespace-pre-wrap wrap-break-word">
                {part.input.code}
              </pre>
            </div>
          )}
          {!part.output?.code && !part.input?.code && part.input && (
            <div>
              <Text size="xs" variant="secondary" bold>
                Input
              </Text>
              <pre className="font-mono text-xs text-kumo-subtle bg-kumo-elevated rounded p-2 overflow-x-auto whitespace-pre-wrap mt-1">
                {JSON.stringify(part.input, null, 2)}
              </pre>
            </div>
          )}
          {part.output?.result !== undefined && (
            <div>
              <Text size="xs" variant="secondary" bold>
                Result
              </Text>
              <pre className="font-mono text-xs text-kumo-subtle bg-green-500/5 border border-green-500/20 rounded p-2 overflow-x-auto whitespace-pre-wrap mt-1">
                {JSON.stringify(part.output.result, null, 2)}
              </pre>
            </div>
          )}
          {part.output?.logs?.length ? (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <TerminalIcon size={10} className="text-kumo-inactive" />
                <Text size="xs" variant="secondary" bold>
                  Console
                </Text>
              </div>
              <pre className="font-mono text-xs text-kumo-subtle bg-kumo-elevated rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {part.output.logs.join("\n")}
              </pre>
            </div>
          ) : null}
          {hasError && (
            <div className="text-red-500 text-xs">
              {part.errorText ?? "Tool execution failed"}
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}

function ModeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [mode]);

  return (
    <Button
      variant="ghost"
      shape="square"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      icon={mode === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    />
  );
}

function App() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // The workspace is persisted as the agent's state: the server's copy
  // hydrates the store on connect (and on changes from other tabs), and
  // local changes are pushed back. Tracking the last server snapshot keeps
  // a hydration from being echoed straight back.
  const serverState = useRef<Workspace | null>(null);
  const agent = useAgent<Workspace>({
    agent: "browser-codemode",
    onStateUpdate: (state, source) => {
      if (source !== "server") return;
      serverState.current = state;
      appStore.set(() => state);
    }
  });

  useEffect(
    () =>
      appStore.subscribe(() => {
        const state = appStore.get();
        if (state !== serverState.current) agent.setState(state);
      }),
    [agent]
  );

  const codemodeTool = useMemo(
    () =>
      createBrowserCodeTool({
        tools: browserTools,
        executor: new IframeSandboxExecutor()
      }),
    []
  );

  const tools = useMemo<Record<string, AITool>>(
    () => ({
      codemode: {
        description: codemodeTool.description,
        parameters: codemodeTool.inputSchema,
        execute: (input) => codemodeTool.execute(input as { code: string })
      }
    }),
    [codemodeTool]
  );

  const { messages, sendMessage, clearHistory, status } = useAgentChat({
    agent,
    experimental_throttle: 100,
    tools,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      const tool = tools[toolCall.toolName];
      if (!tool?.execute) return;
      const output = await tool.execute(toolCall.input);
      addToolOutput({ toolCallId: toolCall.toolCallId, output });
    }
  });

  const isStreaming = status === "streaming";

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }, [input, isStreaming, sendMessage]);

  const formHandlers = useMemo<FormHandlers>(
    () => ({
      // Runs a bound tool directly in the page — the model is not involved.
      runAction: (tool, args) => browserTools[tool].execute(args),
      sendToAgent: (title, values) =>
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: `Submitted "${title}" form: ${JSON.stringify(values)}`
            }
          ]
        })
    }),
    [sendMessage]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-kumo-default">
                Browser Codemode
              </h1>
              <Badge variant="secondary" className="text-[10px]">
                iframe executor
              </Badge>
            </div>
            <Text size="xs" variant="secondary">
              Generated code runs client-side in a sandboxed iframe.
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <Button
              variant="secondary"
              icon={<TrashIcon size={16} />}
              onClick={() => {
                clearHistory();
                appStore.set(() => emptyWorkspace);
              }}
              disabled={messages.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
              {messages.length === 0 && (
                <Empty
                  icon={<LightningIcon size={32} />}
                  title="Try browser codemode"
                  description="Ask: Create a project named Alpha, add two tasks, then list everything."
                />
              )}

              {messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message.id}
                    className={isUser ? "flex justify-end" : "space-y-2"}
                  >
                    {message.parts.map((part, idx) => {
                      if (part.type === "text") {
                        return (
                          <Surface
                            key={idx}
                            className={`max-w-[80%] rounded-2xl ${isUser ? "rounded-br-md bg-kumo-contrast text-kumo-inverse" : "rounded-bl-md ring ring-kumo-line"}`}
                          >
                            <Streamdown
                              className={`sd-theme px-4 py-2.5 text-sm leading-relaxed ${isUser ? "**:text-kumo-inverse" : ""}`}
                              plugins={{ code }}
                              controls={false}
                              isAnimating={isStreaming && !isUser}
                            >
                              {part.text}
                            </Streamdown>
                          </Surface>
                        );
                      }
                      if (part.type === "reasoning") {
                        if (
                          !(part.text.length > 0 || part.state === "streaming")
                        )
                          return null;
                        return (
                          <Surface
                            key={idx}
                            className="max-w-[80%] rounded-xl ring ring-kumo-line opacity-70 px-4 py-2.5"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <BrainIcon
                                size={14}
                                className="text-kumo-inactive"
                              />
                              <Text size="xs" variant="secondary" bold>
                                Thinking
                              </Text>
                            </div>
                            <div className="whitespace-pre-wrap text-xs text-kumo-subtle italic">
                              {part.text}
                            </div>
                          </Surface>
                        );
                      }
                      if (isToolUIPart(part)) {
                        return (
                          <ToolCard
                            key={idx}
                            part={part as unknown as ToolPart}
                          />
                        );
                      }
                      return null;
                    })}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="border-t border-kumo-line bg-kumo-base">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="max-w-3xl mx-auto px-5 py-4"
            >
              <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
                <InputArea
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Ask codemode to use browser tools..."
                  disabled={isStreaming}
                  rows={2}
                  className="flex-1 !ring-0 focus:!ring-0 !shadow-none !bg-transparent !outline-none"
                />
                <Button
                  type="submit"
                  variant="primary"
                  shape="square"
                  size="sm"
                  icon={<PaperPlaneRightIcon size={18} />}
                  disabled={!input.trim() || isStreaming}
                  loading={isStreaming}
                  aria-label="Send"
                  className="mb-0.5"
                />
              </div>
            </form>
            <div className="flex justify-center pb-3">
              <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
            </div>
          </div>
        </div>
        <SidePanel isStreaming={isStreaming} formHandlers={formHandlers} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
