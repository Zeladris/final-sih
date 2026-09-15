import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.js';

export function NotFound(): JSX.Element {
  const t = useT();

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="card w-full max-w-md text-center">
        <h1 className="text-xl font-semibold text-stone-900">{t('error.notFound')}</h1>
        <Link to="/" className="btn-primary mt-6 block text-center">
          {t('error.backHome')}
        </Link>
      </div>
    </div>
  );
}
