import type { ReactNode } from "react";

/** A titled block inside DetailScreen. Detail screens are a stack of these. */
export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-surface">
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-text">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs text-text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Sticky footer for the primary actions of a detail screen. */
export function ActionBar({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-6 mt-8 border-t border-border bg-surface px-6 py-3">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4">
        <span className="text-xs text-text-muted">{note}</span>
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  );
}

/** Filter row above a DataTable. Screens 3, 5, 12, 15 all use this. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3">
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {breadcrumb ? <div className="mb-1 text-xs text-text-muted">{breadcrumb}</div> : null}
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}
