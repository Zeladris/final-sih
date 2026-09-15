import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { VerificationQueue as Queue } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { VerificationQueue } from '../../components/admin/VerificationQueue.js';
import { Spinner } from '../../components/Spinner.js';

/**
 * The district admin's farmer verification queue (§34, §38; Phase 14).
 *
 * Administrative verification — profile, land, documents, photograph — is
 * this role's alone (never centre staff's). The queue is scoped to the
 * admin's own district by the server; nothing here supplies a district id.
 */
export function DistrictVerificationQueuePage(): JSX.Element {
  const t = useT();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<Queue>('/api/admin/district/verification-queue')
      .then(setQueue)
      .catch(setError);
  }, []);

  return (
    <AppShell title={t('verification.queue.title')}>
      <div className="space-y-4">
        <Link to="/district/dashboard" className="text-sm text-stone-600 underline underline-offset-2">
          ← {t('dashboard.nav.dashboard')}
        </Link>

        {error ? <ErrorPanel error={error} /> : null}
        {!queue && !error ? <Spinner label={t('common.loading')} /> : null}
        {queue ? <VerificationQueue queue={queue} /> : null}
      </div>
    </AppShell>
  );
}
