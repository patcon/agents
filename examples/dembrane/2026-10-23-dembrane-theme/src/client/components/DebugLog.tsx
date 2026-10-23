import { Badge } from "@cloudflare/kumo";
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
          <li key={message.id} className="rounded-lg ring ring-kumo-line">
            <details>
              <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-kumo-subtle tabular-nums">#{i}</span>
                <Badge variant={meta ? "secondary" : "info"}>{kind}</Badge>
                <span className="text-kumo-subtle">{message.role}</span>
                {meta && (
                  <span className="text-kumo-default truncate max-w-[12rem]">
                    {meta.subjectId}
                  </span>
                )}
                {count > 1 && <Badge variant="warning">revision {count}</Badge>}
              </summary>
              <pre className="px-2 pb-2 overflow-x-auto whitespace-pre-wrap break-all text-kumo-default">
                {JSON.stringify(message, null, 2)}
              </pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
