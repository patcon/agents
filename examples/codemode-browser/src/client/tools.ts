/**
 * The browser tools exposed to generated code as `codemode.*`. They run in
 * the main page (not the sandboxed iframe), so they can read and change the
 * workspace and ask the user for confirmation.
 */
import type {
  JsonSchemaExecutableToolDescriptor,
  JsonSchemaExecutableToolDescriptors
} from "@cloudflare/codemode/browser";
import type { z } from "zod";
import {
  parseArgs,
  toolArgs,
  toolInputSchema,
  type ToolName
} from "../shared/schemas";
import { appStore } from "./store";
import * as workspace from "./workspace";

/**
 * Build a browser tool from its zod schema: the model sees the generated
 * JSON Schema, arguments are validated before `run`, and thrown errors come
 * back to the model as `{ error }` so it can correct itself.
 */
function defineTool<Name extends ToolName>(
  name: Name,
  description: string,
  run: (args: z.output<(typeof toolArgs)[Name]>) => unknown
): JsonSchemaExecutableToolDescriptor {
  return {
    description,
    inputSchema: toolInputSchema(
      name
    ) as JsonSchemaExecutableToolDescriptor["inputSchema"],
    execute: async (input) => {
      try {
        const args = parseArgs(toolArgs[name], input);
        return await run(args as z.output<(typeof toolArgs)[Name]>);
      } catch (error) {
        return { error: (error as Error).message };
      }
    }
  };
}

export const browserTools: JsonSchemaExecutableToolDescriptors = {
  getPageInfo: defineTool(
    "getPageInfo",
    "Get information about the current browser page",
    () => ({ title: document.title, url: location.href })
  ),
  getState: defineTool(
    "getState",
    "Get all projects and tasks, including edits the user made by hand in the side panel. Call this before modifying existing data.",
    () => {
      const { projects, tasks } = appStore.get();
      return { projects, tasks };
    }
  ),
  createProject: defineTool(
    "createProject",
    "Create a project (shown live in the user's side panel)",
    workspace.createProject
  ),
  listProjects: defineTool(
    "listProjects",
    "List projects",
    () => appStore.get().projects
  ),
  createTask: defineTool(
    "createTask",
    "Create a task in a project",
    workspace.createTask
  ),
  listTasks: defineTool(
    "listTasks",
    "List tasks, optionally by project",
    ({ projectId }) => workspace.listTasks(projectId)
  ),
  updateTask: defineTool(
    "updateTask",
    "Update a task's title or done status",
    workspace.updateTask
  ),
  deleteTask: defineTool(
    "deleteTask",
    "Delete a task. The user is asked to confirm; returns an error if they decline.",
    ({ id }) => {
      const task = appStore.get().tasks.find((t) => t.id === id);
      // Tools run in the main page, so they can pause for the user.
      if (task && !window.confirm(`Delete task "${task.title}"?`)) {
        throw new Error("User declined to delete the task");
      }
      workspace.deleteTask(id);
      return { deleted: id };
    }
  ),
  showView: defineTool(
    "showView",
    "Display a view in the user's side panel, replacing any previous view. " +
      "Prefer binding forms to an action: on submit the page calls that tool directly with { ...action.args, ...fieldValues }, " +
      "so field names must be the tool's parameter names (e.g. 'title', not 'taskTitle'). " +
      "The form stays open for more entries, without involving you. " +
      "E.g. to let the user add tasks: { action: { tool: 'createTask', args: { projectId: 1 } }, fields: [{ name: 'title', label: 'Task' }] }. " +
      "Set notifyAgent only if you need to react to each submission. " +
      "A form without an action always sends its values to you as a chat message.",
    (spec) => {
      workspace.showView(spec);
      return { shown: spec.component };
    }
  ),
  clearView: defineTool(
    "clearView",
    "Remove the view from the user's side panel",
    () => {
      workspace.clearView();
      return { cleared: true };
    }
  )
};
