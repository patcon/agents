import { Button, Surface, Text } from "@cloudflare/kumo";
import { SidebarIcon, XIcon } from "@phosphor-icons/react";
import { useWorkspace } from "./store";
import { clearView } from "./workspace";
import { TaskRow, ViewRenderer, type FormHandlers } from "./views";

export function SidePanel({
  isStreaming,
  formHandlers
}: {
  isStreaming: boolean;
  formHandlers: FormHandlers;
}) {
  const { projects, tasks, view } = useWorkspace();

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
                onClick={clearView}
              />
            )}
          </div>
          {view ? (
            <ViewRenderer
              key={view.id}
              view={view}
              isStreaming={isStreaming}
              formHandlers={formHandlers}
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
