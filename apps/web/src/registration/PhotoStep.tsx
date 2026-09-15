import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ALLOWED_PHOTO_MIME_TYPES } from '@kisansetu/shared';
import { api } from '../lib/api.js';
import { useT } from '../i18n/index.js';
import { useRegistration } from './useRegistration.js';
import { DocumentSlot } from './DocumentUpload.js';

/**
 * Farmer photograph (§15, §41.8).
 *
 * Shown only when the configured verification policy requires one. The note at
 * the bottom is load-bearing: a photograph here is a submitted artifact for a
 * human to look at, not face matching, and the UI says so rather than letting
 * a farmer assume otherwise.
 */
export function PhotoStep(): JSX.Element {
  const t = useT();
  const { view, apply } = useRegistration();
  const navigate = useNavigate();

  const requirement = view.requirements.find(
    (entry) => entry.documentKind === 'FARMER_PHOTO',
  );

  const photo = view.documents.find((document) => document.documentKind === 'FARMER_PHOTO');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    api
      .get<{ signedUrl: string }>(`/api/farmer/documents/${photo.id}/url`)
      .then(({ signedUrl }) => {
        if (!cancelled) setPreviewUrl(signedUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [photo?.id]);

  // Policy says no photograph is needed — skip the step entirely.
  if (!requirement?.isRequired) {
    return <Navigate to="/farmer/registration/review" replace />;
  }

  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-stone-900">{t('registration.photo.title')}</h2>
      <p className="mt-1 text-sm text-stone-600">{t('registration.photo.subtitle')}</p>

      {previewUrl ? (
        <img
          src={previewUrl}
          alt={t('document.kind.farmerPhoto')}
          className="mt-4 h-40 w-40 rounded-lg border border-stone-200 object-cover"
        />
      ) : null}

      <ul className="mt-4">
        <DocumentSlot
          documentKind="FARMER_PHOTO"
          translationKey={requirement.translationKey}
          required
          document={photo}
          onChange={apply}
          accept={ALLOWED_PHOTO_MIME_TYPES}
        />
      </ul>

      <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
        {t('registration.photo.notIdentityCheck')}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/farmer/registration/documents')}
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!photo}
          onClick={() => navigate('/farmer/registration/review')}
        >
          {t('common.continue')}
        </button>
      </div>
    </section>
  );
}
