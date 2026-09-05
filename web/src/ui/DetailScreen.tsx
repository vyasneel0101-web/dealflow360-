import type { ReactNode } from "react";
import { PageHeader } from "./Layout";
import { Stepper, type Step } from "./Stepper";

/**
 * The second of the two shells. Detail screens are: title + status, an
 * optional stepper, a stack of SectionCards, and a sticky ActionBar
 * (design.md §1).
 *
 * Screens 4, 6, 8, 10, 13 and 17 are all this component with different
 * sections. If a screen seems to need a new shell, it almost certainly needs
 * a new SECTION instead — that agreement is what keeps two people building in
 * parallel from producing two different products.
 */
export function DetailScreen({
  title,
  description,
  breadcrumb,
  status,
  steps,
  headerActions,
  children,
  actionBar,
}: {
  title: string;
  description?: string;
  breadcrumb?: ReactNode;
  /** Badge cluster shown beside the title — status, risk band, tier. */
  status?: ReactNode;
  steps?: Step[];
  headerActions?: ReactNode;
  children: ReactNode;
  actionBar?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-page p-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumb}
        actions={headerActions}
      />

      {status ? <div className="mt-3 flex flex-wrap items-center gap-2">{status}</div> : null}

      {steps && steps.length > 0 ? (
        <div className="mt-6 rounded-md border border-border bg-surface px-4 py-3">
          <Stepper steps={steps} />
        </div>
      ) : null}

      <div className="mt-6 space-y-6">{children}</div>

      {actionBar}
    </div>
  );
}
