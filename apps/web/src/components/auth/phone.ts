/**
 * One canonical phone representation (§6).
 *
 * Everything stores and sends E.164 (`+919876543210`); the farmer types
 * whatever is natural. Having exactly one normaliser is what stops the same
 * person becoming two accounts because they typed `0` in front one day.
 */

const E164 = /^\+91[6-9]\d{9}$/;

/** Accepts `9876543210`, `09876543210`, `+91 98765 43210`, `919876543210`. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '');

  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;

  return input.trim();
}

export function isValidPhone(value: string): boolean {
  return E164.test(value);
}

/**
 * Masks all but the last four digits for display (§8).
 *
 * Shown after the code is sent so the farmer can confirm they typed the right
 * number, without printing it in full on a shared screen.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.length < 4) return e164;
  return `+91 ••••••${digits.slice(-4)}`;
}

/** Groups for readability while typing: `98765 43210`. */
export function formatForDisplay(input: string): string {
  const digits = input.replace(/\D/g, '').slice(-10);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}
