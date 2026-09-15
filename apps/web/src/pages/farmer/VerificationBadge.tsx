import type { VerificationStatus } from '@kisansetu/shared';

const STYLE: Record<VerificationStatus, { className: string; label: string }> = {
  PENDING: { className: 'bg-stone-100 text-stone-700', label: 'Not started' },
  UNDER_REVIEW: { className: 'bg-amber-100 text-amber-900', label: 'Under review' },
  VERIFIED: { className: 'bg-harvest-100 text-harvest-800', label: 'Verified' },
  REJECTED: { className: 'bg-red-100 text-red-800', label: 'Rejected' },
};

export function VerificationBadge({ status }: { status: VerificationStatus }): JSX.Element {
  const style = STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${style.className}`}
    >
      {style.label}
    </span>
  );
}
