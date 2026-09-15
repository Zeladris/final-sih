import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StaffPaymentRow } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { StaffPaymentPanel, StatusBadge } from '../../features/payments/StaffPaymentPanel.js';
import { formatInr, formatKg } from '../../features/payments/format.js';

/**
 * Today's payments at this centre, plus anything still unresolved (§26).
 * Every row is a persisted payment; there are no placeholder cards.
 */
export function StaffPayments(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [rows, setRows] = useState<StaffPaymentRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ payments: StaffPaymentRow[] }>('/api/staff/me/payments')
      .then((data) => setRows(data.payments))
      .catch(setError);
  }, []);

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-stone-900">{t('payment.listTitle')}</h1>
      {error ? <ErrorPanel error={error} /> : null}
      {!rows && !error ? <Spinner label={t('payment.checking')} /> : null}

      {rows && rows.length === 0 ? (
        <p className="card text-center text-sm text-stone-600">{t('payment.listEmpty')}</p>
      ) : null}

      {rows && rows.length > 0 ? (
        <section className="card overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500">
                <th className="py-1 pr-2 font-medium" scope="col">{t('payment.farmer')}</th>
                <th className="py-1 pr-2 font-medium" scope="col">{t('dashboard.procurement.crop')}</th>
                <th className="py-1 pr-2 font-medium" scope="col">{t('payment.accepted')}</th>
                <th className="py-1 pr-2 font-medium" scope="col">{t('payment.net')}</th>
                <th className="py-1 font-medium" scope="col">{t('payment.statusLabel')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.paymentId} className="border-t border-stone-100">
                  <td className="py-2 pr-2">
                    <Link to={`/staff/procurements/${row.procurementId}/payment`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                      {row.farmerName ?? row.procurementReference}
                    </Link>
                    <p className="font-mono text-xs text-stone-500">{row.procurementReference}</p>
                  </td>
                  <td className="py-2 pr-2">{row.cropName}</td>
                  <td className="py-2 pr-2">{formatKg(row.acceptedQuantityKg, language)} {t('ops.kg')}</td>
                  <td className="py-2 pr-2 font-mono">{formatInr(row.netAmount, language)}</td>
                  <td className="py-2">
                    <StatusBadge status={row.status} />
                    {row.isDemo ? <span className="ml-1 text-xs text-sky-800">{t('payment.demoShort')}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </Shell>
  );
}

/** /staff/procurements/:procurementId/payment — the full payment record (§27). */
export function StaffProcurementPayment(): JSX.Element {
  const t = useT();
  const { procurementId = '' } = useParams();
  return (
    <Shell>
      <Link to="/staff/payments" className="text-sm text-stone-600 underline underline-offset-2">
        ← {t('payment.listTitle')}
      </Link>
      <StaffPaymentPanel procurementId={procurementId} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
