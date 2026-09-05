import type { ReactNode } from "react";
import { DataTable, type Column } from "./DataTable";
import { KpiRow } from "./KpiChip";
import { FilterBar, PageHeader } from "./Layout";

/**
 * One of the two shells the entire internal app is built from.
 *
 * The wireframe's Navigation Key states that each module has one list screen
 * and one detail screen opened by clicking a row. Five modules follow that
 * pattern identically — Quotations, Approvals, Fulfillment, Subscriptions,
 * Invoices — so they are this component configured five ways, not five
 * screens (design.md §1).
 *
 * Screens cannot drift apart when they are the same component.
 */
export function ListScreen<T>({
  title,
  description,
  breadcrumb,
  actions,
  kpis,
  filters,
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  footnote,
}: {
  title: string;
  description?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  kpis?: ReactNode;
  filters?: ReactNode;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  /** The wireframe puts a hint under most tables, e.g. "Click any row to…". */
  footnote?: string;
}) {
  return (
    <div className="mx-auto max-w-page space-y-6 p-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumb}
        actions={actions}
      />

      {kpis ? <KpiRow>{kpis}</KpiRow> : null}
      {filters ? <FilterBar>{filters}</FilterBar> : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        onRowClick={onRowClick}
        loading={loading}
        empty={empty}
      />

      {footnote && rows.length > 0 ? (
        <p className="text-xs text-text-muted">{footnote}</p>
      ) : null}
    </div>
  );
}
