import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n/index.js';
import { MAX_UPLOAD_MB } from '../lib/env.js';
import { useRegistration } from './useRegistration.js';
import { DocumentSlot } from './DocumentUpload.js';

/**
 * Supporting documents (§41.7).
 *
 * The slots are driven by `document_requirements` from the server, so which
 * documents are required is configuration rather than a hard-coded list (§14).
 * The photograph has its own step and is excluded here.
 */
export function DocumentsStep(): JSX.Element {
  const t = useT();
  const { view, apply } = useRegistration();
  const navigate = useNavigate();

  const requirements = view.requirements.filter(
    (requirement) => requirement.documentKind !== 'FARMER_PHOTO',
  );

  const photoRequired = view.requirements.some(
    (requirement) => requirement.documentKind === 'FARMER_PHOTO' && requirement.isRequired,
  );

  const documentFor = (kind: string) =>
    view.documents.find((document) => document.documentKind === kind);

  const allRequiredPresent = requirements
    .filter((requirement) => requirement.isRequired)
    .every((requirement) => {
      const document = documentFor(requirement.documentKind);
      return document !== undefined && document.status !== 'REJECTED';
    });

  return (
    <section className="card">
      <h2 className="text-xl font-semibold text-stone-900">{t('registration.documents.title')}</h2>
      <p className="mt-1 text-sm text-stone-600">
        {t('registration.documents.subtitle', { maxMb: MAX_UPLOAD_MB })}
      </p>

      <ul className="mt-5 space-y-3">
        {requirements.map((requirement) => (
          <DocumentSlot
            key={requirement.documentKind}
            documentKind={requirement.documentKind}
            translationKey={requirement.translationKey}
            required={requirement.isRequired}
            document={documentFor(requirement.documentKind)}
            onChange={apply}
          />
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/farmer/registration/land')}
        >
          {t('common.back')}
        </button>
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!allRequiredPresent}
          onClick={() =>
            navigate(
              photoRequired ? '/farmer/registration/photo' : '/farmer/registration/review',
            )
          }
        >
          {t('common.continue')}
        </button>
      </div>
    </section>
  );
}
