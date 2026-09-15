import type { Request, Response } from 'express';
import type { AdminExportReport, CentreStatus } from '@kisansetu/shared';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import { resolveScope } from '../services/admin/adminScope.js';
import {
  exportReport,
  getAdminMe,
  getAlerts,
  getAnalyticsSection,
  getCentreDetail,
  getCentrePerformance,
  getDistrictSummary,
  getOverview,
} from '../services/admin/adminAnalyticsService.js';
import type { AdminQuery } from '../services/admin/adminAnalyticsService.js';

/**
 * Admin analytics endpoints (Phase 12 §29).
 *
 * Query parameters can only NARROW what the admin sees; the scope itself comes
 * from their profile inside resolveScope(). Every response is an aggregate —
 * no farmer names, phones or documents (§36).
 */

const q = (req: Request): AdminQuery => {
  const query = req.query as Record<string, string | undefined>;
  return { from: query.from, to: query.to, districtId: query.districtId, cropId: query.cropId };
};

const noStore = (res: Response): void => {
  res.set('Cache-Control', 'no-store');
};

export async function getMe(req: Request, res: Response): Promise<void> {
  res.json(await getAdminMe(authOf(req)));
}

export async function getDashboard(req: Request, res: Response): Promise<void> {
  noStore(res);
  res.json(await getOverview(authOf(req), q(req)));
}

export async function getScopedCentres(req: Request, res: Response): Promise<void> {
  const scope = await resolveScope(authOf(req), { districtId: q(req).districtId });
  res.json({ scope: scope.kind, districts: scope.districts, centres: scope.centres });
}

export async function getPerformance(req: Request, res: Response): Promise<void> {
  const query = req.query as Record<string, string | undefined>;
  noStore(res);
  res.json(
    await getCentrePerformance(authOf(req), {
      ...q(req),
      search: query.search,
      status: query.status as CentreStatus | undefined,
      sort: query.sort,
      dir: query.dir === 'desc' ? 'desc' : 'asc',
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    }),
  );
}

export async function getCentre(req: Request, res: Response): Promise<void> {
  noStore(res);
  res.json(await getCentreDetail(authOf(req), req.params.centreId as string, q(req)));
}

export async function getDistricts(req: Request, res: Response): Promise<void> {
  noStore(res);
  res.json(await getDistrictSummary(authOf(req), q(req)));
}

export async function getAdminAlerts(req: Request, res: Response): Promise<void> {
  noStore(res);
  res.json(await getAlerts(authOf(req), q(req)));
}

export async function getSection(req: Request, res: Response): Promise<void> {
  noStore(res);
  res.json(await getAnalyticsSection(authOf(req), req.params.section as string, q(req)));
}

export async function getExport(req: Request, res: Response): Promise<void> {
  const report = req.params.report as AdminExportReport;
  const { filename, body } = await exportReport(authOf(req), report, q(req));

  // An export leaves the system: it is recorded like any other data access.
  await recordAudit(req, {
    action: 'DATA_EXPORTED',
    entityType: 'admin_report',
    entityId: null,
    metadata: { report, from: req.query.from ?? null, to: req.query.to ?? null, districtId: req.query.districtId ?? null },
  });

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  // BOM so spreadsheet software reads Tamil and ₹ correctly.
  res.send(`﻿${body}`);
}
