import type {
  PaymentInitiationInput,
  PaymentProvider,
  ProviderOutcome,
} from '../paymentProvider.js';

/**
 * DEMO payment provider (§13). MOVES NO MONEY.
 *
 * Deterministic and stateless: the provider reference it returns encodes the
 * attempt, the scenario and when it was made —
 *
 *     DEMO-<attemptReference>-<S|F>-<epochSeconds>
 *
 * — so "what is the status of this transfer?" has exactly one answer, on any
 * server, after any restart:
 *
 *     younger than the settle time  → PROCESSING
 *     older, scenario S             → SUCCESS
 *     older, scenario F             → FAILED (DEMO_SIMULATED_FAILURE)
 *
 * The FAIL scenario exists so the failure-and-retry path can be demonstrated
 * with the real state machine. Everything this provider touches is stored
 * with `is_demo = true` and shown as a demo payment.
 */
export class DemoPaymentProvider implements PaymentProvider {
  readonly name = 'DEMO';
  readonly isDemo = true;

  constructor(private readonly settleSeconds: number) {}

  async initiatePayment(input: PaymentInitiationInput): Promise<ProviderOutcome> {
    const scenario = input.demoScenario === 'FAIL' ? 'F' : 'S';
    const reference = `DEMO-${input.attemptReference}-${scenario}-${Math.floor(Date.now() / 1000)}`;
    return this.outcomeFor(reference);
  }

  async retryPayment(input: PaymentInitiationInput): Promise<ProviderOutcome> {
    return this.initiatePayment(input);
  }

  async getPaymentStatus(reference: string): Promise<ProviderOutcome> {
    return this.outcomeFor(reference);
  }

  private outcomeFor(reference: string): ProviderOutcome {
    const match = /^DEMO-.+-([SF])-(\d+)$/.exec(reference);
    if (!match) {
      // Not one of ours: a demo provider cannot vouch for it.
      return {
        status: 'FAILED',
        providerReference: reference,
        providerTransactionId: null,
        failureCode: 'DEMO_UNKNOWN_REFERENCE',
        failureReason: 'The demo provider has no record of this reference.',
      };
    }

    const [, scenario, issuedAt] = match;
    const settled = Date.now() / 1000 - Number(issuedAt) >= this.settleSeconds;

    if (!settled) {
      return { status: 'PROCESSING', providerReference: reference, providerTransactionId: null, failureCode: null, failureReason: null };
    }

    if (scenario === 'F') {
      return {
        status: 'FAILED',
        providerReference: reference,
        providerTransactionId: null,
        failureCode: 'DEMO_SIMULATED_FAILURE',
        failureReason: 'Demo: a failed transfer was simulated on purpose.',
      };
    }

    return {
      status: 'SUCCESS',
      providerReference: reference,
      providerTransactionId: `DEMOTXN-${issuedAt}-${reference.length}`,
      failureCode: null,
      failureReason: null,
    };
  }
}
