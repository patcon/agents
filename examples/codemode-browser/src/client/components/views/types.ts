import type { ViewSpec } from "../../../shared/schemas";

/** The props the schema defines for one view component. */
export type ViewProps<C extends ViewSpec["component"]> = Extract<
  ViewSpec,
  { component: C }
>["props"];

export type FormHandlers = {
  runAction: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  sendToAgent: (title: string, values: Record<string, unknown>) => void;
};

/** What every view receives besides its own props. */
export type ViewContext = { isStreaming: boolean; formHandlers: FormHandlers };
