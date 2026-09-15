import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.js';

/** Submission confirmation (§41.10). */
export function SubmittedStep(): JSX.Element {
  const t = useT();

  return (
    <section className="card text-center">
      <div
        aria-hidden="true"
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-harvest-100 text-2xl"
      >
        ✓
      </div>

      <h2 className="text-xl font-semibold text-stone-900">
        {t('registration.submitted.title')}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-stone-600">
        {t('registration.submitted.body')}
      </p>

      <Link to="/farmer/status" className="btn-primary mt-6 block text-center">
        {t('registration.submitted.viewStatus')}
      </Link>
    </section>
  );
}
