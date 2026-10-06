import { useSyncExternalStore } from "react";

export type Project = { id: number; name: string };
export type Task = {
  id: number;
  projectId: number;
  title: string;
  done: boolean;
};

export type FormField = {
  name: string;
  label: string;
  type: "text" | "number" | "checkbox";
};

/**
 * Tools a form may be bound to. A bound form runs the tool directly in the
 * page on submit — no chat message, no model turn.
 */
export const FORM_ACTION_TOOLS = ["createProject", "createTask", "updateTask"];

export type FormAction = { tool: string; args?: Record<string, unknown> };

/**
 * Declarative views the model can ask the side panel to render. The model
 * only ever produces data matching one of these shapes — the components that
 * render them are ours, so generated code never touches the page's DOM.
 */
export type ViewSpec =
  | { component: "taskList"; props: { projectId?: number; title?: string } }
  | { component: "projectSummary"; props: { projectId: number } }
  | {
      component: "table";
      props: { title?: string; columns: string[]; rows: unknown[][] };
    }
  | {
      component: "form";
      props: {
        title?: string;
        fields: FormField[];
        submitLabel?: string;
        action?: FormAction;
        notifyAgent: boolean;
      };
    };

export type AppState = {
  projects: Project[];
  tasks: Task[];
  view: (ViewSpec & { id: number }) | null;
};

let state: AppState = { projects: [], tasks: [], view: null };
const listeners = new Set<() => void>();

/**
 * External store shared by the UI and the codemode tools. Tools read through
 * `get()` at call time, so they never see stale React closures, and every
 * `set()` re-renders subscribed components.
 */
export const appStore = {
  get: () => state,
  set(update: (s: AppState) => AppState) {
    state = update(state);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};

export function useAppState() {
  return useSyncExternalStore(appStore.subscribe, appStore.get);
}

export function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

const FIELD_TYPES = new Set(["text", "number", "checkbox"]);
const MAX_ROWS = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function parseFormAction(action: unknown): FormAction | undefined {
  if (action == null) return undefined;
  if (!isRecord(action) || !FORM_ACTION_TOOLS.includes(String(action.tool))) {
    throw new Error(
      `action.tool must be one of: ${FORM_ACTION_TOOLS.join(", ")}`
    );
  }
  if (action.args != null && !isRecord(action.args)) {
    throw new Error("action.args must be an object");
  }
  return { tool: String(action.tool), args: action.args ?? undefined };
}

/** Validate model-provided view input before it reaches the renderer. */
export function parseViewSpec(component: unknown, props: unknown): ViewSpec {
  if (!isRecord(props)) throw new Error("props must be an object");

  switch (component) {
    case "taskList": {
      const projectId =
        props.projectId == null ? undefined : Number(props.projectId);
      if (projectId !== undefined && !Number.isFinite(projectId)) {
        throw new Error("projectId must be a number");
      }
      return {
        component,
        props: { projectId, title: optionalString(props.title, "title") }
      };
    }
    case "projectSummary": {
      const projectId = Number(props.projectId);
      if (!Number.isFinite(projectId)) throw new Error("projectId is required");
      return { component, props: { projectId } };
    }
    case "table": {
      const { columns, rows } = props;
      if (!Array.isArray(columns) || columns.length === 0) {
        throw new Error("columns must be a non-empty array of strings");
      }
      if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
        throw new Error(`rows must be an array of at most ${MAX_ROWS} rows`);
      }
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== columns.length) {
          throw new Error("each row must be an array matching columns length");
        }
      }
      return {
        component,
        props: {
          title: optionalString(props.title, "title"),
          columns: columns.map(String),
          rows: rows as unknown[][]
        }
      };
    }
    case "form": {
      const { fields } = props;
      if (!Array.isArray(fields) || fields.length === 0) {
        throw new Error("fields must be a non-empty array");
      }
      const parsed = fields.map((field): FormField => {
        if (!isRecord(field) || typeof field.name !== "string" || !field.name) {
          throw new Error("each field needs a name");
        }
        const type = field.type ?? "text";
        if (typeof type !== "string" || !FIELD_TYPES.has(type)) {
          throw new Error(
            `field type must be one of: ${[...FIELD_TYPES].join(", ")}`
          );
        }
        return {
          name: field.name,
          label: typeof field.label === "string" ? field.label : field.name,
          type: type as FormField["type"]
        };
      });
      return {
        component,
        props: {
          title: optionalString(props.title, "title"),
          fields: parsed,
          submitLabel: optionalString(props.submitLabel, "submitLabel"),
          action: parseFormAction(props.action),
          notifyAgent: props.notifyAgent === true
        }
      };
    }
    default:
      throw new Error(
        "component must be one of: taskList, projectSummary, table, form"
      );
  }
}
