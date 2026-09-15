import { useState } from 'react';
import { MIN_REASON_LENGTH, REVIEW_DECISIONS } from '@kisansetu/shared';
import type { ReviewDecision } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';

/**
 * Decision confirmation (§16, §17; Phase 14).
 *
 * Verification is consequential, so no decision is one tap. Approval asks for
 * explicit confirmation; correction and rejection additionally require a
 * written reason that the farmer will read (§15).
 *
 * The three actions look and read differently on purpose — making them
 * visually equivalent is how the wrong one gets pressed.
 */
export function VerificationDecisionDialog({
  decision,
  farmerName,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  decision: ReviewDecision;
  farmerName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
}): JSX.Element {
  const t = useT();
  const [reason, setReason] = useState('');

  const needsReason = decision !== REVIEW_DECISIONS.APPROVE;
  const reasonTooShort = needsReason && reason.trim().length < MIN_REASON_LENGTH;

  const key =
    decision === REVIEW_DECISIONS.APPROVE
      ? 'approve'
      : decision === REVIEW_DECISIONS.REQUEST_CORRECTION
        ? 'correction'
        : 'reject';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="decision-title" className="text-lg font-semibold text-stone-900">
          {t(`verification.decision.${key}.title`)}
        </h2>

        <p className="mt-2 text-sm text-stone-600">
          {t(`verification.decision.${key}.body`, { name: farmerName })}
        </p>

        {needsReason ? (
          <div className="mt-4">
            <label htmlFor="reason" className="field-label">
              {t('verification.decision.reasonLabel')}
            </label>
            <textarea
              id="reason"
              rows={4}
              className="field-input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('verification.decision.reasonPlaceholder')}
              aria-describedby="reason-help"
              autoFocus
            />
            <p id="reason-help" className="mt-1 text-xs text-stone-500">
              {t('verification.decision.reasonHelp')}
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>

          <button
            type="button"
            className={`flex-1 rounded-lg px-4 py-3 text-base font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 ${
              decision === REVIEW_DECISIONS.APPROVE
                ? 'bg-harvest-700 hover:bg-harvest-800'
                : 'bg-red-700 hover:bg-red-800'
            }`}
            onClick={() => onConfirm(needsReason ? reason.trim() : null)}
            disabled={busy || reasonTooShort}
          >
            {busy ? t('common.saving') : t(`verification.decision.${key}.confirm`)}
          </button>
        </div>
      </div>
    </div>
  );
}
