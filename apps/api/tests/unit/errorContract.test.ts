import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { redact } from '../../src/lib/logger.js';

const app = createApp();

describe('API error contract (§34, §35)', () => {
  it('rejects an unauthenticated farmer request with the documented shape', async () => {
    const response = await request(app).get('/api/farmer/registration');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unauthenticated request with the documented shape', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  });

  it('rejects a malformed bearer token without leaking why', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token');

    expect([401, 403]).toContain(response.status);
    expect(response.body.error.code).toBeDefined();
    expect(JSON.stringify(response.body)).not.toContain('not-a-real-token');
  });

  it('returns NOT_FOUND in the same envelope for an unknown route', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('echoes a caller-supplied request id so a trace spans client and server', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('X-Request-ID', 'trace-abc-123');

    expect(response.headers['x-request-id']).toBe('trace-abc-123');
    expect(response.body.error.requestId).toBe('trace-abc-123');
  });

  it('generates its own request id when a caller sends a hostile one', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('X-Request-ID', 'bad id with spaces and <script>');

    expect(response.headers['x-request-id']).not.toContain('<script>');
  });

  it('never returns a stack trace', async () => {
    const response = await request(app).get('/api/does-not-exist');
    expect(JSON.stringify(response.body)).not.toMatch(/\.ts:\d+|at Object\./);
  });
});

describe('log redaction (§31, §47)', () => {
  it('strips secrets at any depth', () => {
    const redacted = redact({
      phone: '+919000000001',
      otp: '123456',
      nested: {
        access_token: 'eyJhbGciOi...',
        SUPABASE_SERVICE_ROLE_KEY: 'super-secret',
        aadhaarNumber: '1234 5678 9012',
        keep: 'visible',
      },
    }) as Record<string, unknown>;

    const serialised = JSON.stringify(redacted);
    expect(serialised).not.toContain('123456');
    expect(serialised).not.toContain('eyJhbGciOi');
    expect(serialised).not.toContain('super-secret');
    expect(serialised).not.toContain('1234 5678 9012');
    expect(serialised).toContain('visible');
    // Phone is not a secret; it is masked at the call site, not here.
    expect(serialised).toContain('+919000000001');
  });
});
