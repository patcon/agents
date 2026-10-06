import { useState } from "react";
import { Button, Surface, Text } from "@cloudflare/kumo";
import { SidebarIcon, XIcon } from "@phosphor-icons/react";
import { appStore, useAppState, type Task, type ViewSpec } from "./store";

function toggleTask(id: number) {
  appStore.set((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
  }));
}

function TaskRow({ task }: { task: Task }) {
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" variant="secondary" bold>
      {children}
    </Text>
  );
}

function TaskListView({
  projectId,
  title
}: {
  projectId?: number;
  title?: string;
}) {
  const { projects, tasks } = useAppState();
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

function ProjectSummaryView({ projectId }: { projectId: number }) {
  const { projects, tasks } = useAppState();
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

function TableView({
  title,
  columns,
  rows
}: {
  title?: string;
  columns: string[];
  rows: unknown[][];
}) {
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

function FormView({
  title,
  fields,
  submitLabel,
  disabled,
  onSubmit
}: Extract<ViewSpec, { component: "form" }>["props"] & {
  disabled: boolean;
  onSubmit: (title: string, values: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.name, f.type === "checkbox" ? false : ""])
    )
  );
  const [submitted, setSubmitted] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        onSubmit(title ?? "form", values);
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
              {field.label}
            </span>
          ) : (
            <>
              <span className="block text-xs text-kumo-secondary mb-1">
                {field.label}
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
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={disabled || submitted}
      >
        {submitted ? "Submitted" : (submitLabel ?? "Submit")}
      </Button>
    </form>
  );
}

function ViewRenderer({
  view,
  disabled,
  onFormSubmit
}: {
  view: ViewSpec;
  disabled: boolean;
  onFormSubmit: (title: string, values: Record<string, unknown>) => void;
}) {
  switch (view.component) {
    case "taskList":
      return <TaskListView {...view.props} />;
    case "projectSummary":
      return <ProjectSummaryView {...view.props} />;
    case "table":
      return <TableView {...view.props} />;
    case "form":
      return (
        <FormView {...view.props} disabled={disabled} onSubmit={onFormSubmit} />
      );
  }
}

export function SidePanel({
  disabled,
  onFormSubmit
}: {
  disabled: boolean;
  onFormSubmit: (title: string, values: Record<string, unknown>) => void;
}) {
  const { projects, tasks, view } = useAppState();

  return (
    <aside className="hidden md:flex w-80 lg:w-96 shrink-0 flex-col border-l border-kumo-line bg-kumo-base overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <SidebarIcon size={16} className="text-kumo-inactive" />
          <Text size="sm" bold>
            Workspace
          </Text>
        </div>

        <Surface className="rounded-xl ring ring-kumo-line p-3">
          <div className="flex items-center justify-between mb-2">
            <Text size="xs" variant="secondary" bold>
              Agent view
            </Text>
            {view && (
              <Button
                variant="ghost"
                shape="square"
                size="sm"
                aria-label="Dismiss view"
                icon={<XIcon size={12} />}
                onClick={() => appStore.set((s) => ({ ...s, view: null }))}
              />
            )}
          </div>
          {view ? (
            <ViewRenderer
              key={view.id}
              view={view}
              disabled={disabled}
              onFormSubmit={onFormSubmit}
            />
          ) : (
            <Text size="xs" variant="secondary">
              Ask the agent to show something here, e.g. "show me a form to add
              a task".
            </Text>
          )}
        </Surface>

        <Surface className="rounded-xl ring ring-kumo-line p-3 space-y-3">
          <Text size="xs" variant="secondary" bold>
            Projects &amp; tasks
          </Text>
          {projects.length === 0 && (
            <Text size="xs" variant="secondary">
              Nothing yet. Edits you make here are visible to the agent.
            </Text>
          )}
          {projects.map((project) => (
            <div key={project.id}>
              <Text size="sm" bold>
                {project.name}
              </Text>
              {tasks
                .filter((t) => t.projectId === project.id)
                .map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
            </div>
          ))}
        </Surface>
      </div>
    </aside>
  );
}
