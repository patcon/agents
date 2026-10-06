import { SectionTitle } from "./section-title";
import type { ViewProps } from "./types";

export function TableView({ title, columns, rows }: ViewProps<"table">) {
  return (
    <div className="space-y-2">
      {title && <SectionTitle>{title}</SectionTitle>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-kumo-default">
          <thead>
            <tr className="border-b border-kumo-line">
              {columns.map((col) => (
                <th key={col} className="text-left font-semibold py-1 pr-3">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-kumo-line last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="py-1 pr-3">
                    {typeof cell === "object"
                      ? JSON.stringify(cell)
                      : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
