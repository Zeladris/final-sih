import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { INTEGRATION_ENABLED } from '../setup.js';
import { FIXTURE, signInWithOtp } from '../helpers/session.js';
import { resetFarmerRegistration } from '../helpers/resetFarmer.js';
import type { TestSession } from '../helpers/session.js';

/**
 * Authorization and scope isolation through the API (§28, §29, §43).
 *
 * Every assertion here is the negative case: the point is not that the right
 * user can read their own data, it is that the wrong one cannot read anybody
 * else's.
 *
 * Requires: migrations applied and `npm run seed:fixtures`.
 */
const suite = INTEGRATION_ENABLED ? describe : describe.skip;

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

suite('authorization and scope isolation', () => {
  let app: Express;
  let farmerA: TestSession;
  let farmerB: TestSession;
  let staffA: TestSession;
  let staffB: TestSession;
  let districtAdminA: TestSession;
  let districtAdminB: TestSession;
  let stateAdmin: TestSession;

  const as = (session: TestSession) => ({
    get: (path: string) =>
      request(app).get(path).set('Authorization', `Bearer ${session.accessToken}`),
    post: (path: string) =>
      request(app).post(path).set('Authorization', `Bearer ${session.accessToken}`),
    put: (path: string) =>
      request(app).put(path).set('Authorization', `Bearer ${session.accessToken}`),
    del: (path: string) =>
      request(app).delete(path).set('Authorization', `Bearer ${session.accessToken}`),
  });

  beforeAll(async () => {
    const { createApp } = await import('../../src/app.js');
    app = createApp();

    [farmerA, farmerB, staffA, staffB, districtAdminA, districtAdminB, stateAdmin] =
      await Promise.all([
        signInWithOtp(FIXTURE.farmerA),
        signInWithOtp(FIXTURE.farmerB),
        signInWithOtp(FIXTURE.staffCentreA),
        signInWithOtp(FIXTURE.staffCentreB),
        signInWithOtp(FIXTURE.districtAdminThanjavur),
        signInWithOtp(FIXTURE.districtAdminTrichy),
        signInWithOtp(FIXTURE.stateAdmin),
      ]);

    // Own the starting state so this suite does not depend on file order.
    await resetFarmerRegistration(farmerA.userId, FIXTURE.farmerA);
    await resetFarmerRegistration(farmerB.userId, FIXTURE.farmerB);
  });

  // --- Authentication ------------------------------------------------------

  describe('authentication', () => {
    it('rejects an unauthenticated request to a protected endpoint', async () => {
      const response = await request(app).get('/api/farmer/registration');
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged token', async () => {
      const response = await request(app)
        .get('/api/farmer/registration')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.forged.signature');
      expect(response.status).toBe(401);
    });

    it('derives role and scope from the server, not the request', async () => {
      const response = await as(staffA).get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('CENTRE_STAFF');
      expect(response.body.scope.centreId).toBeTruthy();
      expect(response.body.scope.districtId).toBeTruthy();
      expect(response.body.user.preferredLanguage).toBeTruthy();
    });
  });

  // --- Farmer --------------------------------------------------------------

  describe('farmer', () => {
    it('can read its own registration', async () => {
      const response = await as(farmerA).get('/api/farmer/registration');
      expect(response.status).toBe(200);
      expect(response.body.farmer.userId).toBe(farmerA.userId);
    });

    /**
     * There is no `/api/farmer/:someOtherId` endpoint at all — every farmer
     * route is scoped to `me`, so another farmer cannot even be named. The one
     * place an id appears in a URL is a document, tested below.
     */
    it('cannot reach another farmer\'s document', async () => {
      const uploaded = await request(app)
        .post('/api/farmer/documents')
        .set('Authorization', `Bearer ${farmerA.accessToken}`)
        .field('documentKind', 'CROP_PHOTO')
        .attach('file', PNG, { filename: 'crop.png', contentType: 'image/png' });
      expect(uploaded.status).toBe(201);

      const documents = (await as(farmerA).get('/api/farmer/documents')).body as {
        documents: Array<{ id: string; documentKind: string }>;
      };
      const documentId = documents.documents.find((d) => d.documentKind === 'CROP_PHOTO')?.id;
      expect(documentId).toBeTruthy();

      // Farmer A can open it.
      expect((await as(farmerA).get(`/api/farmer/documents/${documentId}/url`)).status).toBe(200);

      // Farmer B is told only that it does not exist — which discloses nothing.
      expect((await as(farmerB).get(`/api/farmer/documents/${documentId}/url`)).status).toBe(404);
      expect((await as(farmerB).del(`/api/farmer/documents/${documentId}`)).status).toBe(404);

      // And it is still there afterwards.
      expect((await as(farmerA).get(`/api/farmer/documents/${documentId}/url`)).status).toBe(200);
    });

    it('cannot reach staff endpoints', async () => {
      const response = await as(farmerA).get('/api/staff/me');
      expect(response.status).toBe(403);
    });

    it('cannot reach district or state admin endpoints', async () => {
      expect((await as(farmerA).get('/api/admin/district/me')).status).toBe(403);
      expect((await as(farmerA).get('/api/admin/state/me')).status).toBe(403);
    });

    it('cannot promote itself by sending a role in the request body', async () => {
      // The schema is strict, so an unknown key is rejected outright; even if
      // it were not, profiles.role is pinned by a database trigger.
      const response = await as(farmerA)
        .put('/api/farmer/profile')
        .send({ fullName: 'Arumugam Selvaraj', role: 'STATE_ADMIN' });

      expect(response.status).toBe(422);

      const after = await as(farmerA).get('/api/auth/me');
      expect(after.body.user.role).toBe('FARMER');
    });

    it('cannot set its own registration status', async () => {
      const response = await as(farmerA)
        .put('/api/farmer/profile')
        .send({ fullName: 'Arumugam Selvaraj', registrationStatus: 'VERIFIED' });

      expect(response.status).toBe(422);

      const status = await as(farmerA).get('/api/farmer/verification-status');
      expect(status.body.status).not.toBe('VERIFIED');
    });
  });

  // --- Centre staff --------------------------------------------------------

  describe('centre staff', () => {
    it('sees exactly one assigned centre', async () => {
      const response = await as(staffA).get('/api/staff/me/centre');

      expect(response.status).toBe(200);
      expect(response.body.centre.code).toBe('TNJ-PPC-01');
      expect(response.body.district.code).toBe('TNJ');
      expect(response.body.state.code).toBe('TN');
    });

    it('is refused another centre through the API', async () => {
      const own = await as(staffA).get('/api/staff/me/centre');
      const other = await as(staffB).get('/api/staff/me/centre');

      expect(other.body.centre.id).not.toBe(own.body.centre.id);

      const response = await as(staffA).get(`/api/staff/centres/${other.body.centre.id}`);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('can reach its own centre by id', async () => {
      const own = await as(staffA).get('/api/staff/me/centre');
      const response = await as(staffA).get(`/api/staff/centres/${own.body.centre.id}`);
      expect(response.status).toBe(200);
    });

    it('cannot reach district admin endpoints', async () => {
      expect((await as(staffA).get('/api/admin/district/centres')).status).toBe(403);
    });

    it('cannot reach farmer endpoints', async () => {
      expect((await as(staffA).get('/api/farmer/verification-status')).status).toBe(403);
    });
  });

  // --- District admin ------------------------------------------------------

  describe('district admin', () => {
    it('sees every centre in its own district and none from another', async () => {
      const response = await as(districtAdminA).get('/api/admin/district/centres');

      expect(response.status).toBe(200);
      const codes = (response.body.centres as Array<{ code: string }>).map((c) => c.code).sort();
      expect(codes).toEqual(['TNJ-PPC-01', 'TNJ-PPC-02', 'TNJ-PPC-03']);
    });

    it('is refused a neighbouring district through the API', async () => {
      const otherDistrict = await as(districtAdminB).get('/api/admin/district/me');
      const otherDistrictId = otherDistrict.body.district.id;

      const response = await as(districtAdminA).get(
        `/api/admin/districts/${otherDistrictId}/centres`,
      );
      expect(response.status).toBe(403);
    });

    it('cannot reach state admin endpoints', async () => {
      expect((await as(districtAdminA).get('/api/admin/state/districts')).status).toBe(403);
    });
  });

  // --- State admin ---------------------------------------------------------

  describe('state admin', () => {
    it('sees every district in its state', async () => {
      const response = await as(stateAdmin).get('/api/admin/state/districts');

      expect(response.status).toBe(200);
      const codes = (response.body.districts as Array<{ code: string }>).map((d) => d.code).sort();
      expect(codes).toEqual(['TNJ', 'TRY']);
    });

    it('sees every centre across those districts', async () => {
      const response = await as(stateAdmin).get('/api/admin/state/centres');

      expect(response.status).toBe(200);
      expect((response.body.centres as unknown[]).length).toBe(5);
    });

    it('can reach a specific district within its state', async () => {
      const districts = await as(stateAdmin).get('/api/admin/state/districts');
      const districtId = (districts.body.districts as Array<{ id: string }>)[0]?.id;

      const response = await as(stateAdmin).get(`/api/admin/districts/${districtId}/centres`);
      expect(response.status).toBe(200);
    });

    it('cannot reach district-admin-only endpoints', async () => {
      expect((await as(stateAdmin).get('/api/admin/district/centres')).status).toBe(403);
    });
  });

  // --- Health --------------------------------------------------------------

  describe('health', () => {
    it('reports api and database status without exposing configuration', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        api: 'ok',
        database: 'ok',
        environment: 'test',
      });
      expect(JSON.stringify(response.body)).not.toContain('supabase.co');
    });
  });
});
