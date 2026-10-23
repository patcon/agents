import { Badge } from "@mantine/core";
import {
  type LogMessage
} from "../../shared";

export function DebugLog({ messages }: { messages: LogMessage[] }) {
  const seen = new Map<string, number>();
  return (
    <ol className="flex flex-col gap-2 font-mono text-[11px]">
      {messages.map((message, i) => {
        const meta = message.metadata;
        const kind = meta?.kind ?? `${message.role} turn`;
        const count = meta
          ? (seen.get(`${kind}:${meta.subjectId}`) ?? 0) + 1
          : 1;
        if (meta) seen.set(`${kind}:${meta.subjectId}`, count);
        return (
          <li key={message.id} className="border-y border-app-quiet">
            <details>
              <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-app-muted tabular-nums">#{i}</span>
                <Badge size="sm" color={meta ? "gray" : "primary"}>{kind}</Badge>
                <span className="text-app-muted">{message.role}</span>
                {meta && (
                  <span className="text-app-text truncate max-w-[12rem]">
                    {meta.subjectId}
                  </span>
                )}
                {count > 1 && <Badge size="sm" color="yellow">revision {count}</Badge>}
              </summary>
              <pre className="px-2 pb-2 overflow-x-auto whitespace-pre-wrap break-all text-app-text">
                {JSON.stringify(message, null, 2)}
              </pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
