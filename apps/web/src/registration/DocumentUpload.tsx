import { useRef, useState } from 'react';
import { ALLOWED_DOCUMENT_MIME_TYPES, documentNeedsAction } from '@kisansetu/shared';
import type { DocumentKind, FarmerDocument, RegistrationView } from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '../lib/env.js';
import { useT } from '../i18n/index.js';

/**
 * One document slot — upload, replace, view, remove (§16).
 *
 * A failed upload never clears anything else: the farmer's other answers are
 * already saved server-side, and the error offers a retry rather than sending
 * them back to the start (§24, §38).
 */
export function DocumentSlot({
  documentKind,
  translationKey,
  required,
  document,
  onChange,
  accept = ALLOWED_DOCUMENT_MIME_TYPES,
}: {
  documentKind: DocumentKind;
  translationKey: string;
  required: boolean;
  document: FarmerDocument | undefined;
  onChange: (view: RegistrationView) => void;
  accept?: readonly string[];
}): JSX.Element {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null): Promise<void> {
    if (!file) return;
    setError(null);

    // Client-side checks are for fast feedback only; the server re-validates
    // type, extension and magic bytes regardless (§23).
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('registration.documents.error.tooLarge', { maxMb: MAX_UPLOAD_MB }));
      return;
    }
    if (!accept.includes(file.type)) {
      setError(t('registration.documents.error.wrongType'));
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('documentKind', documentKind);
      form.append('file', file);
      onChange(await api.upload<RegistrationView>('/api/farmer/documents', form));
    } catch (cause) {
      const message =
        cause instanceof Error && 'code' in cause && cause.message
          ? cause.message
          : t('registration.documents.error.uploadFailed');
      setError(message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleView(): Promise<void> {
    if (!document) return;
    try {
      const { signedUrl } = await api.get<{ signedUrl: string }>(
        `/api/farmer/documents/${document.id}/url`,
      );
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('error.generic'));
    }
  }

  async function handleRemove(): Promise<void> {
    if (!document) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await api.del<RegistrationView>(`/api/farmer/documents/${document.id}`));
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const needsAction = document ? documentNeedsAction(document.status) : false;

  return (
    <li
      className={`rounded-lg border p-3 ${
        needsAction ? 'border-red-300 bg-red-50' : 'border-stone-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-stone-900">
            {t(translationKey)}{' '}
            <span className="text-xs font-normal text-stone-500">
              ({required ? t('common.required') : t('common.optional')})
            </span>
          </p>

          {document ? (
            <p className="truncate text-xs text-stone-600">
              {document.originalFilename} ·{' '}
              {document.fileSizeBytes ? `${Math.ceil(document.fileSizeBytes / 1024)} KB` : '—'}
            </p>
          ) : (
            <p className="text-xs text-stone-500">{t('registration.documents.notUploaded')}</p>
          )}

          {document ? (
            <p
              className={`mt-1 text-xs font-medium ${
                needsAction ? 'text-red-700' : 'text-stone-600'
              }`}
            >
              {t(`document.status.${document.status}`)}
            </p>
          ) : null}

          {document?.rejectionReason ? (
            <p className="mt-1 text-xs text-red-700">{document.rejectionReason}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {document ? (
            <button type="button" className="btn-secondary" onClick={() => void handleView()}>
              {t('registration.documents.view')}
            </button>
          ) : null}

          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy
              ? t('registration.documents.uploading')
              : document
                ? t('registration.documents.replace')
                : t('registration.documents.upload')}
          </button>

          {document && document.status === 'UPLOADED' ? (
            <button
              type="button"
              className="btn-secondary text-red-700"
              disabled={busy}
              onClick={() => void handleRemove()}
            >
              {t('common.remove')}
            </button>
          ) : null}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept.join(',')}
        aria-label={t(translationKey)}
        onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
      />

      {error ? (
        <p role="alert" className="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-800">
          {error}
        </p>
      ) : null}
    </li>
  );
}
