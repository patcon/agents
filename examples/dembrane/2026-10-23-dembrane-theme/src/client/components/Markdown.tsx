import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// dembrane-echo's components/common/Markdown.tsx, less its redacted-token
// badges and Tally embed workaround, which nothing here needs.

export function Markdown({
  content,
  className = ""
}: {
  content: string;
  className?: string;
}) {
  return (
    <ReactMarkdown
      className={`prose prose-table:block prose-table:w-full prose-table:overflow-x-scroll ${className}`}
      remarkPlugins={[remarkGfm]}
      remarkRehypeOptions={{
        footnoteLabelProperties: { className: ["dembrane-sr-only"] }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
