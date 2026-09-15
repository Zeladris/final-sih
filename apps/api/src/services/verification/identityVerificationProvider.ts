import type { VerificationStatus } from '@kisansetu/shared';

/**
 * Identity verification boundary (§4.3, §57).
 *
 * The application depends on this interface, never on a specific provider.
 * Adding an authorised Aadhaar integration later is a new implementation of
 * this interface plus a registry entry — no change to onboarding, the farmer
 * profile, RLS or the UI.
 */

export type IdentityVerificationMethod = 'MOBILE_OTP' | 'AADHAAR' | 'MANUAL_REVIEW';

export interface IdentityVerificationRequest {
  userId: string;
  /** The phone already verified by Supabase Auth, in E.164. */
  verifiedPhone: string | null;
}

export interface IdentityVerificationResult {
  status: VerificationStatus;
  method: IdentityVerificationMethod;
  /**
   * Human-readable provenance shown in the UI. It must describe what was
   * *actually* checked. "Aadhaar Verified" may only ever appear here when a
   * real UIDAI-authorised integration produced it (§4.1, §49, §60.15).
   */
  evidenceLabel: string;
  /** Opaque provider reference, if any. Never an identity number (§48). */
  providerReference: string | null;
  verifiedAt: string | null;
}

export interface IdentityVerificationProvider {
  readonly method: IdentityVerificationMethod;
  /** False when the provider is a declared placeholder rather than a working integration. */
  readonly isAvailable: boolean;
  verifyIdentity(input: IdentityVerificationRequest): Promise<IdentityVerificationResult>;
}

/**
 * What Phase 0 can honestly assert: Supabase Auth verified control of a
 * mobile number. That is a real check, and it is all this claims.
 *
 * Note that this returns VERIFIED for *identity* only. Overall farmer
 * verification also requires land and document checks (§15.1), so passing
 * OTP does not make anybody a verified farmer.
 */
export class MobileOtpIdentityProvider implements IdentityVerificationProvider {
  readonly method: IdentityVerificationMethod = 'MOBILE_OTP';
  readonly isAvailable = true;

  async verifyIdentity(input: IdentityVerificationRequest): Promise<IdentityVerificationResult> {
    if (!input.verifiedPhone) {
      return {
        status: 'PENDING',
        method: this.method,
        evidenceLabel: 'Mobile number not yet verified',
        providerReference: null,
        verifiedAt: null,
      };
    }

    return {
      status: 'VERIFIED',
      method: this.method,
      evidenceLabel: 'Mobile number verified by OTP',
      providerReference: null,
      verifiedAt: new Date().toISOString(),
    };
  }
}

/**
 * PLACEHOLDER — NOT AN INTEGRATION.
 *
 * This exists so the seam is visible and typed. It deliberately does not:
 *   - call any endpoint,
 *   - fabricate a UIDAI response,
 *   - accept or store an Aadhaar number.
 *
 * It always refuses. Wiring it up requires a legitimate authorised UIDAI/AUA
 * integration and a privacy review; until then, refusing is the correct
 * behaviour and the honest one (§4.1, §60.2).
 */
export class AadhaarIdentityProvider implements IdentityVerificationProvider {
  readonly method: IdentityVerificationMethod = 'AADHAAR';
  readonly isAvailable = false;

  async verifyIdentity(): Promise<IdentityVerificationResult> {
    throw new Error(
      'AadhaarIdentityProvider is a placeholder. No authorised UIDAI integration is configured, ' +
        'and this application will not simulate one.',
    );
  }
}

/**
 * Manual review by a government officer. The status it returns is decided by
 * a human, not by this code, so it starts as UNDER_REVIEW.
 */
export class ManualReviewIdentityProvider implements IdentityVerificationProvider {
  readonly method: IdentityVerificationMethod = 'MANUAL_REVIEW';
  readonly isAvailable = true;

  async verifyIdentity(): Promise<IdentityVerificationResult> {
    return {
      status: 'UNDER_REVIEW',
      method: this.method,
      evidenceLabel: 'Awaiting review by a procurement officer',
      providerReference: null,
      verifiedAt: null,
    };
  }
}

const providers: Record<IdentityVerificationMethod, IdentityVerificationProvider> = {
  MOBILE_OTP: new MobileOtpIdentityProvider(),
  AADHAAR: new AadhaarIdentityProvider(),
  MANUAL_REVIEW: new ManualReviewIdentityProvider(),
};

export function getIdentityVerificationProvider(
  method: IdentityVerificationMethod,
): IdentityVerificationProvider {
  return providers[method];
}

/** The strongest identity check this deployment can actually perform today. */
export function activeIdentityProvider(): IdentityVerificationProvider {
  return providers.AADHAAR.isAvailable ? providers.AADHAAR : providers.MOBILE_OTP;
}
