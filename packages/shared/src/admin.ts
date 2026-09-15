import type { PaymentStatus } from './operations.js';
import type { QualityRisk } from './queue.js';

/**
 * District & State admin analytics (Phase 12).
 *
 * Read models only. Every figure is aggregated on the server from persisted
 * operational records, inside the admin's own scope. A metric that cannot be
 * derived is `null` — "not available" — never a fabricated zero.
 */

export type AdminScopeKind = 'DISTRICT' | 'STATE';

export interface AdminMe {
  role: 'DISTRICT_ADMIN' | 'STATE_ADMIN';
  name: string | null;
  employeeReferenceId: string | null;
  scope: AdminScopeKind;
  state: { id: string; name: string } | null;
  district: { id: string; name: string } | null;
  centreCount: number;
  districtCount: number;
}

export interface AdminPeriod {
  /** Inclusive calendar dates in the business timezone. */
  from: string;
  to: string;
  /** The equal-length period immediately before, for change figures. */
  previousFrom: string;
  previousTo: string;
  days: number;
}

/** A value with its previous-period counterpart; change only when both exist. */
export interface Compared {
  current: number | null;
  previous: number | null;
  /** (current − previous) / previous, or null when not computable. */
  changeRatio: number | null;
}

export type CentreStatus = 'OPERATIONAL' | 'HIGH_LOAD' | 'DELAYED' | 'LOW_ACTIVITY' | 'CLOSED' | 'INACTIVE';

export interface TrendPoint {
  date: string;
  acceptedKg: string;
  value: string;
  farmersServed: number;
}

export interface FunnelStep {
  step: 'BOOKED' | 'ARRIVED' | 'QUALITY_CHECKED' | 'QUEUED' | 'PROCURED' | 'PAID';
  count: number;
}

export interface WaitSummary {
  count: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  maxMinutes: number | null;
}

export interface ProcurementBlock {
  completedProcurements: number;
  acceptedKg: string;
  value: string;
  averageValue: string | null;
  farmersServed: number;
}

export interface OperationsBlock {
  queueWait: WaitSummary;
  averageProcessingMinutes: number | null;
  farmersPerHour: number | null;
  averageQueueLength: number | null;
  /** Booked ÷ capacity over the period's slots. */
  slotUtilisation: number | null;
  /** Busy station-minutes ÷ available station-minutes while sessions were open. */
  workstationUtilisation: number | null;
  averageSlotDelayMinutes: number | null;
}

export interface QueueBlock {
  longWaitCases: number;
  starvationEvents: number;
  maxWaitProtections: number;
  reorders: number;
  selectionOverrides: number;
  /** FCFS vs FA-DQO on the same recorded workload (Phase 7 simulation). */
  comparison: {
    workloadSize: number;
    fcfs: WaitSummary & { starvationEvents: number };
    optimized: WaitSummary & { starvationEvents: number };
  } | null;
}

export interface QualityBlock {
  officialResults: { PASSED: number; CONDITIONAL: number; FAILED: number };
  aiAssessments: number;
  aiUnavailable: number;
  aiRiskDistribution: Record<QualityRisk, number>;
  aiLowConfidenceRate: number | null;
  averagePredictedScore: number | null;
  manualInspectionRate: number | null;
  modelVersions: string[];
  /** Always true today: the models are trained on synthetic development data. */
  developmentModelsOnly: boolean;
}

export interface PaymentBlock {
  byStatus: Record<PaymentStatus, number>;
  totalPaid: string;
  totalPayable: string;
  completionRate: number | null;
  averageSettlementSeconds: number | null;
  demoPayments: number;
}

export interface BookingBlock {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  noShow: number;
  funnel: FunnelStep[];
}

export interface CropRow {
  cropId: string | null;
  crop: string;
  acceptedKg: string;
  value: string;
  farmers: number;
  aiRisk: Record<QualityRisk, number>;
}

export interface FarmerBlock {
  /** Current counts for farmers registered in the scope's districts. */
  registered: number;
  verified: number;
  pendingReview: number;
  underReview: number;
  actionRequired: number;
  rejected: number;
  draft: number;
}

export interface LiveBlock {
  /** Right now — independent of the reporting period. */
  asOf: string;
  centresOperating: number;
  arrivalsToday: number;
  inQueue: number;
  processing: number;
}

export interface AdminAlert {
  code:
    | 'HIGH_AVERAGE_WAIT'
    | 'QUEUE_OVERLOAD'
    | 'SLOT_DELAYS'
    | 'PAYMENT_FAILURES'
    | 'HIGH_MANUAL_REVIEW'
    | 'LOW_CONFIDENCE_AI'
    | 'CENTRE_NOT_OPENED'
    | 'HIGH_CANCELLATION';
  severity: 'WARNING' | 'SERIOUS';
  centreId: string;
  centreName: string;
  districtName: string | null;
  /** The measured value and the configured threshold it crossed. */
  value: number;
  threshold: number;
  unit: 'MINUTES' | 'COUNT' | 'RATIO';
  live: boolean;
}

export interface Ranking {
  metric: 'LOWEST_AVERAGE_WAIT' | 'HIGHEST_THROUGHPUT' | 'HIGHEST_SLOT_UTILISATION' | 'HIGHEST_VOLUME' | 'HIGHEST_PAYMENT_COMPLETION';
  entries: Array<{ centreId: string; centreName: string; value: number }>;
  /** Centres with fewer completed procurements are not ranked (noise). */
  minimumSample: number;
}

export interface CentrePerformanceRow {
  centreId: string;
  code: string;
  name: string;
  districtId: string;
  districtName: string | null;
  status: CentreStatus;
  farmersServed: number;
  acceptedKg: string;
  value: string;
  averageWaitMinutes: number | null;
  averageProcessingMinutes: number | null;
  farmersPerHour: number | null;
  currentQueue: number;
  slotUtilisation: number | null;
  paymentsPending: number;
  paymentCompletionRate: number | null;
}

export interface DistrictSummaryRow {
  districtId: string;
  districtName: string;
  centres: number;
  farmersServed: number;
  acceptedKg: string;
  value: string;
  averageWaitMinutes: number | null;
  averageProcessingMinutes: number | null;
  farmersPerHour: number | null;
  paymentCompletionRate: number | null;
}

export interface AdminOverview {
  scope: AdminScopeKind;
  period: AdminPeriod;
  centres: { total: number; operating: number; highLoad: number; closedOrInactive: number };
  live: LiveBlock;
  farmers: FarmerBlock;
  bookings: BookingBlock;
  procurement: ProcurementBlock;
  operations: OperationsBlock;
  queue: QueueBlock;
  quality: QualityBlock;
  payments: PaymentBlock;
  crops: CropRow[];
  trends: TrendPoint[];
  changes: {
    averageWaitMinutes: Compared;
    averageProcessingMinutes: Compared;
    farmersServed: Compared;
    value: Compared;
  };
  rankings: Ranking[];
  alerts: AdminAlert[];
  /** STATE only: the district comparison layer inside the overview. */
  districts: DistrictSummaryRow[] | null;
}

export interface CentrePerformancePage {
  rows: CentrePerformanceRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CentreDetail {
  centre: {
    id: string;
    code: string;
    name: string;
    districtName: string | null;
    village: string | null;
    isActive: boolean;
    status: CentreStatus;
    openTime: string | null;
    closeTime: string | null;
  };
  period: AdminPeriod;
  today: { bookings: number; arrivals: number; inQueue: number; processing: number; completed: number; paymentsCompleted: number };
  procurement: ProcurementBlock;
  operations: OperationsBlock;
  queue: QueueBlock;
  quality: QualityBlock;
  payments: PaymentBlock;
  bookings: BookingBlock;
  crops: CropRow[];
  trends: TrendPoint[];
  alerts: AdminAlert[];
}

export const ADMIN_EXPORT_REPORTS = ['centre-performance', 'crop-procurement', 'payment-summary', 'queue-performance'] as const;
export type AdminExportReport = (typeof ADMIN_EXPORT_REPORTS)[number];
