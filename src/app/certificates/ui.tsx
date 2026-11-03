/**
 * Phase 8 — small server-safe presentational helpers shared by the
 * certificate pages (no client directives here). Generic building
 * blocks (PageHeader, Card, StatTile, EmptyState, AccessDenied,
 * formatDate) are reused from the Phase 7 assignments UI module.
 */
import {
  CERTIFICATE_STATUS_CLASSES,
  CERTIFICATE_STATUS_LABELS,
  EFFECTIVE_STATUS_CLASSES,
  EFFECTIVE_STATUS_LABELS,
  type CertificateStatus,
  type CertificateEffectiveStatus,
} from "@/config/certificates";

/** Date-only Arabic formatting (certificates never print time-of-day). */
export function formatIssueDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "long",
    numberingSystem: "latn",
  }).format(date);
}

export function CertificateStatusBadge({ status }: { status: string }) {
  const label =
    CERTIFICATE_STATUS_LABELS[status as CertificateStatus] ?? status;
  const cls =
    CERTIFICATE_STATUS_CLASSES[status as CertificateStatus] ??
    "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

/** Shows ISSUED / REVOKED / EXPIRED (expiry derived from expiresAt). */
export function EffectiveStatusBadge({ status }: { status: string }) {
  const label =
    EFFECTIVE_STATUS_LABELS[status as CertificateEffectiveStatus] ?? status;
  const cls =
    EFFECTIVE_STATUS_CLASSES[status as CertificateEffectiveStatus] ??
    "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}