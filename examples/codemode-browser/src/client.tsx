import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat, type AITool } from "@cloudflare/ai-chat/react";
import {
  IframeSandboxExecutor,
  createBrowserCodeTool
} from "@cloudflare/codemode/browser";
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
  LightningIcon,
  PaperPlaneRightIcon,
  TrashIcon,
  MoonIcon,
  SunIcon
} from "@phosphor-icons/react";
import { appStore } from "./store";
import { emptyWorkspace, type Workspace } from "./schemas";
import { browserTools } from "./tools";
import { ToolCard, type ToolPart } from "./tool-card";
import { SidePanel, type FormHandlers } from "./side-panel";
import "./styles.css";

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
