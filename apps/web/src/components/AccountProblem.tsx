import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { useT } from '../i18n/index.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

/**
 * Screens for a signed-in user the app cannot route (§29).
 *
 * Neither guesses a role. "Not configured" is the server's answer — the
 * profile exists but is inactive, has no valid role, or has no active
 * centre/district/state assignment. "Load failed" means the server could not
 * be asked at all, so it offers a retry.
 */
function ProblemCard({
  icon,
  title,
  body,
  children,
}: {
  icon: string;
  title: string;
  body: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 py-10">
      <div className="card w-full max-w-md text-center">
        <div className="flex justify-end">
          <LanguageSwitcher compact />
        </div>
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-2xl"
        >
          {icon}
        </div>
        <h1 className="text-xl font-semibold text-stone-900">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-600">{body}</p>
        <div className="mt-6 space-y-3">{children}</div>
      </div>
    </div>
  );
}

export function AccountNotConfigured(): JSX.Element {
  const { signOut } = useAuth();
  const t = useT();

  return (
    <ProblemCard icon="⚙️" title={t('account.notConfigured.title')} body={t('account.notConfigured.body')}>
      <button type="button" onClick={() => void signOut()} className="btn-primary w-full">
        {t('common.signOut')}
      </button>
    </ProblemCard>
  );
}

export function AccountLoadFailed(): JSX.Element {
  const { signOut, refreshProfile } = useAuth();
  const t = useT();
  const [busy, setBusy] = useState(false);

  return (
    <ProblemCard icon="📶" title={t('account.loadFailed.title')} body={t('account.loadFailed.body')}>
      <button
        type="button"
        className="btn-primary w-full"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void refreshProfile().finally(() => setBusy(false));
        }}
      >
        {busy ? t('common.loading') : t('common.retry')}
      </button>
      <button type="button" onClick={() => void signOut()} className="btn-secondary w-full">
        {t('common.signOut')}
      </button>
    </ProblemCard>
  );
}
