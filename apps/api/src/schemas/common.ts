import { z } from 'zod';
import { ALL_LANGUAGES, businessToday } from '@kisansetu/shared';
import { env } from '../config/env.js';

export const uuidSchema = z.string().uuid('Expected a valid id.');

export const idParamSchema = z.object({ id: uuidSchema });

/**
 * Indian mobile number in E.164. Supabase Auth is what actually sends and
 * verifies the OTP; this is here so a malformed number is rejected before it
 * reaches a provider or a profile row.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+91[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number, e.g. +919876543210');

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a 6-digit PIN code.');

export const preferredLanguageSchema = z.enum(ALL_LANGUAGES as unknown as [string, ...string[]]).default('en');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your full name.')
  .max(120, 'That name is too long.');

/** Optional free text that normalises "" to null so empty inputs clear a column. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/**
 * An external link a farmer will be shown as clickable (an official scheme or
 * helpline URL). `z.string().url()` only checks syntax — it happily accepts
 * `javascript:` and `data:` as "valid URLs" — so a malicious or careless
 * admin submission could otherwise become a stored XSS vector the moment the
 * frontend renders it as an `<a href>`. Restricting the scheme to http/https
 * is the actual security boundary; `.url()` just catches typos on top of it.
 */
export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'Enter a valid http:// or https:// link.');

/**
 * A calendar date, never an instant (§46). Rejecting a full ISO timestamp
 * here is deliberate: it is how the old timezone bug used to creep back in.
 */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, 'That date does not exist.');

/**
 * A calendar date that has already happened, judged in the business timezone
 * rather than the server's — a server in UTC would otherwise reject a
 * same-day Indian date for five and a half hours (§46).
 */
export const pastCalendarDateSchema = calendarDateSchema.refine(
  (value) => value <= businessToday(env.APP_TIMEZONE),
  'That date is in the future.',
);
