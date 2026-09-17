import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_DOCUMENT_KINDS,
  ALL_GENDERS,
  ALL_LAND_AREA_UNITS,
  ALL_LAND_OWNERSHIP_TYPES,
  ALL_REGISTRATION_STATUSES,
  ALL_ROLES,
  ALL_VERIFICATION_CHECK_TYPES,
  STEP_SEQUENCE,
} from '@kisansetu/shared';

/**
 * Localisation completeness (§4, §44).
 *
 * English is the reference bundle. Tamil must cover every key, because a
 * missing one silently falls back to English and a farmer ends up reading a
 * half-translated screen — which is exactly the failure this catches.
 *
 * It also checks that every enum value the UI renders through a key actually
 * has one, so adding a new document kind or status cannot ship untranslated.
 */

const bundleDir = resolve(process.cwd(), '../web/src/i18n');

function load(name: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(bundleDir, name), 'utf8')) as Record<string, string>;
}

const en = load('en.json');

/**
 * Every non-English language, with the Unicode block its script lives in.
 *
 * The script check is what stops a bundle being "complete" by copying the
 * English string into every value — a missing translation must be visibly
 * missing, not silently passing as done.
 */
const TRANSLATIONS = [
  { code: 'ta', name: 'Tamil', bundle: load('ta.json'), script: /[஀-௿]/ },
  { code: 'kn', name: 'Kannada', bundle: load('kn.json'), script: /[ಀ-೿]/ },
  { code: 'hi', name: 'Hindi', bundle: load('hi.json'), script: /[ऀ-ॿ]/ },
  { code: 'ml', name: 'Malayalam', bundle: load('ml.json'), script: /[ഀ-ൿ]/ },
] as const;

describe('translation bundles', () => {
  it.each(TRANSLATIONS)('has $name for every English key', ({ code, bundle }) => {
    const missing = Object.keys(en).filter((key) => !(key in bundle));
    expect(missing, `missing ${code} keys (${missing.length}): ${missing.slice(0, 20).join(', ')}`).toEqual(
      [],
    );
  });

  it.each(TRANSLATIONS)('has no $name key that English does not define', ({ code, bundle }) => {
    const extra = Object.keys(bundle).filter((key) => !(key in en));
    expect(extra, `stray ${code} keys: ${extra.join(', ')}`).toEqual([]);
  });

  it('has no blank values in any bundle', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key} is blank`).not.toBe('');
    }
    for (const { code, bundle } of TRANSLATIONS) {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value.trim(), `${code}.${key} is blank`).not.toBe('');
      }
    }
  });

  it.each(TRANSLATIONS)('keeps placeholders identical in $name', ({ code, bundle }) => {
    const placeholders = (value: string): string[] => (value.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of Object.keys(en)) {
      const translated = bundle[key];
      if (translated === undefined) continue; // covered by the completeness test
      expect(placeholders(translated), `placeholders differ for ${code}.${key}`).toEqual(
        placeholders(en[key] as string),
      );
    }
  });

  it.each(TRANSLATIONS)('actually contains $name script, not copied English', ({ bundle, script }) => {
    // A handful of entries are legitimately identical (proper nouns, numerals,
    // "JPEG"), so require the overwhelming majority rather than all of them.
    const translated = Object.values(bundle).filter((value) => script.test(value));
    expect(translated.length / Object.keys(bundle).length).toBeGreaterThan(0.85);
  });
});

describe('enum coverage', () => {
  const expectKeys = (keys: string[]): void => {
    const missing = keys.filter((key) => !(key in en));
    expect(missing, `no translation key for: ${missing.join(', ')}`).toEqual([]);
  };

  it('covers every registration status', () => {
    expectKeys(
      ALL_REGISTRATION_STATUSES.flatMap((status) => [
        `status.${status}.heading`,
        `status.${status}.body`,
      ]),
    );
  });

  it('covers every registration step', () => {
    expectKeys(STEP_SEQUENCE.map((step) => `registration.step.${step}`));
  });

  it('covers every document status', () => {
    expectKeys(
      ['UPLOADED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'REPLACEMENT_REQUIRED'].map(
        (status) => `document.status.${status}`,
      ),
    );
  });

  it('covers every document kind', () => {
    const toKey = (kind: string): string =>
      kind.toLowerCase().replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());
    expectKeys(ALL_DOCUMENT_KINDS.map((kind) => `document.kind.${toKey(kind)}`));
  });

  it('covers land ownership types and units', () => {
    expectKeys(ALL_LAND_OWNERSHIP_TYPES.map((type) => `land.ownership.${type}`));
    expectKeys(ALL_LAND_AREA_UNITS.map((unit) => `land.unit.${unit}`));
  });

  it('covers genders, roles and verification checks', () => {
    expectKeys(ALL_GENDERS.map((gender) => `gender.${gender}`));
    expectKeys(ALL_ROLES.map((role) => `role.${role}`));
    expectKeys(ALL_VERIFICATION_CHECK_TYPES.map((check) => `check.${check}`));
  });
});

describe('no prototype language remains', () => {
  /**
   * The ONE exception, and why it is one.
   *
   * The rule below exists to keep demo ACCOUNTS, test numbers and fake
   * verification claims out of the interface. It is not a ban on the word
   * itself: the payment provider genuinely is a demo that moves no money,
   * and Phase 8 requires saying so in as many words wherever an amount is
   * shown. The demo MSP figures are the same kind of disclosure — never an
   * official government MSP, always labelled as demo/indicative wherever a
   * rate or an estimated value is shown. Hiding either would be the
   * dishonesty this rule is protecting against, not compliance with it.
   *
   * The list is exact keys, not a prefix: a new `payment.*` or `msp.*`
   * string does not get to opt itself out of the rule by being in the same
   * namespace.
   */
  const DEMO_HONESTY_KEYS = new Set([
    'payment.demoBanner',
    'payment.demoShort',
    'payment.demoSimulateFailure',
    'admin.payments.demo',
    'msp.summary.demoBadge',
    'msp.summary.rate',
    'msp.summary.note',
  ]);

  it('mentions nothing about demos, test numbers or fake verification', () => {
    // §2 and §44: the normal application must contain no demo wording.
    const forbidden = [
      /demo/i,
      /\btest number\b/i,
      /123456/,
      /prototype/i,
      /aadhaar verified/i,
      /mock/i,
    ];

    const bundles: ReadonlyArray<readonly [string, Record<string, string>]> = [
      ['en', en],
      ...TRANSLATIONS.map(({ code, bundle }) => [code, bundle] as const),
    ];

    for (const [bundleName, bundle] of bundles) {
      for (const [key, value] of Object.entries(bundle)) {
        if (DEMO_HONESTY_KEYS.has(key)) continue;

        for (const pattern of forbidden) {
          expect(
            pattern.test(value),
            `${bundleName}.${key} contains prototype wording: "${value}"`,
          ).toBe(false);
        }
      }
    }
  });

  it('the payment exception really does say no money moves', () => {
    // The exemption is only safe while these keys keep their promise, so the
    // promise is asserted rather than assumed.
    const banner = en['payment.demoBanner'] ?? '';
    expect(banner).toMatch(/no money is transferred/i);
    expect(banner).toMatch(/not connected to any government or bank payment system/i);
    expect(en['admin.payments.demo'] ?? '').toMatch(/no money was transferred/i);
  });

  it('exempts no key that has since been deleted', () => {
    // A stale exemption is a hole in the rule that nothing would report, so
    // the allowlist is required to describe keys that actually exist.
    const stale = [...DEMO_HONESTY_KEYS].filter((key) => !(key in en));
    expect(stale, `exempt keys no longer in en.json: ${stale.join(', ')}`).toEqual([]);
  });
});
