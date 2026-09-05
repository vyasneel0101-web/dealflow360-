import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Money and percentage columns right-align so digits line up. */
  align?: "left" | "right";
  width?: string;
  /** Hidden below 768px, where tables become stacked cards. */
  secondary?: boolean;
}

/**
 * The workhorse of six list screens. Row click is the universal navigation
 * gesture in this product — the wireframe's Navigation Key says every list
 * opens its detail "by clicking a row".
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
}) {
  if (loading) return <SkeletonRows columns={columns.length} />;

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface">
        {empty ?? <EmptyState title="Nothing here yet" />}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      {/* Desktop and tablet */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={`px-4 py-3 text-xs font-medium uppercase tracking-wide text-text-muted ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={(e) => {
                if (onRowClick && e.key === "Enter") onRowClick(row);
              }}
              className={`border-b border-border last:border-0 ${
                onRowClick ? "cursor-pointer hover:bg-bg" : ""
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-sm ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Below 768px: stacked label/value cards rather than a horizontal
          scroll, per design.md §7. */}
      <div className="divide-y divide-border md:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`space-y-2 p-4 ${onRowClick ? "cursor-pointer active:bg-bg" : ""}`}
          >
            {columns
              .filter((c) => !c.secondary)
              .map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-4">
                  <span className="text-xs uppercase tracking-wide text-text-muted">{c.header}</span>
                  <span className="text-sm">{c.render(row)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton rows, never a spinner over the whole page (design.md §5). */
function SkeletonRows({ columns }: { columns: number }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      {Array.from({ length: 5 }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-border p-4 last:border-0">
          {Array.from({ length: columns }).map((__, c) => (
            <div key={c} className="skeleton h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
