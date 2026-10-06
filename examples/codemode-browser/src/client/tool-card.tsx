import { useState } from "react";
import { Surface, Text } from "@cloudflare/kumo";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  CodeIcon,
  LightningIcon,
  TerminalIcon,
  WarningCircleIcon
} from "@phosphor-icons/react";

export type ToolPart = {
  type: string;
  state?: string;
  errorText?: string;
  input?: { code?: string; [key: string]: unknown };
  output?: { code?: string; result?: unknown; logs?: string[] };
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

export function ToolCard({ part }: { part: ToolPart }) {
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
