import { describe, expect, it } from 'vitest';
import {
  acceptedQuantity,
  canTransitionPayment,
  computePaymentAmounts,
  parseDecimal,
  ratePerQuintal,
} from '@kisansetu/shared';

/** Phase 8 §2, §7, §29, §36: the money is exact and the lifecycle is closed. */
describe('payment calculation', () => {
  it('pays for the accepted quantity at the applied rate, exactly (spec §48 example)', () => {
    const accepted = acceptedQuantity('960', '20');
    expect(accepted).toBe('940.000');
    expect(computePaymentAmounts({ acceptedQuantityKg: accepted, ratePerKg: '23' })).toMatchObject({
      gross: '21620.00',
      deductions: '0.00',
      net: '21620.00',
    });
  });

  it('never suffers floating-point error', () => {
    // 0.1 × 3 in floats is 0.30000000000000004; in paise it is 30.
    expect(computePaymentAmounts({ acceptedQuantityKg: '0.1', ratePerKg: '3' }).gross).toBe('0.30');
    // 487.25 × 23.2 — the Phase 5 fixture — to the paisa.
    expect(computePaymentAmounts({ acceptedQuantityKg: '487.25', ratePerKg: '23.2' }).gross).toBe('11304.20');
  });

  it('rounds half a paisa up, as numeric round() does in the database', () => {
    // 0.005 kg × ₹1 = ₹0.005 → ₹0.01
    expect(computePaymentAmounts({ acceptedQuantityKg: '0.005', ratePerKg: '1' }).gross).toBe('0.01');
    // 1.234 kg × ₹23.2 = ₹28.6288 → ₹28.63
    expect(computePaymentAmounts({ acceptedQuantityKg: '1.234', ratePerKg: '23.2' }).gross).toBe('28.63');
  });

  it('refuses precision it would have to invent', () => {
    expect(() => parseDecimal('1.2345', 3)).toThrow();
    expect(() => acceptedQuantity('100', '100')).toThrow();
  });

  it('shows per-quintal rates without mixing units', () => {
    expect(ratePerQuintal('23.2')).toBe('2320');
    expect(ratePerQuintal('23.2050')).toBe('2320.5');
  });
});

describe('payment state machine', () => {
  it('allows the documented lifecycle and its recovery path', () => {
    expect(canTransitionPayment('PENDING', 'INITIATED')).toBe(true);
    expect(canTransitionPayment('INITIATED', 'PROCESSING')).toBe(true);
    expect(canTransitionPayment('PROCESSING', 'SUCCESS')).toBe(true);
    expect(canTransitionPayment('PROCESSING', 'FAILED')).toBe(true);
    expect(canTransitionPayment('FAILED', 'RETRY_PENDING')).toBe(true);
    expect(canTransitionPayment('RETRY_PENDING', 'INITIATED')).toBe(true);
  });

  it('treats SUCCESS as terminal and refuses skipped steps', () => {
    expect(canTransitionPayment('SUCCESS', 'PROCESSING')).toBe(false);
    expect(canTransitionPayment('SUCCESS', 'FAILED')).toBe(false);
    expect(canTransitionPayment('PENDING', 'SUCCESS')).toBe(false);
    expect(canTransitionPayment('FAILED', 'INITIATED')).toBe(false);
  });
});
