import { useT } from '../i18n/index.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.js';
import { OtpLoginForm } from '../components/OtpLoginForm.js';

/**
 * The single sign-in page, for every user of KisanSetu (§3, §20).
 *
 * There is nothing to choose here but a language. Farmers, centre staff and
 * district/state administrators all enter their mobile number; the server
 * works out who they are after the code is verified. Government accounts are
 * provisioned by their office, so nobody can become staff or an admin from
 * this page — a number with no account simply starts farmer registration.
 */
export function LoginPage(): JSX.Element {
  const t = useT();

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>

        <header className="mt-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-harvest-700">
            {t('app.name')}
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-900">{t('app.tagline')}</h1>
        </header>

        <div className="mt-8">
          <OtpLoginForm />
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-stone-500">
          {t('login.honesty')}
        </p>
      </div>
    </div>
  );
}
