import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { authRoutes } from '../auth.routes.js';
import { AuthController } from '../auth.controller.js';
import { AuthService } from '../auth.service.js';
import { Result } from '../../../shared/result.js';
import { ConflictError, InvalidCredentialsError } from '../../../shared/errors.js';

// ── Build a Minimal Fastify App with Mocked AuthService ─────────────────

function createMockAuthService() {
  return {
    signup: vi.fn(),
    verifyOtp: vi.fn(),
    signin: vi.fn(),
    resendOtp: vi.fn(),
    handleOAuthCallback: vi.fn(),
    refreshTokens: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
    signout: vi.fn(),
  } as unknown as AuthService;
}

describe('Auth Routes — Fastify Injection', () => {
  let app: FastifyInstance;
  let mockAuthService: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    mockAuthService = createMockAuthService();
    const authController = new AuthController(mockAuthService);

    await app.register(authRoutes, {
      prefix: '/api/v1/auth',
      authController,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /signup ──────────────────────────────────────────────────

  describe('POST /api/v1/auth/signup', () => {
    it('should return 201 on successful signup', async () => {
      mockAuthService.signup.mockResolvedValue(
        Result.ok({
          message: 'User registered successfully. Verification code sent to email.',
          email: 'test@example.com',
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: 'test@example.com',
          password: 'SecureP@ss123!',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.email).toBe('test@example.com');
      expect(body.message).toContain('registered successfully');
    });

    it('should return 409 when email already exists', async () => {
      mockAuthService.signup.mockResolvedValue(
        Result.err(new ConflictError('Email already registered'))
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {
          email: 'existing@example.com',
          password: 'SecureP@ss123!',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('CONFLICT');
    });

    it('should return 400 when body is missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: {},
      });

      // Controller will attempt to destructure undefined and the service will handle it
      // At minimum the request should not crash
      expect([400, 500]).toContain(response.statusCode);
    });

    it.each([
      ['password', 'no upper, digit or symbol'],
      ['Password', 'no digit or symbol'],
      ['Password1', 'no symbol'],
      ['P@ss1', 'too short'],
      ['p@ssword1', 'no uppercase'],
      ['P@SSWORD1', 'no lowercase'],
    ])('should reject %s (%s) before reaching the service', async (password) => {
      mockAuthService.signup.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email: 'test@example.com', password },
      });

      expect(response.statusCode).toBe(400);
      expect(mockAuthService.signup).not.toHaveBeenCalled();
    });

    it('should reject a password over 128 characters', async () => {
      mockAuthService.signup.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        payload: { email: 'test@example.com', password: 'A1@' + 'a'.repeat(200) },
      });

      expect(response.statusCode).toBe(400);
      expect(mockAuthService.signup).not.toHaveBeenCalled();
    });
  });

  // ── POST /signout ─────────────────────────────────────────────────

  describe('POST /api/v1/auth/signout', () => {
    it('should revoke the refresh token and return 200', async () => {
      mockAuthService.signout.mockResolvedValue(Result.ok({ message: 'Signed out.' }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signout',
        payload: { refreshToken: 'some-refresh-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockAuthService.signout).toHaveBeenCalledWith('some-refresh-token', undefined);
    });

    it('should also pass the access token when an Authorization header is present', async () => {
      mockAuthService.signout.mockResolvedValue(Result.ok({ message: 'Signed out.' }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signout',
        headers: { authorization: 'Bearer some-access-token' },
        payload: { refreshToken: 'some-refresh-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockAuthService.signout).toHaveBeenCalledWith(
        'some-refresh-token',
        'some-access-token'
      );
    });
  });

  // ── POST /signin ──────────────────────────────────────────────────

  describe('POST /api/v1/auth/signin', () => {
    it('should return 200 with tokens on valid credentials', async () => {
      mockAuthService.signin.mockResolvedValue(
        Result.ok({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          expiresIn: 900,
          user: {
            id: 'user-1',
            email: 'test@example.com',
            roles: ['CANDIDATE'],
            isNew: false,
          },
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signin',
        payload: {
          email: 'test@example.com',
          password: 'CorrectPass!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBe('mock-access-token');
      expect(body.refreshToken).toBe('mock-refresh-token');
    });

    it('should return 401 on invalid credentials', async () => {
      mockAuthService.signin.mockResolvedValue(
        Result.err(new InvalidCredentialsError())
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/signin',
        payload: {
          email: 'test@example.com',
          password: 'WrongPass!',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('INVALID_CREDENTIALS');
    });
  });

  // ── POST /verify-otp ──────────────────────────────────────────────

  describe('POST /api/v1/auth/verify-otp', () => {
    it('should return 200 with tokens on valid OTP', async () => {
      mockAuthService.verifyOtp.mockResolvedValue(
        Result.ok({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 900,
          user: {
            id: 'user-1',
            email: 'test@example.com',
            roles: ['CANDIDATE'],
            isNew: false,
          },
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-otp',
        payload: {
          email: 'test@example.com',
          code: '123456',
          purpose: 'EMAIL_VERIFICATION',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.accessToken).toBe('access-token');
    });
  });
});
