import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §2 and §44: the shipped application must contain no demo or prototype
 * behaviour.
 *
 * This scans the product source — `apps/api/src` and `apps/web/src` — for the
 * things Phase 1 says must be gone. Test tooling under `tests/` is deliberately
 * out of scope: fixtures are allowed to exist there and nowhere else.
 *
 * A comment explaining that demo mode was removed is fine; an actual demo
 * number or a `DEMO_MODE` read is not. The patterns below target the latter.
 */

const ROOTS = [
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), '../web/src'),
];

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|json)$/.test(entry) ? [full] : [];
  });
}

const FILES = ROOTS.flatMap(sourceFiles);

/** Strips line and block comments so prose about the removal does not trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: 'demo phone number', pattern: /\+?91900000\d{4}/ },
  { name: 'prototype admin/staff number', pattern: /9{10}|8{10}/ },
  { name: 'fixture accounts import', pattern: /tests\/fixtures/ },
  { name: 'hard-coded OTP', pattern: /['"`]123456['"`]/ },
  { name: 'DEMO_MODE flag', pattern: /DEMO_MODE/ },
  { name: 'demoMode reference', pattern: /\bdemoMode\b/ },
  { name: 'demo accounts import', pattern: /demoAccounts/ },
  { name: 'test_otp reference', pattern: /sms_test_otp|test_otp/ },
];

describe('no prototype behaviour in product source', () => {
  it('scans a non-trivial number of files', () => {
    // Guards against the glob silently matching nothing and the suite passing.
    expect(FILES.length).toBeGreaterThan(40);
  });

  for (const { name, pattern } of FORBIDDEN) {
    it(`contains no ${name}`, () => {
      const offenders = FILES.filter((file) =>
        pattern.test(stripComments(readFileSync(file, 'utf8'))),
      ).map((file) => file.replace(process.cwd(), '.'));

      expect(offenders, `${name} found in: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('seeds no accounts through migrations', () => {
    // Accounts come from real sign-up (farmers) or `npm run provision`
    // (government roles) — never from schema files.
    const migrations = resolve(process.cwd(), '../../supabase/migrations');
    const offenders = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .filter((file) =>
        /insert\s+into\s+(auth\.users|public\.profiles|public\.(staff|district_admin|state_admin)_profiles)\b/i.test(
          readFileSync(join(migrations, file), 'utf8'),
        ),
      );

    expect(offenders, `account seeding found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('never claims Aadhaar or government verification happened', () => {
    // §2 and §39. The Aadhaar provider may be *named* (it is a declared
    // placeholder), and a comment may quote the forbidden phrase to explain
    // the rule — so comments are stripped first. What must not exist is a
    // literal the UI could actually render.
    const claims = /aadhaar\s*verified|uidai\s*verified|government\s*verified/i;

    const offenders = FILES.filter((file) =>
      claims.test(stripComments(readFileSync(file, 'utf8'))),
    ).map((file) => file.replace(process.cwd(), '.'));

    expect(offenders, `verification claim found in: ${offenders.join(', ')}`).toEqual([]);
  });
});
