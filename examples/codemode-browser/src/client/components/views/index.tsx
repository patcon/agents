/**
 * Components for the views the agent can show in the side panel. Adding a
 * view means one schema in `shared/schemas.ts`, one component file here,
 * and one entry in `viewComponents`.
 */
import type { ReactNode } from "react";
import type { ViewSpec } from "../../../shared/schemas";
import { FormView } from "./form-view";
import { ProjectSummaryView } from "./project-summary-view";
import { TableView } from "./table-view";
import { TaskListView } from "./task-list-view";
import type { ViewContext, ViewProps } from "./types";

export type { FormHandlers } from "./types";

const viewComponents: {
  [C in ViewSpec["component"]]: (
    props: ViewProps<C> & ViewContext
  ) => ReactNode;
} = {
  taskList: TaskListView,
  projectSummary: ProjectSummaryView,
  table: TableView,
  form: FormView
};

export function ViewRenderer({
  view,
  ...context
}: { view: ViewSpec } & ViewContext) {
  // TypeScript can't correlate `view.component` with `view.props` through
  // the lookup, so widen once here; the schema guarantees they match.
  const Component = viewComponents[view.component] as (
    props: ViewSpec["props"] & ViewContext
  ) => ReactNode;
  return <Component {...view.props} {...context} />;
}
