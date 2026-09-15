import { env } from '../../config/env.js';
import { DemoPaymentProvider } from './providers/demoPaymentProvider.js';

/**
 * Payment provider boundary (§12).
 *
 * The payment service speaks only this interface. A government DBT adapter,
 * a bank integration or an authorised gateway is a new implementation of it,
 * registered below — the state machine, calculation, history and UI do not
 * change (§39).
 */

export interface PaymentInitiationInput {
  /** Our reference for the payment. Never replaced by a provider's. */
  paymentReference: string;
  /** Unique per attempt; what the provider sees as the client reference. */
  attemptReference: string;
  procurementReference: string;
  /** Exact amount in paise. */
  amountPaise: bigint;
  currency: 'INR';
  farmerUserId: string;
  method: string;
  /** Honoured only by the demo provider; real providers ignore it. */
  demoScenario?: 'SUCCESS' | 'FAIL';
}

export interface ProviderOutcome {
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  providerReference: string | null;
  providerTransactionId: string | null;
  /** Internal code for staff and logs — never shown to a farmer (§20). */
  failureCode: string | null;
  failureReason: string | null;
}

export interface WebhookEvent {
  providerReference: string;
  outcome: ProviderOutcome;
}

export interface PaymentProvider {
  readonly name: string;
  /** True when no money moves. Every screen says so (§13). */
  readonly isDemo: boolean;

  initiatePayment(input: PaymentInitiationInput): Promise<ProviderOutcome>;
  /** Asked with the provider reference (or our attempt reference if the provider never answered). */
  getPaymentStatus(reference: string): Promise<ProviderOutcome>;
  retryPayment(input: PaymentInitiationInput): Promise<ProviderOutcome>;

  /**
   * Verifies and parses an asynchronous confirmation (§37). Providers that do
   * not send webhooks leave this out, and the webhook route refuses them.
   * Must verify a signature before returning anything.
   */
  verifyWebhook?(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): Promise<WebhookEvent | null>;
}

let provider: PaymentProvider | null = null;

export function activePaymentProvider(): PaymentProvider {
  if (provider) return provider;
  switch (env.PAYMENT_PROVIDER) {
    case 'demo':
      provider = new DemoPaymentProvider(env.PAYMENT_DEMO_SETTLE_SECONDS);
      break;
  }
  return provider!;
}

/** For tests, and for registering a real adapter. */
export function setPaymentProvider(next: PaymentProvider | null): void {
  provider = next;
}
