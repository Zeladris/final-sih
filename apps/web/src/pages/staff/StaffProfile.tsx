import { useEffect, useState } from 'react';
import type { District, ProcurementCentre, StaffProfile as StaffRecord, State } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

interface StaffContext {
  centre: ProcurementCentre;
  district: District;
  state: State;
}

/**
 * Staff profile (§28).
 *
 * Read-only. Centre assignment is deliberately not editable here — moving a
 * staff member between centres changes what they can see, so it belongs to an
 * authorized administrative process, not a self-service form.
 */
export function StaffProfile(): JSX.Element {
  const t = useT();
  const { profile } = useAuth();

  const [staff, setStaff] = useState<StaffRecord | null>(null);
  const [context, setContext] = useState<StaffContext | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ staff: StaffRecord }>('/api/staff/me'),
      api.get<StaffContext>('/api/staff/me/centre'),
    ])
      .then(([me, ctx]) => {
        setStaff(me.staff);
        setContext(ctx);
      })
      .catch(setError);
  }, []);

  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader
        centre={
          context
            ? {
                centreId: context.centre.id,
                centreCode: context.centre.code,
                centreName: context.centre.name,
                districtName: context.district.name,
                stateName: context.state.name,
                village: context.centre.village,
                openTime: context.centre.openTime,
                closeTime: context.centre.closeTime,
                dailyCapacityQtl: context.centre.dailyCapacityQtl,
              }
            : undefined
        }
      />

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {error ? <ErrorPanel error={error} /> : null}

        {!staff || !context ? (
          error ? null : <Spinner label={t('common.loading')} />
        ) : (
          <>
            <section className="card">
              <h1 className="text-xl font-semibold text-stone-900">{t('staff.profile.title')}</h1>
              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label={t('registration.personal.fullName')} value={profile?.name ?? null} />
                <Field label={t('staff.profile.employeeId')} value={staff.employeeReferenceId} />
                <Field label={t('staff.profile.designation')} value={staff.designation} />
                <Field label={t('staff.profile.role')} value={t('role.CENTRE_STAFF')} />
              </dl>
            </section>

            <section className="card">
              <h2 className="font-semibold text-stone-900">{t('staff.profile.assignment')}</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label={t('staff.centre.title')} value={context.centre.name} />
                <Field label={t('staff.centre.code')} value={context.centre.code} />
                <Field label={t('registration.address.district')} value={context.district.name} />
                <Field label={t('registration.address.state')} value={context.state.name} />
              </dl>
              <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                {t('staff.profile.assignmentNote')}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }): JSX.Element {
  const t = useT();
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className={`text-sm ${value ? 'text-stone-900' : 'text-stone-400'}`}>
        {value ?? t('common.notProvided')}
      </dd>
    </div>
  );
}
