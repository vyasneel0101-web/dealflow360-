import type { ReactNode } from "react";
import type { Tone } from "./Badge";

const ACCENT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-text",
};

/** Screens 2, 5, 7, 9, 12, 14, 16 all open with a row of these. */
export function KpiChip({
  label,
  value,
  sublabel,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: ReactNode;
  sublabel?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`rounded-md border border-border bg-surface p-4 ${
        interactive ? "cursor-pointer hover:border-brand" : ""
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${ACCENT[tone]}`}>{value}</div>
      {sublabel ? <div className="mt-1 text-xs text-text-muted">{sublabel}</div> : null}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
