import { Text } from "@cloudflare/kumo";
import { useWorkspace } from "../../store";
import { TaskRow } from "../task-row";
import { SectionTitle } from "./section-title";
import type { ViewProps } from "./types";

export function ProjectSummaryView({ projectId }: ViewProps<"projectSummary">) {
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
