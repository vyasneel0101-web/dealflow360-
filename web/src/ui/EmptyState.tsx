import type { ReactNode } from "react";

/**
 * Every list has a written empty state with a cause and an action - never
 * "No data" (design.md section 5). The Approvals empty state teaches the
 * routing rule, so the product explains its own mechanism.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-base font-semibold text-text">{title}</div>
      {description ? (
        <p className="mt-2 max-w-page text-sm text-text-muted" style={{ maxWidth: "44ch" }}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
