/**
 * Workspace actions — the one place projects, tasks and the side-panel view
 * change. Tools, bound forms and the panel's own controls all go through
 * these, so rules like "the project must exist" live here once. Actions throw
 * on a broken rule; argument shapes are already validated by `schemas.ts`.
 */
import { appStore } from "./store";
import type { Project, Task, ViewSpec } from "./schemas";

function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function findTask(id: number) {
  const task = appStore.get().tasks.find((t) => t.id === id);
  if (!task) throw new Error("Task not found");
  return task;
}

export function createProject({ name }: { name: string }): Project {
  const project = { id: nextId(appStore.get().projects), name };
  appStore.set((s) => ({ ...s, projects: [...s.projects, project] }));
  return project;
}

export function createTask({
  projectId,
  title
}: {
  projectId: number;
  title: string;
}): Task {
  if (!appStore.get().projects.some((p) => p.id === projectId)) {
    throw new Error("Project not found");
  }
  const task = {
    id: nextId(appStore.get().tasks),
    projectId,
    title,
    done: false
  };
  appStore.set((s) => ({ ...s, tasks: [...s.tasks, task] }));
  return task;
}

export function updateTask({
  id,
  ...changes
}: {
  id: number;
  title?: string;
  done?: boolean;
}): Task {
  const updated = { ...findTask(id) };
  if (changes.title !== undefined) updated.title = changes.title;
  if (changes.done !== undefined) updated.done = changes.done;
  appStore.set((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (t.id === id ? updated : t))
  }));
  return updated;
}

export function toggleTask(id: number): Task {
  return updateTask({ id, done: !findTask(id).done });
}

export function deleteTask(id: number) {
  findTask(id);
  appStore.set((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
}

export function listTasks(projectId?: number) {
  const { tasks } = appStore.get();
  return projectId == null
    ? tasks
    : tasks.filter((t) => t.projectId === projectId);
}

export function showView(spec: ViewSpec) {
  // A fresh id remounts the view, resetting any form state.
  appStore.set((s) => ({ ...s, view: { ...spec, id: (s.view?.id ?? 0) + 1 } }));
}

export function clearView() {
  appStore.set((s) => ({ ...s, view: null }));
}
