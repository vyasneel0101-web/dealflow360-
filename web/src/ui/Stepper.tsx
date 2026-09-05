export interface Step {
  label: string;
  state: "done" | "current" | "upcoming" | "skipped";
}

/**
 * Screen 6: Submitted → Sales Manager → Finance → Confirmed, with Finance
 * rendered only when the risk band requires it (B4.2).
 * Screen 13: Order Confirmed → Shipped → Invoiced → Paid.
 *
 * State is carried by a word and a mark, not by colour alone.
 */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Marker state={step.state} index={i + 1} />
            <span
              className={
                step.state === "current"
                  ? "text-sm font-semibold text-text"
                  : step.state === "done"
                    ? "text-sm text-text"
                    : "text-sm text-text-muted"
              }
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 ? (
            <span aria-hidden className="mx-2 h-px w-8 bg-border" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Marker({ state, index }: { state: Step["state"]; index: number }) {
  const base =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium";
  if (state === "done")
    return <span className={`${base} bg-ok text-text-inverse`} aria-label="completed">✓</span>;
  if (state === "current")
    return <span className={`${base} bg-brand text-text-inverse`} aria-current="step">{index}</span>;
  if (state === "skipped")
    return (
      <span className={`${base} border border-border text-text-muted`} aria-label="not required">
        –
      </span>
    );
  return <span className={`${base} border border-border text-text-muted`}>{index}</span>;
}
