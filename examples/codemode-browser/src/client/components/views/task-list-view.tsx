import { Text } from "@cloudflare/kumo";
import { useWorkspace } from "../../store";
import { TaskRow } from "../task-row";
import { SectionTitle } from "./section-title";
import type { ViewProps } from "./types";

export function TaskListView({ projectId, title }: ViewProps<"taskList">) {
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
