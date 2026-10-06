/**
 * Components for the views the agent can show in the side panel. Adding a
 * view means one schema in `schemas.ts` plus one entry in `viewComponents`.
 */
import { useState, type ReactNode } from "react";
import { Button, Text } from "@cloudflare/kumo";
import type { Task, ViewSpec } from "./schemas";
import { useWorkspace } from "./store";
import { toggleTask } from "./workspace";

type ViewProps<C extends ViewSpec["component"]> = Extract<
  ViewSpec,
  { component: C }
>["props"];

export function TaskRow({ task }: { task: Task }) {
  return (
    <label className="flex items-center gap-2 py-1 text-sm text-kumo-default cursor-pointer">
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => toggleTask(task.id)}
      />
      <span className={task.done ? "line-through text-kumo-inactive" : ""}>
        {task.title}
      </span>
      <span className="ml-auto font-mono text-[10px] text-kumo-inactive">
        #{task.id}
      </span>
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" variant="secondary" bold>
      {children}
    </Text>
  );
}

function TaskListView({ projectId, title }: ViewProps<"taskList">) {
  const { projects, tasks } = useWorkspace();
  const project = projects.find((p) => p.id === projectId);
  const visible =
    projectId == null ? tasks : tasks.filter((t) => t.projectId === projectId);
  return (
    <div>
      <SectionTitle>{title ?? project?.name ?? "All tasks"}</SectionTitle>
      {visible.length === 0 ? (
        <Text size="xs" variant="secondary">
          No tasks.
        </Text>
      ) : (
        visible.map((task) => <TaskRow key={task.id} task={task} />)
      )}
    </div>
  );
}

function ProjectSummaryView({ projectId }: ViewProps<"projectSummary">) {
  const { projects, tasks } = useWorkspace();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <Text size="xs" variant="secondary">
        Project #{projectId} no longer exists.
      </Text>
    );
  }
  const projectTasks = tasks.filter((t) => t.projectId === projectId);
  const done = projectTasks.filter((t) => t.done).length;
  const pct = projectTasks.length ? (done / projectTasks.length) * 100 : 0;
  return (
    <div className="space-y-2">
      <SectionTitle>{project.name}</SectionTitle>
      <div className="h-2 rounded-full bg-kumo-elevated overflow-hidden">
        <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
      </div>
      <Text size="xs" variant="secondary">
        {done} of {projectTasks.length} tasks done
      </Text>
      {projectTasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </div>
  );
}

function TableView({ title, columns, rows }: ViewProps<"table">) {
  return (
    <div className="space-y-2">
      {title && <SectionTitle>{title}</SectionTitle>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-kumo-default">
          <thead>
            <tr className="border-b border-kumo-line">
              {columns.map((col) => (
                <th key={col} className="text-left font-semibold py-1 pr-3">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-kumo-line last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="py-1 pr-3">
                    {typeof cell === "object"
                      ? JSON.stringify(cell)
                      : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type FormHandlers = {
  runAction: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  sendToAgent: (title: string, values: Record<string, unknown>) => void;
};

/** What every view receives besides its own props. */
type ViewContext = { isStreaming: boolean; formHandlers: FormHandlers };

function emptyValues(fields: ViewProps<"form">["fields"]) {
  return Object.fromEntries(
    fields.map((f) => [f.name, f.type === "checkbox" ? false : ""])
  );
}

function FormView({
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

const viewComponents: {
  [C in ViewSpec["component"]]: (
    props: ViewProps<C> & ViewContext
  ) => ReactNode;
} = {
  taskList: TaskListView,
  projectSummary: ProjectSummaryView,
  table: TableView,
  form: FormView
};

export function ViewRenderer({
  view,
  ...context
}: { view: ViewSpec } & ViewContext) {
  // TypeScript can't correlate `view.component` with `view.props` through
  // the lookup, so widen once here; the schema guarantees they match.
  const Component = viewComponents[view.component] as (
    props: ViewSpec["props"] & ViewContext
  ) => ReactNode;
  return <Component {...view.props} {...context} />;
}
