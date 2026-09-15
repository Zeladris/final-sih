import { beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { INTEGRATION_ENABLED } from '../setup.js';
import { FIXTURE, signInWithOtp, userScopedClient } from '../helpers/session.js';
import { resetFarmerRegistration } from '../helpers/resetFarmer.js';

/**
 * Row Level Security, verified INDEPENDENTLY of Express (§28, §43).
 *
 * Every query below goes straight to PostgREST with a real user token. The API
 * middleware is not in the picture at all, so a pass here means the database
 * itself refuses — which is the whole point of having two layers.
 *
 * Requires: migrations applied and `npm run seed:fixtures`.
 */
const suite = INTEGRATION_ENABLED ? describe : describe.skip;

suite('PostgreSQL Row Level Security', () => {
  let farmerA: SupabaseClient;
  let farmerB: SupabaseClient;
  let farmerAId: string;
  let farmerBId: string;
  let staffA: SupabaseClient;
  let staffB: SupabaseClient;
  let districtAdminA: SupabaseClient;
  let stateAdmin: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    // This suite drives a farmer all the way to VERIFIED, which is terminal, so
    // it uses two farmers of its own rather than the ones other suites rely on.
    const [a, b, sa, sb, da, st] = await Promise.all([
      signInWithOtp(FIXTURE.farmerD),
      signInWithOtp(FIXTURE.farmerE),
      signInWithOtp(FIXTURE.staffCentreA),
      signInWithOtp(FIXTURE.staffCentreB),
      signInWithOtp(FIXTURE.districtAdminThanjavur),
      signInWithOtp(FIXTURE.stateAdmin),
    ]);

    farmerAId = a.userId;
    farmerBId = b.userId;
    farmerA = userScopedClient(a.accessToken);
    farmerB = userScopedClient(b.accessToken);
    staffA = userScopedClient(sa.accessToken);
    staffB = userScopedClient(sb.accessToken);
    districtAdminA = userScopedClient(da.accessToken);
    stateAdmin = userScopedClient(st.accessToken);

    admin = (await import('../../src/lib/supabaseAdmin.js')).supabaseAdminClient;

    // Start from a known DRAFT, so the "locked" policies below are exercised
    // deliberately rather than because a previous run left something behind.
    await resetFarmerRegistration(farmerAId, FIXTURE.farmerD);
    await resetFarmerRegistration(farmerBId, FIXTURE.farmerE);
  });

  describe('farmer isolation', () => {
    it('returns the farmer their own profile row', async () => {
      const { data, error } = await farmerA
        .from('farmer_profiles')
        .select('user_id, farmer_reference_id')
        .eq('user_id', farmerAId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('returns zero rows when a farmer queries another farmer directly', async () => {
      // Not an error — RLS filters, so the row is simply not there. That is the
      // correct behaviour: it discloses nothing about what exists.
      const { data, error } = await farmerA
        .from('farmer_profiles')
        .select('user_id')
        .eq('user_id', farmerBId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('returns only one row when a farmer selects the whole table', async () => {
      const { data, error } = await farmerA.from('farmer_profiles').select('user_id');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.user_id).toBe(farmerAId);
    });

    it('refuses a farmer writing another farmer\'s profile', async () => {
      const { data, error } = await farmerA
        .from('farmer_profiles')
        .update({ village: 'tampered' })
        .eq('user_id', farmerBId)
        .select('user_id');

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: untouched } = await farmerB
        .from('farmer_profiles')
        .select('village')
        .eq('user_id', farmerBId)
        .single();
      expect(untouched?.village).not.toBe('tampered');
    });

    it('refuses a farmer promoting their own role', async () => {
      await farmerA.from('profiles').update({ role: 'STATE_ADMIN' }).eq('id', farmerAId);

      const { data } = await farmerA.from('profiles').select('role').eq('id', farmerAId).single();
      expect(data?.role).toBe('FARMER');
    });

    it('refuses anyone creating a privileged profile for themselves', async () => {
      // The INSERT policy only admits role = 'FARMER'.
      const { error } = await farmerA
        .from('profiles')
        .insert({ id: farmerAId, role: 'STATE_ADMIN', full_name: 'escalated' });

      expect(error).not.toBeNull();
    });
  });

  describe('registration state machine', () => {
    it('silently discards a farmer-declared registration status', async () => {
      await farmerA
        .from('farmer_profiles')
        .update({ registration_status: 'VERIFIED' })
        .eq('user_id', farmerAId);

      const { data } = await farmerA
        .from('farmer_profiles')
        .select('registration_status, verified_at')
        .eq('user_id', farmerAId)
        .single();

      expect(data?.registration_status).toBe('DRAFT');
      expect(data?.verified_at).toBeNull();
    });

    it('discards a farmer-supplied submitted_at and review note', async () => {
      await farmerA
        .from('farmer_profiles')
        .update({ submitted_at: '2020-01-01T00:00:00Z', review_notes: 'self approved' })
        .eq('user_id', farmerAId);

      const { data } = await farmerA
        .from('farmer_profiles')
        .select('submitted_at, review_notes')
        .eq('user_id', farmerAId)
        .single();

      expect(data?.review_notes).not.toBe('self approved');
      expect(data?.submitted_at).not.toBe('2020-01-01T00:00:00+00:00');
    });

    it('refuses an illegal transition even for the service role', async () => {
      // The TypeScript table and the SQL table must agree. DRAFT -> VERIFIED
      // has no edge in either, so the database rejects it outright.
      await admin
        .from('farmer_profiles')
        .update({ registration_status: 'DRAFT' })
        .eq('user_id', farmerAId);

      const { error } = await admin
        .from('farmer_profiles')
        .update({ registration_status: 'VERIFIED' })
        .eq('user_id', farmerAId);

      expect(error).not.toBeNull();
    });

    it('allows the legal path and stamps the timestamps itself', async () => {
      await admin
        .from('farmer_profiles')
        .update({ registration_status: 'DRAFT' })
        .eq('user_id', farmerAId);

      const submitted = await admin
        .from('farmer_profiles')
        .update({ registration_status: 'SUBMITTED' })
        .eq('user_id', farmerAId)
        .select('registration_status, submitted_at')
        .single();

      expect(submitted.error).toBeNull();
      expect(submitted.data?.submitted_at).toBeTruthy();

      const reviewing = await admin
        .from('farmer_profiles')
        .update({ registration_status: 'UNDER_REVIEW' })
        .eq('user_id', farmerAId)
        .select('registration_status')
        .single();
      expect(reviewing.data?.registration_status).toBe('UNDER_REVIEW');

      const verified = await admin
        .from('farmer_profiles')
        .update({ registration_status: 'VERIFIED' })
        .eq('user_id', farmerAId)
        .select('registration_status, verified_at, reviewed_at')
        .single();

      expect(verified.data?.registration_status).toBe('VERIFIED');
      expect(verified.data?.verified_at).toBeTruthy();
      expect(verified.data?.reviewed_at).toBeTruthy();

      // VERIFIED is terminal.
      const reopened = await admin
        .from('farmer_profiles')
        .update({ registration_status: 'DRAFT' })
        .eq('user_id', farmerAId);
      expect(reopened.error).not.toBeNull();
    });

    it('locks farmer edits once the registration is not editable', async () => {
      // farmerA is VERIFIED from the previous test — the UPDATE policy should
      // now match no rows at all.
      const { data } = await farmerA
        .from('farmer_profiles')
        .update({ village: 'changed while locked' })
        .eq('user_id', farmerAId)
        .select('user_id');

      expect(data).toEqual([]);
    });

    it('locks land and document writes once the registration is not editable', async () => {
      const land = await farmerA.from('farmer_land_holdings').insert({
        farmer_user_id: farmerAId,
        ownership_type: 'OWNED',
        area: 1,
        area_unit: 'ACRE',
      });
      expect(land.error).not.toBeNull();

      const document = await farmerA.from('farmer_documents').insert({
        farmer_user_id: farmerAId,
        document_type: 'OTHER',
        storage_path: `${farmerAId}/forged/x.png`,
      });
      expect(document.error).not.toBeNull();
    });
  });

  describe('land holdings', () => {
    it('hides another farmer\'s land', async () => {
      const { data, error } = await farmerB
        .from('farmer_land_holdings')
        .select('id, farmer_user_id');

      expect(error).toBeNull();
      for (const row of data ?? []) {
        expect(row.farmer_user_id).toBe(farmerBId);
      }
    });

    it('discards a farmer-declared land verification status', async () => {
      // §14: declaring land is not verifying it.
      const { data: holdings } = await farmerB
        .from('farmer_land_holdings')
        .select('id')
        .limit(1);
      const holdingId = holdings?.[0]?.id as string | undefined;
      expect(holdingId).toBeTruthy();

      await farmerB
        .from('farmer_land_holdings')
        .update({ verification_status: 'VERIFIED' })
        .eq('id', holdingId as string);

      const { data } = await farmerB
        .from('farmer_land_holdings')
        .select('verification_status')
        .eq('id', holdingId as string)
        .single();

      expect(data?.verification_status).not.toBe('VERIFIED');
    });

    it('hides farmer land from staff and admins', async () => {
      expect((await staffA.from('farmer_land_holdings').select('id')).data).toEqual([]);
      expect((await districtAdminA.from('farmer_land_holdings').select('id')).data).toEqual([]);
      expect((await stateAdmin.from('farmer_land_holdings').select('id')).data).toEqual([]);
    });
  });

  describe('verification checks', () => {
    it('lets a farmer read their own checks', async () => {
      const { error } = await farmerA
        .from('farmer_verification_checks')
        .select('check_type, status');
      expect(error).toBeNull();
    });

    it('refuses a farmer writing their own check outcome', async () => {
      // The table has a SELECT policy and nothing else (§18).
      const { error } = await farmerA.from('farmer_verification_checks').insert({
        farmer_user_id: farmerAId,
        check_type: 'IDENTITY',
        status: 'VERIFIED',
      });

      expect(error).not.toBeNull();
    });

    it('hides another farmer\'s checks', async () => {
      const { data } = await farmerB.from('farmer_verification_checks').select('farmer_user_id');
      for (const row of data ?? []) {
        expect(row.farmer_user_id).toBe(farmerBId);
      }
    });
  });

  describe('centre isolation', () => {
    it('shows staff only their own centre', async () => {
      const { data, error } = await staffA.from('procurement_centres').select('code');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.code).toBe('TNJ-PPC-01');
    });

    it('returns nothing when staff query a colleague\'s centre by id', async () => {
      const { data: other } = await staffB.from('procurement_centres').select('id').single();

      const { data } = await staffA
        .from('procurement_centres')
        .select('id')
        .eq('id', other?.id as string);

      expect(data).toEqual([]);
    });
  });

  describe('district and state scope', () => {
    it('shows a district admin only centres in their district', async () => {
      const { data, error } = await districtAdminA.from('procurement_centres').select('code');

      expect(error).toBeNull();
      expect(data?.map((row) => row.code).sort()).toEqual([
        'TNJ-PPC-01',
        'TNJ-PPC-02',
        'TNJ-PPC-03',
      ]);
    });

    it('shows a district admin only their own district row', async () => {
      const { data } = await districtAdminA.from('districts').select('code');
      expect(data?.map((row) => row.code)).toEqual(['TNJ']);
    });

    it('shows a state admin every district and centre in their state', async () => {
      const { data: districts } = await stateAdmin.from('districts').select('code');
      expect(districts?.map((row) => row.code).sort()).toEqual(['TNJ', 'TRY']);

      const { data: centres } = await stateAdmin.from('procurement_centres').select('code');
      expect(centres).toHaveLength(5);
    });
  });

  describe('documents and audit logs', () => {
    it('hides another farmer\'s documents entirely', async () => {
      const { data, error } = await farmerB.from('farmer_documents').select('id, farmer_user_id');

      expect(error).toBeNull();
      for (const row of data ?? []) {
        expect(row.farmer_user_id).toBe(farmerBId);
      }
    });

    it('hides farmer documents from staff', async () => {
      // Phase 1 grants staff no access to farmer documents. When a later phase
      // needs it, it gets an explicit policy — not a blanket one.
      const { data } = await staffA.from('farmer_documents').select('id');
      expect(data).toEqual([]);
    });

    it('hides farmer profiles from staff and admins', async () => {
      expect((await staffA.from('farmer_profiles').select('user_id')).data).toEqual([]);
      expect((await districtAdminA.from('farmer_profiles').select('user_id')).data).toEqual([]);
      expect((await stateAdmin.from('farmer_profiles').select('user_id')).data).toEqual([]);
    });

    it('denies every client read of the audit log', async () => {
      for (const client of [farmerA, staffA, districtAdminA, stateAdmin]) {
        const { data, error } = await client.from('audit_logs').select('id');
        // Either a hard permission error or an empty result — never content.
        expect(error !== null || (data ?? []).length === 0).toBe(true);
      }
    });

    it('denies a client writing an audit entry', async () => {
      const { error } = await farmerA
        .from('audit_logs')
        .insert({ action: 'FABRICATED', actor_user_id: farmerAId });

      expect(error).not.toBeNull();
    });
  });

  describe('configuration tables', () => {
    it('lets any signed-in user read the document requirements', async () => {
      const { data, error } = await farmerA
        .from('document_requirements')
        .select('document_kind, is_required');

      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it('refuses a client changing the document policy', async () => {
      const { error } = await farmerA
        .from('document_requirements')
        .update({ is_required: false })
        .eq('document_kind', 'LAND_RECORD');

      // No UPDATE policy exists, so either an error or zero rows affected.
      const { data: unchanged } = await farmerA
        .from('document_requirements')
        .select('is_required')
        .eq('document_kind', 'LAND_RECORD')
        .maybeSingle();

      expect(error !== null || unchanged?.is_required === true).toBe(true);
    });
  });

  describe('internal authorization helpers', () => {
    it('does not expose the app schema through PostgREST', async () => {
      // app.user_role() and friends must be unreachable from a browser client;
      // only the `public` schema is exposed.
      const { error } = await farmerA.rpc('user_role');
      expect(error).not.toBeNull();
    });

    it('does not expose the editability helper either', async () => {
      const { error } = await farmerA.rpc('registration_is_editable', { p_user_id: farmerAId });
      expect(error).not.toBeNull();
    });
  });
});
