import type { Translate } from '../../i18n/index.js';

/**
 * Localised label for a machine code (reason codes, statuses).
 *
 * Codes are stored and sent as stable identifiers and translated only here
 * (§41). A code the UI does not know yet — say, a new reason from a newer
 * model — is shown as the code itself rather than as nothing.
 */
export function codeLabel(t: Translate, prefix: string, code: string): string {
  const key = `${prefix}.${code}`;
  const label = t(key);
  return label === key ? code : label;
}

export function minutesLabel(t: Translate, minutes: number | null): string {
  return minutes === null ? '—' : t('queue.minutes', { minutes: Math.round(minutes) });
}
