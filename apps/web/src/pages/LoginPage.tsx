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
    <div
      className="flex min-h-screen items-center justify-center bg-cream-100 px-4 py-10"
      style={{
        backgroundImage: 'radial-gradient(rgb(0 0 0 / 0.06) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl md:grid-cols-2">
        {/* Decorative brand panel — hidden below md, where the form column
            alone already carries the name, tagline and the honesty note. */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-harvest-900 p-10 md:flex">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-harvest-700/60"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-4 -top-4 h-32 w-32 rounded-full border border-harvest-700/60"
          />

          <div className="relative flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-sm font-bold text-harvest-900">
              KS
            </span>
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-cream-100">
              {t('app.name')}
            </span>
          </div>

          <div className="relative">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-400">
              {t('app.name')}
            </p>
            <p className="mt-3 text-3xl font-semibold leading-tight text-cream-50">
              {t('app.tagline')}
            </p>
          </div>

          <p className="relative max-w-xs text-sm leading-relaxed text-harvest-200">
            {t('login.honesty')}
          </p>
        </aside>

        <div className="flex flex-col justify-center p-8 sm:p-10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 md:hidden">
              <span className="brand-mark h-8 w-8 text-[0.65rem]">KS</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-harvest-700">
                {t('app.name')}
              </span>
            </div>
            <div className="ml-auto">
              <LanguageSwitcher />
            </div>
          </div>

          <h1 className="mt-8 text-2xl font-semibold text-stone-900 sm:text-3xl">
            {t('app.tagline')}
          </h1>

          <div className="mt-6">
            <OtpLoginForm />
          </div>

          <p className="mt-6 text-center text-xs leading-relaxed text-stone-500">
            {t('login.honesty')}
          </p>
        </div>
      </div>
    </div>
  );
}
