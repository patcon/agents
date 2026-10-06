import type { Task } from "../../shared/schemas";
import { toggleTask } from "../workspace";

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
