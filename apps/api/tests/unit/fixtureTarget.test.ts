import { afterEach, describe, expect, it } from 'vitest';
import { fixtureTarget } from '../fixtures/target.js';

/**
 * Test fixtures (fixed-OTP accounts) must never reach a real deployment. The
 * seeder and the integration suites both ask fixtureTarget() first.
 */
describe('fixture target guard', () => {
  const original = process.env.ALLOW_REMOTE_FIXTURES;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_REMOTE_FIXTURES;
    else process.env.ALLOW_REMOTE_FIXTURES = original;
  });

  it('allows local Supabase', () => {
    expect(fixtureTarget('http://127.0.0.1:54321').allowed).toBe(true);
    expect(fixtureTarget('http://localhost:54321').allowed).toBe(true);
  });

  it('refuses a hosted project by default', () => {
    delete process.env.ALLOW_REMOTE_FIXTURES;
    expect(fixtureTarget('https://abcd1234.supabase.co').allowed).toBe(false);
  });

  it('allows a remote project only when that exact host is named', () => {
    process.env.ALLOW_REMOTE_FIXTURES = 'abcd1234.supabase.co';
    expect(fixtureTarget('https://abcd1234.supabase.co').allowed).toBe(true);
    expect(fixtureTarget('https://other5678.supabase.co').allowed).toBe(false);
  });

  it('refuses a missing or malformed URL', () => {
    expect(fixtureTarget(undefined).allowed).toBe(false);
    expect(fixtureTarget('not a url').allowed).toBe(false);
  });
});
