import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  ListsToggle,
  linkDialogPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  type MDXEditorProps,
  markdownShortcutPlugin,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo
} from "@mdxeditor/editor";
import type { Ref } from "react";

import "./styles.css";

// dembrane-echo's components/form/MarkdownWYSIWYG, less its redacted-token
// escaping, which nothing here needs. styles.css is its copy of MDXEditor's.

export function MarkdownWYSIWYG(
  props: MDXEditorProps & { ref?: Ref<MDXEditorMethods> }
) {
  return (
    <MDXEditor
      plugins={[
        thematicBreakPlugin(),
        headingsPlugin(),
        quotePlugin(),
        linkDialogPlugin(),
        listsPlugin(),
        markdownShortcutPlugin(),
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <BoldItalicUnderlineToggles />
              <CreateLink />
              <ListsToggle options={["number", "bullet"]} />
              <BlockTypeSelect />
              <UndoRedo />
            </>
          )
        })
      ]}
      contentEditableClassName="prose min-h-[200px]"
      className="border-x border-solid border-[color:var(--app-control-rule)]"
      {...props}
    />
  );
}
