import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { RegistrationView, VerificationStatusView } from '@kisansetu/shared';
import { INTEGRATION_ENABLED } from '../setup.js';
import { FIXTURE, signInWithOtp } from '../helpers/session.js';
import { resetFarmerRegistration } from '../helpers/resetFarmer.js';
import type { TestSession } from '../helpers/session.js';

/**
 * The farmer journey end to end (§43, §46 Step 13).
 *
 * Runs against a real Supabase: real OTP, real RLS, real storage. Uses the
 * seeded farmer whose registration is already in DRAFT, walks it to
 * UNDER_REVIEW, and checks what a farmer can and cannot do at each point.
 *
 * Requires: migrations applied and `npm run seed:fixtures`.
 */
const suite = INTEGRATION_ENABLED ? describe : describe.skip;

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

suite('farmer registration flow', () => {
  let app: Express;
  let farmer: TestSession;

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
    farmer = await signInWithOtp(FIXTURE.farmerC);

    // Own the starting state rather than inheriting whatever a previous suite
    // left behind. Suites share fixture accounts, so this is what makes them
    // order-independent.
    await resetFarmerRegistration(farmer.userId, FIXTURE.farmerC);
  });

  describe('existing farmer detection', () => {
    it('returns the existing registration rather than creating a second one', async () => {
      const response = await as(farmer).get('/api/farmer/registration');

      expect(response.status).toBe(200);
      expect(response.body.farmer.userId).toBe(farmer.userId);
      expect(response.body.farmer.farmerReferenceId).toMatch(/^KS-\d+$/);
    });

    it('refuses to start a second registration for the same identity', async () => {
      const response = await as(farmer)
        .post('/api/farmer/registration')
        .send({ fullName: 'Duplicate Person', preferredLanguage: 'en' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('saving sections', () => {
    it('saves personal details and reports progress', async () => {
      const response = await as(farmer).put('/api/farmer/profile').send({
        fullName: 'Arumugam Selvaraj',
        dateOfBirth: '1980-06-15',
        gender: 'MALE',
        preferredLanguage: 'ta',
      });

      expect(response.status).toBe(200);
      const view = response.body as RegistrationView;
      expect(view.profile.fullName).toBe('Arumugam Selvaraj');
      expect(view.completedSteps).toContain('PERSONAL_DETAILS');
    });

    it('rejects a future date of birth', async () => {
      const response = await as(farmer)
        .put('/api/farmer/profile')
        .send({ fullName: 'Arumugam Selvaraj', dateOfBirth: '2099-01-01' });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const response = await as(farmer).put('/api/farmer/profile').send({
        fullName: 'Arumugam Selvaraj',
        registrationStatus: 'VERIFIED',
      });

      expect(response.status).toBe(422);
    });

    it('persists progress across a fresh request, so resume works', async () => {
      const response = await as(farmer).get('/api/farmer/registration');
      const view = response.body as RegistrationView;

      expect(view.profile.fullName).toBe('Arumugam Selvaraj');
      expect(view.farmer.dateOfBirth).toBe('1980-06-15');
      expect(view.farmer.lastSavedAt).toBeTruthy();
    });
  });

  describe('land', () => {
    it('rejects a non-positive area', async () => {
      const response = await as(farmer)
        .post('/api/farmer/land')
        .send({ ownershipType: 'OWNED', area: 0, areaUnit: 'ACRE' });

      expect(response.status).toBe(422);
    });

    it('adds a holding and counts it towards progress', async () => {
      const response = await as(farmer).post('/api/farmer/land').send({
        ownershipType: 'LEASED',
        area: 2.5,
        areaUnit: 'ACRE',
        primaryCrop: 'Paddy (Kuruvai)',
        surveyNumber: '77/2B',
      });

      expect(response.status).toBe(201);
      const view = response.body as RegistrationView;
      expect(view.completedSteps).toContain('LAND_DETAILS');
      expect(view.landHoldings.length).toBeGreaterThan(0);
    });

    it('never lets a farmer declare their own land verified', async () => {
      const list = (await as(farmer).get('/api/farmer/land')).body as {
        landHoldings: Array<{ id: string; verificationStatus: string }>;
      };
      const holding = list.landHoldings[0];
      expect(holding).toBeDefined();

      // The field is not in the schema, so it is rejected outright — and the
      // database pins it even if the schema were widened (§14).
      const response = await as(farmer)
        .put(`/api/farmer/land/${holding!.id}`)
        .send({ verificationStatus: 'VERIFIED' });

      expect(response.status).toBe(422);

      const after = (await as(farmer).get('/api/farmer/land')).body as {
        landHoldings: Array<{ verificationStatus: string }>;
      };
      expect(after.landHoldings[0]?.verificationStatus).not.toBe('VERIFIED');
    });
  });

  describe('documents', () => {
    async function upload(kind: string, filename = 'file.png'): Promise<request.Response> {
      return request(app)
        .post('/api/farmer/documents')
        .set('Authorization', `Bearer ${farmer.accessToken}`)
        .field('documentKind', kind)
        .attach('file', PNG, { filename, contentType: 'image/png' });
    }

    it('uploads a required document without exposing its storage path', async () => {
      const response = await upload('LAND_RECORD', 'patta.png');

      expect(response.status).toBe(201);
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('storage_path');
      expect(body).not.toContain('storagePath');
      expect(body).not.toContain(`${farmer.userId}/`);
    });

    it('replaces an existing document of the same kind rather than duplicating it', async () => {
      const before = (await as(farmer).get('/api/farmer/documents')).body as {
        documents: Array<{ documentKind: string; id: string }>;
      };
      const originalCount = before.documents.filter(
        (d) => d.documentKind === 'LAND_RECORD',
      ).length;
      expect(originalCount).toBe(1);

      const response = await upload('LAND_RECORD', 'patta-v2.png');
      expect(response.status).toBe(201);

      const after = (await as(farmer).get('/api/farmer/documents')).body as {
        documents: Array<{ documentKind: string; replacesDocumentId: string | null }>;
      };
      const live = after.documents.filter((d) => d.documentKind === 'LAND_RECORD');

      // Exactly one live document of the kind, and it points at what it replaced.
      expect(live).toHaveLength(1);
      expect(live[0]?.replacesDocumentId).toBeTruthy();
    });

    it('rejects a file whose bytes contradict its declared type', async () => {
      const executable = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

      const response = await request(app)
        .post('/api/farmer/documents')
        .set('Authorization', `Bearer ${farmer.accessToken}`)
        .field('documentKind', 'IDENTITY_PROOF')
        .attach('file', executable, { filename: 'id.pdf', contentType: 'application/pdf' });

      expect(response.status).toBe(422);
    });

    it('mints a short-lived signed URL instead of a public one', async () => {
      const documents = (await as(farmer).get('/api/farmer/documents')).body as {
        documents: Array<{ id: string }>;
      };
      const documentId = documents.documents[0]?.id;
      expect(documentId).toBeTruthy();

      const response = await as(farmer).get(`/api/farmer/documents/${documentId}/url`);

      expect(response.status).toBe(200);
      expect(response.body.signedUrl).toContain('farmer-documents');
      expect(response.body.signedUrl).toMatch(/token=/);
      expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('submission', () => {
    it('refuses to submit while required documents are missing', async () => {
      const response = await as(farmer).post('/api/farmer/registration/submit');

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('submits once everything required is present, and locks the registration', async () => {
      // Fill in whatever the server still reports as outstanding.
      const before = (await as(farmer).get('/api/farmer/registration')).body as RegistrationView;

      for (const requirement of before.requirements.filter((r) => r.isRequired)) {
        const already = before.documents.some((d) => d.documentKind === requirement.documentKind);
        if (already) continue;

        await request(app)
          .post('/api/farmer/documents')
          .set('Authorization', `Bearer ${farmer.accessToken}`)
          .field('documentKind', requirement.documentKind)
          .attach('file', PNG, { filename: 'doc.png', contentType: 'image/png' });
      }

      await as(farmer).put('/api/farmer/address').send({
        village: 'Orathanadu',
        pincode: '614625',
        stateId: before.farmer.stateId,
        districtId: before.farmer.districtId,
      });

      const ready = (await as(farmer).get('/api/farmer/registration')).body as RegistrationView;
      expect(ready.canSubmit, `blocked by: ${ready.blockingReasons.join(', ')}`).toBe(true);

      const submitted = await as(farmer).post('/api/farmer/registration/submit');
      expect(submitted.status).toBe(200);

      const view = submitted.body as RegistrationView;
      expect(view.farmer.registrationStatus).toBe('UNDER_REVIEW');
      expect(view.farmer.submittedAt).toBeTruthy();
      expect(view.editable).toBe(false);
    });

    it('opens the component verification checks', async () => {
      const response = await as(farmer).get('/api/farmer/verification-status');
      const status = response.body as VerificationStatusView;

      expect(status.status).toBe('UNDER_REVIEW');
      expect(status.checks.length).toBeGreaterThan(0);
      for (const check of status.checks) {
        expect(check.status).toBe('UNDER_REVIEW');
      }
    });

    it('locks editing once submitted', async () => {
      // §19: no unauthorised edits while under review. The API refuses, and
      // the RLS policy refuses independently.
      const profile = await as(farmer)
        .put('/api/farmer/profile')
        .send({ fullName: 'Changed After Submission' });
      expect(profile.status).toBe(409);

      const land = await as(farmer)
        .post('/api/farmer/land')
        .send({ ownershipType: 'OWNED', area: 1, areaUnit: 'ACRE' });
      expect(land.status).toBe(409);

      const upload = await request(app)
        .post('/api/farmer/documents')
        .set('Authorization', `Bearer ${farmer.accessToken}`)
        .field('documentKind', 'CROP_PHOTO')
        .attach('file', PNG, { filename: 'crop.png', contentType: 'image/png' });
      expect(upload.status).toBe(409);
    });

    it('refuses a second submission', async () => {
      const response = await as(farmer).post('/api/farmer/registration/submit');
      expect(response.status).toBe(409);
    });

    it('still allows a language change while locked', async () => {
      // Language is a display preference, not registration content (§4).
      const response = await as(farmer).put('/api/farmer/language').send({
        preferredLanguage: 'en',
      });
      expect(response.status).toBe(204);
    });
  });

  describe('status view', () => {
    it('never leaks a raw state name into a user-facing message', async () => {
      const response = await as(farmer).get('/api/farmer/verification-status');

      // The status field itself is a code the UI maps to localised copy; what
      // must not appear is a prose message containing it (§42).
      expect(response.body.reviewNotes ?? '').not.toMatch(/UNDER_REVIEW|RESUBMISSION_REQUIRED/);
    });
  });
});
