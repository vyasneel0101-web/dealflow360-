import type { ReactNode } from "react";
import type { RiskBand, QuotationStatus, InvoiceStatus } from "@shared/types";

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-subtle text-ok",
  warn: "bg-warn-subtle text-warn",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
  neutral: "bg-bg text-text-muted border border-border",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-sm px-2 py-px text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Risk bands map to fixed colours EVERYWHERE they appear - screens 5, 6 and 14
 * alike. A judge scanning the approvals list learns the encoding once
 * (design.md section 2).
 */
const RISK_TONE: Record<RiskBand, Tone> = { low: "ok", medium: "warn", high: "danger" };

export function RiskBadge({ band }: { band: RiskBand | null }) {
  if (!band) return <Badge tone="neutral">Not evaluated</Badge>;
  return <Badge tone={RISK_TONE[band]}>{band.toUpperCase()}</Badge>;
}

const QUOTATION_TONE: Record<QuotationStatus, Tone> = {
  draft: "info",
  pending_approval: "warn",
  returned: "warn",
  approved: "ok",
  negotiation: "info",
  confirmed: "ok",
  rejected: "danger",
};

const QUOTATION_LABEL: Record<QuotationStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  returned: "Returned",
  approved: "Approved",
  negotiation: "Negotiation",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  return <Badge tone={QUOTATION_TONE[status]}>{QUOTATION_LABEL[status]}</Badge>;
}

const INVOICE_TONE: Record<InvoiceStatus, Tone> = {
  unpaid: "danger",
  partial: "warn",
  paid: "ok",
  void: "neutral",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={INVOICE_TONE[status]}>{status[0]!.toUpperCase() + status.slice(1)}</Badge>;
}

/**
 * Screen 4's per-line status. Carries the overage as a WORD, not just a hue -
 * colour alone is never the only signal (design.md section 2, accessibility).
 */
export function LineStatusBadge({ overagePct }: { overagePct: number }) {
  if (overagePct <= 0) return <Badge tone="ok">OK</Badge>;
  const pts = Number.isInteger(overagePct) ? overagePct : overagePct.toFixed(1);
  return <Badge tone="danger">{`OVER (+${pts}pt)`}</Badge>;
}
