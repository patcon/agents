import { useState } from "react";
import { Button, Text } from "@cloudflare/kumo";
import { SectionTitle } from "./section-title";
import type { ViewContext, ViewProps } from "./types";

function emptyValues(fields: ViewProps<"form">["fields"]) {
  return Object.fromEntries(
    fields.map((f) => [f.name, f.type === "checkbox" ? false : ""])
  );
}

export function FormView({
  title,
  fields,
  submitLabel,
  action,
  notifyAgent,
  isStreaming,
  formHandlers: handlers
}: ViewProps<"form"> & ViewContext) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    emptyValues(fields)
  );
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saved"; count: number }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // Only forms that message the agent need to wait for the current turn.
  const talksToAgent = !action || notifyAgent;
  const disabled = (talksToAgent && isStreaming) || status.kind === "sent";

  async function submit() {
    const formTitle = title ?? "form";
    if (!action) {
      handlers.sendToAgent(formTitle, values);
      setStatus({ kind: "sent" });
      return;
    }
    const result = await handlers.runAction(action.tool, {
      ...action.args,
      ...values
    });
    if (typeof result === "object" && result !== null && "error" in result) {
      setStatus({ kind: "error", message: String(result.error) });
      return;
    }
    // Stay open for the next entry.
    setValues(emptyValues(fields));
    setStatus((s) => ({
      kind: "saved",
      count: s.kind === "saved" ? s.count + 1 : 1
    }));
    if (notifyAgent) handlers.sendToAgent(formTitle, values);
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {title && <SectionTitle>{title}</SectionTitle>}
      {fields.map((field) => (
        <label key={field.name} className="block text-sm text-kumo-default">
          {field.type === "checkbox" ? (
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.name]: e.target.checked }))
                }
              />
              {field.label ?? field.name}
            </span>
          ) : (
            <>
              <span className="block text-xs text-kumo-secondary mb-1">
                {field.label ?? field.name}
              </span>
              <input
                type={field.type}
                value={String(values[field.name] ?? "")}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [field.name]:
                      field.type === "number"
                        ? e.target.valueAsNumber
                        : e.target.value
                  }))
                }
                className="w-full rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm"
              />
            </>
          )}
        </label>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={disabled}>
          {status.kind === "sent" ? "Sent to agent" : (submitLabel ?? "Submit")}
        </Button>
        {status.kind === "saved" && (
          <Text size="xs" variant="secondary">
            Saved{status.count > 1 ? ` (${status.count})` : ""}
          </Text>
        )}
        {status.kind === "error" && (
          <span className="text-xs text-red-500">{status.message}</span>
        )}
      </div>
      <Text size="xs" variant="secondary">
        {action
          ? notifyAgent
            ? `Runs ${action.tool} and tells the agent.`
            : `Runs ${action.tool} directly. The agent isn't messaged.`
          : "Sends your answers to the agent."}
      </Text>
    </form>
  );
}
