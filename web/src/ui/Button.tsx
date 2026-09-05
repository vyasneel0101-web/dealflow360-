import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-brand text-text-inverse hover:bg-brand-hover disabled:bg-border disabled:text-text-muted",
  secondary:
    "border border-border bg-surface text-text hover:bg-bg disabled:text-text-muted",
  danger:
    "border border-danger bg-surface text-danger hover:bg-danger-subtle disabled:border-border disabled:text-text-muted",
  ghost: "text-text-muted hover:text-text hover:bg-bg",
};

/**
 * `disabledReason` renders as a title attribute, so a disabled control always
 * says why. No dead buttons (design.md §5) — e.g. Submit for Approval is
 * disabled with "Add at least one line" rather than silently failing.
 */
export function Button({
  variant = "secondary",
  loading = false,
  disabledReason,
  children,
  className = "",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  disabledReason?: string;
  children: ReactNode;
}) {
  const isDisabled = disabled || loading;
  return (
    <button
      {...props}
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : props.title}
      className={`inline-flex items-center justify-center gap-2 rounded-sm px-3 py-2 text-sm font-medium disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
