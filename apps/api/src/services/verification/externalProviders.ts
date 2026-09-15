/**
 * Integration boundaries for systems we do not have (§39).
 *
 * Every one of these is an interface plus a placeholder that refuses. None of
 * them calls anything, fabricates a response, or lets the application claim a
 * verification that did not happen. Phase 1 is fully functional without them:
 * where an official source is unavailable, the product collects information
 * and supporting documents for authorised human review, and says so.
 *
 * Adding a real integration later means writing an implementation of the
 * interface and registering it — no change to registration, the schema or the UI.
 */

export class IntegrationNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(
      `${providerName} is a placeholder. No authorised integration is configured, and this ` +
        'application will not simulate one.',
    );
    this.name = 'IntegrationNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Land verification (§14)
// ---------------------------------------------------------------------------

export interface LandVerificationRequest {
  farmerUserId: string;
  landHoldingId: string;
  surveyNumber: string | null;
  districtId: string | null;
  stateId: string | null;
}

export interface LandVerificationResult {
  /** UNDER_REVIEW when a human must decide; VERIFIED only from a real source. */
  status: 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';
  /** What was actually checked. Must never overstate. */
  evidenceLabel: string;
  providerReference: string | null;
}

export interface LandVerificationProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  verifyLand(input: LandVerificationRequest): Promise<LandVerificationResult>;
}

/**
 * PLACEHOLDER — no land-records integration exists.
 *
 * There is no state land-records API wired into this system. Inventing one
 * would mean asserting a farmer owns land on evidence we do not have.
 */
export class StateLandRecordsProvider implements LandVerificationProvider {
  readonly name = 'StateLandRecordsProvider';
  readonly isAvailable = false;

  async verifyLand(): Promise<LandVerificationResult> {
    throw new IntegrationNotConfiguredError(this.name);
  }
}

/**
 * What actually runs today: a procurement officer looks at the declared land
 * and the uploaded record and decides. Honest, and the only thing we can
 * truthfully offer (§14).
 */
export class ManualLandReviewProvider implements LandVerificationProvider {
  readonly name = 'ManualLandReviewProvider';
  readonly isAvailable = true;

  async verifyLand(): Promise<LandVerificationResult> {
    return {
      status: 'UNDER_REVIEW',
      evidenceLabel: 'Declared by the farmer, awaiting review by a procurement officer',
      providerReference: null,
    };
  }
}

const landProviders = {
  stateLandRecords: new StateLandRecordsProvider(),
  manualReview: new ManualLandReviewProvider(),
};

export function activeLandVerificationProvider(): LandVerificationProvider {
  return landProviders.stateLandRecords.isAvailable
    ? landProviders.stateLandRecords
    : landProviders.manualReview;
}

// ---------------------------------------------------------------------------
// Government data (§39)
// ---------------------------------------------------------------------------

export interface GovernmentFarmerRecord {
  farmerReference: string;
  source: string;
  retrievedAt: string;
}

export interface GovernmentDataProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  fetchFarmerRecord(phone: string): Promise<GovernmentFarmerRecord | null>;
}

/**
 * PLACEHOLDER — no government farmer database, DigiLocker or procurement
 * history integration exists. Nothing in registration depends on this.
 */
export class UnconfiguredGovernmentDataProvider implements GovernmentDataProvider {
  readonly name = 'UnconfiguredGovernmentDataProvider';
  readonly isAvailable = false;

  async fetchFarmerRecord(): Promise<GovernmentFarmerRecord | null> {
    throw new IntegrationNotConfiguredError(this.name);
  }
}

export function governmentDataProvider(): GovernmentDataProvider {
  return new UnconfiguredGovernmentDataProvider();
}
