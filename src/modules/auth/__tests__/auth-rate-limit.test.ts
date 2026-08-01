import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from '../auth.routes.js';
import { AuthController } from '../auth.controller.js';
import { AuthService } from '../auth.service.js';
import { Result } from '../../../shared/result.js';

// The global IP bucket is set deliberately high here so that anything we observe
// is the per-email limit doing the work, not the global one.
async function buildApp(service: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 10_000, timeWindow: '1 minute' });
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    authController: new AuthController(service as AuthService),
  });
  await app.ready();
  return app;
}

describe('Auth Routes — per-email rate limiting', () => {
  let app: FastifyInstance;
  let service: any;

  beforeEach(async () => {
    service = {
      resendOtp: vi.fn().mockResolvedValue(Result.ok({ message: 'Verification code resent.' })),
      verifyOtp: vi.fn().mockResolvedValue(Result.err({ code: 'INVALID_OTP', message: 'nope' })),
    };
    app = await buildApp(service);
  });

  afterEach(async () => {
    await app.close();
  });

  function resend(email: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/resend',
      payload: { email, purpose: 'EMAIL_VERIFICATION' },
    });
  }

  it('should cap OTP requests per email and respond 429, not 500', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await resend('victim@example.com')).statusCode);
    }

    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    // Regression guard: the plugin throws the errorResponseBuilder result, so
    // dropping statusCode from it silently turns this into a 500.
    expect(codes[5]).toBe(429);
  });

  it('should return the service-standard error shape when limited', async () => {
    for (let i = 0; i < 5; i++) await resend('victim@example.com');
    const limited = await resend('victim@example.com');

    expect(JSON.parse(limited.body)).toEqual({
      error: 'RATE_LIMITED',
      message: expect.any(String),
    });
  });

  it('should bucket by email rather than by IP', async () => {
    for (let i = 0; i < 6; i++) await resend('victim@example.com');

    // Same client, different account — must not inherit the victim's exhausted bucket
    const other = await resend('someone-else@example.com');

    expect(other.statusCode).toBe(200);
  });

  it('should cap OTP guesses per email across regenerated codes', async () => {
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-otp',
        payload: { email: 'victim@example.com', code: '000000', purpose: 'EMAIL_VERIFICATION' },
      });

    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await attempt()).statusCode);

    expect(codes.filter((c) => c === 429)).toHaveLength(1);
    expect(codes[10]).toBe(429);
  });

  it('should fall back to an IP-based key when the body carries no usable email', async () => {
    // preValidation runs before schema validation, so the key generator sees raw input
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/resend',
      payload: { email: 12345, purpose: 'EMAIL_VERIFICATION' },
    });

    // Rejected by schema validation, not by a crash inside the key generator
    expect(response.statusCode).toBe(400);
  });
});
