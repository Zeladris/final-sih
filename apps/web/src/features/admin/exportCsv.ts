import type { AdminExportReport } from '@kisansetu/shared';
import { config } from '../../lib/env.js';
import { supabase } from '../../lib/supabase.js';
import { ApiRequestError } from '../../lib/api.js';

/**
 * Downloads a scoped CSV (§35). The request carries the admin's own token, so
 * the export is authorised — and scoped — exactly like the dashboard.
 */
export async function downloadReport(report: AdminExportReport, query: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(`${config.apiUrl}/api/admin/export/${report}${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new ApiRequestError(response.status, 'INTERNAL_ERROR', 'The export could not be prepared.', null);

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${report}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
