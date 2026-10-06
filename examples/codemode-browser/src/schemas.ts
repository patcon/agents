/**
 * Single source of truth for the workspace and tool shapes. Each zod schema
 * gives us the TypeScript type (`z.infer`), runtime validation of
 * model-provided arguments (`parseArgs`), and the JSON Schema that codemode
 * turns into the TypeScript types the model sees (`toolInputSchema`).
 *
 * React-free, so the server can import the workspace type too.
 */
import { z } from "zod";

const id = z.number().int().positive();
const requiredText = z.string().trim().min(1, "must not be empty");

export const projectSchema = z.object({ id, name: z.string() });
export const taskSchema = z.object({
  id,
  projectId: id,
  title: z.string(),
  done: z.boolean()
});

export type Project = z.infer<typeof projectSchema>;
export type Task = z.infer<typeof taskSchema>;

// -- Workspace tool arguments (defined before views: forms bind to these) --

const createProjectArgs = z.object({
  name: requiredText.describe("Project name")
});
const createTaskArgs = z.object({
  projectId: id.describe("Project ID"),
  title: requiredText.describe("Task title")
});
const updateTaskArgs = z.object({
  id: id.describe("Task ID"),
  title: requiredText.optional().describe("New title"),
  done: z.boolean().optional().describe("Whether the task is done")
});

/**
 * Tools a form may be bound to. A bound form runs the tool directly in the
 * page on submit — no chat message, no model turn.
 */
const formActionArgs = {
  createProject: createProjectArgs,
  createTask: createTaskArgs,
  updateTask: updateTaskArgs
};
type FormActionTool = keyof typeof formActionArgs;
const FORM_ACTION_TOOLS = Object.keys(formActionArgs) as [
  FormActionTool,
  ...FormActionTool[]
];

// -- Views --

const formFieldSchema = z.object({
  name: z.string().min(1).describe("Must be a parameter of action.tool"),
  label: z.string().optional(),
  type: z.enum(["text", "number", "checkbox"]).default("text")
});

const formPropsSchema = z
  .object({
    title: z.string().optional(),
    fields: z.array(formFieldSchema).min(1),
    submitLabel: z.string().optional(),
    action: z
      .object({
        tool: z.enum(FORM_ACTION_TOOLS),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Fixed arguments merged under the field values")
      })
      .optional()
      .describe(
        "Run this tool directly on submit with { ...args, ...fieldValues }"
      ),
    notifyAgent: z
      .boolean()
      .default(false)
      .describe("Also send the submitted values to the agent as a message")
  })
  .superRefine((props, ctx) => {
    // A bound form submits { ...args, ...fieldValues } to its tool, so field
    // names must be that tool's parameters. Catch mismatches when the form
    // is shown, where the model can fix them, rather than on submit.
    if (!props.action) return;
    const { tool, args = {} } = props.action;
    const shape = formActionArgs[tool].shape as Record<string, z.ZodType>;
    const params = Object.keys(shape);
    const unknown = props.fields
      .map((f) => f.name)
      .filter((name) => !params.includes(name));
    if (unknown.length) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message:
          `field names must be ${tool} parameters (${params.join(", ")}); ` +
          `unknown: ${unknown.join(", ")}`
      });
    }
    const provided = new Set([
      ...Object.keys(args),
      ...props.fields.map((f) => f.name)
    ]);
    const missing = params.filter(
      (p) => !provided.has(p) && !shape[p].safeParse(undefined).success
    );
    if (missing.length) {
      ctx.addIssue({
        code: "custom",
        path: ["action"],
        message: `${tool} requires ${missing.join(", ")}; add them as fields or action.args`
      });
    }
  });

const tablePropsSchema = z
  .object({
    title: z.string().optional(),
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.unknown())).max(200)
  })
  .refine((p) => p.rows.every((row) => row.length === p.columns.length), {
    message: "each row must have one cell per column",
    path: ["rows"]
  });

/**
 * Declarative views the model can ask the side panel to render. The model
 * only ever produces data matching one of these shapes — the components that
 * render them are ours, so generated code never touches the page's DOM.
 */
export const viewSpecSchema = z.discriminatedUnion("component", [
  z.object({
    component: z.literal("taskList"),
    props: z.object({
      projectId: id.optional().describe("Omit to list every task"),
      title: z.string().optional()
    })
  }),
  z.object({
    component: z.literal("projectSummary"),
    props: z.object({ projectId: id })
  }),
  z.object({ component: z.literal("table"), props: tablePropsSchema }),
  z.object({ component: z.literal("form"), props: formPropsSchema })
]);

export type ViewSpec = z.infer<typeof viewSpecSchema>;
export type FormProps = Extract<ViewSpec, { component: "form" }>["props"];

// -- Workspace --

export const workspaceSchema = z.object({
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
  view: z.intersection(viewSpecSchema, z.object({ id })).nullable()
});

export type Workspace = z.infer<typeof workspaceSchema>;

export const emptyWorkspace: Workspace = {
  projects: [],
  tasks: [],
  view: null
};

// -- All tool arguments --

const noArgs = z.object({});

export const toolArgs = {
  getPageInfo: noArgs,
  getState: noArgs,
  listProjects: noArgs,
  listTasks: z.object({
    projectId: id.optional().describe("Only tasks in this project")
  }),
  ...formActionArgs,
  deleteTask: z.object({ id: id.describe("Task ID") }),
  showView: viewSpecSchema,
  clearView: noArgs
};

export type ToolName = keyof typeof toolArgs;

/** JSON Schema for a tool's input, which codemode turns into model-facing types. */
export function toolInputSchema(name: ToolName) {
  return z.toJSONSchema(toolArgs[name], { target: "draft-07", io: "input" });
}

export function parseArgs<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error(z.prettifyError(result.error));
  return result.data;
}
