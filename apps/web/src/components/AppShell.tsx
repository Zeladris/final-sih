import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { useT } from '../i18n/index.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}): JSX.Element {
  const { profile, signOut } = useAuth();
  const t = useT();

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-harvest-700">
              {t('app.name')}
            </p>
            <h1 className="text-lg font-semibold text-stone-900">{title}</h1>
            {subtitle ? <p className="text-sm text-stone-600">{subtitle}</p> : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitcher compact />

            {profile ? (
              <div className="text-right">
                <p className="text-sm font-medium text-stone-900">{profile.name ?? ''}</p>
                <p className="text-xs text-stone-500">
                  {t(`role.${profile.role}`)}
                  {profile.phone ? ` · ${profile.phone}` : ''}
                </p>
              </div>
            ) : null}

            <button type="button" className="btn-secondary" onClick={() => void signOut()}>
              {t('common.signOut')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}): JSX.Element {
  return (
    <div className="card">
      <p className="text-sm text-stone-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Error display (§24).
 *
 * Shows the user-facing message the API wrote, plus the request id for
 * support. It never renders a stack trace or an internal identifier — the API
 * does not send them, and this would not print them if it did.
 */
export function ErrorPanel({ error }: { error: unknown }): JSX.Element {
  const t = useT();

  const message = error instanceof Error ? error.message : t('error.generic');
  const requestId =
    typeof error === 'object' && error !== null && 'requestId' in error
      ? (error as { requestId: string | null }).requestId
      : null;

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-900">{message}</p>
      {requestId ? (
        <p className="mt-1 font-mono text-xs text-red-700">
          {t('error.reference')}: {requestId}
        </p>
      ) : null}
    </div>
  );
}
