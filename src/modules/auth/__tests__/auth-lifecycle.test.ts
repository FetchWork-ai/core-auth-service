import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../auth.service.js';
import { Result } from '../../../shared/result.js';
import {
  ConflictError,
  InvalidCredentialsError,
  UserNotVerifiedError,
} from '../../../shared/errors.js';

// ── Mock Factories ──────────────────────────────────────────────────────

function createMockUserRepo() {
  return {
    createWithPassword: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    updateStatus: vi.fn(),
    updatePassword: vi.fn(),
  };
}

function createMockOAuthRepo() {
  return { findByProvider: vi.fn(), upsert: vi.fn() };
}

function createMockEncryption() {
  return { encrypt: vi.fn(), decrypt: vi.fn() };
}

function createMockJwt() {
  return {
    signAccess: vi.fn().mockResolvedValue('mock-access-token'),
    signRefresh: vi.fn().mockResolvedValue('mock-refresh-token'),
    verifyAccess: vi.fn(),
    verifyRefresh: vi.fn(),
    isRevoked: vi.fn().mockResolvedValue(false),
    revokeToken: vi.fn(),
  };
}

function createMockKafka() {
  return { publish: vi.fn().mockResolvedValue(undefined) };
}

function createMockHash() {
  return {
    hash: vi.fn().mockResolvedValue(Result.ok('$argon2id$hashed')),
    verify: vi.fn(),
  };
}

function createMockOtp() {
  return {
    generate: vi.fn().mockReturnValue({
      code: '123456',
      codeHash: 'hashed-otp',
      expiresAt: new Date(Date.now() + 600000),
    }),
    hashOtp: vi.fn().mockReturnValue('hashed-otp'),
  };
}

function createMockEmailSender() {
  return {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    sendExistingAccountNotice: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockOtpRepo() {
  return {
    save: vi.fn().mockResolvedValue(Result.ok({ id: 'otp-1' })),
    findActive: vi.fn(),
    incrementAttempts: vi.fn().mockResolvedValue(Result.ok({})),
    delete: vi.fn().mockResolvedValue(Result.ok(undefined)),
  };
}

function buildAuthService(overrides: any = {}) {
  const providers = overrides.providers ?? new Map();
  const userRepo = overrides.userRepo ?? createMockUserRepo();
  const oauthRepo = overrides.oauthRepo ?? createMockOAuthRepo();
  const encryption = overrides.encryption ?? createMockEncryption();
  const jwt = overrides.jwt ?? createMockJwt();
  const kafka = overrides.kafka ?? createMockKafka();
  const hashService = overrides.hashService ?? createMockHash();
  const otpService = overrides.otpService ?? createMockOtp();
  const emailSender = overrides.emailSender ?? createMockEmailSender();
  const otpRepo = overrides.otpRepo ?? createMockOtpRepo();

  const service = new AuthService(
    providers,
    userRepo,
    oauthRepo,
    encryption,
    jwt,
    kafka,
    hashService,
    otpService,
    emailSender,
    otpRepo
  );

  return { service, userRepo, oauthRepo, jwt, hashService, otpService, emailSender, otpRepo, kafka };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('AuthService — Signup → Verify → Signin Lifecycle', () => {
  // ── Signup ──────────────────────────────────────────────────────

  describe('signup()', () => {
    it('should register a new user and send verification email', async () => {
      const { service, userRepo, emailSender, otpRepo } = buildAuthService();

      userRepo.createWithPassword.mockResolvedValue(
        Result.ok({ id: 'user-1', email: 'test@example.com', roles: 'CANDIDATE' })
      );

      const result = await service.signup('test@example.com', 'SecureP@ss123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.email).toBe('test@example.com');
      }

      expect(userRepo.createWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        passwordHash: '$argon2id$hashed',
      });

      expect(emailSender.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', '123456');
      expect(otpRepo.save).toHaveBeenCalled();
    });

    it('should answer identically for a taken email and notify the account holder', async () => {
      const { service, userRepo, emailSender } = buildAuthService();

      userRepo.createWithPassword.mockResolvedValue(
        Result.err(new ConflictError('Email already registered'))
      );
      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'existing@example.com',
          roles: 'CANDIDATE',
          status: 'ACTIVE',
        })
      );

      const taken = await service.signup('existing@example.com', 'SecureP@ss123');

      // Same shape a brand-new registration produces — no existence oracle
      expect(taken.isOk()).toBe(true);
      if (taken.isOk()) {
        expect(taken.value.email).toBe('existing@example.com');
      }
      expect(emailSender.sendExistingAccountNotice).toHaveBeenCalledWith('existing@example.com');
      expect(emailSender.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should be byte-identical between a fresh and a taken email', async () => {
      const fresh = buildAuthService();
      fresh.userRepo.createWithPassword.mockResolvedValue(
        Result.ok({ id: 'user-1', email: 'a@example.com', roles: 'CANDIDATE' })
      );

      const taken = buildAuthService();
      taken.userRepo.createWithPassword.mockResolvedValue(
        Result.err(new ConflictError('Email already registered'))
      );
      taken.userRepo.findByEmail.mockResolvedValue(
        Result.ok({ id: 'user-2', email: 'a@example.com', roles: 'CANDIDATE', status: 'ACTIVE' })
      );

      const freshResult = await fresh.service.signup('a@example.com', 'SecureP@ss123');
      const takenResult = await taken.service.signup('a@example.com', 'SecureP@ss123');

      expect(freshResult.isOk()).toBe(true);
      expect(takenResult.isOk()).toBe(true);
      if (freshResult.isOk() && takenResult.isOk()) {
        expect(takenResult.value).toEqual(freshResult.value);
      }
    });

    it('should resend a verification code when the existing account never verified', async () => {
      const { service, userRepo, emailSender, otpRepo } = buildAuthService();

      userRepo.createWithPassword.mockResolvedValue(
        Result.err(new ConflictError('Email already registered'))
      );
      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'pending@example.com',
          roles: 'CANDIDATE',
          status: 'PENDING_VERIFICATION',
        })
      );

      const result = await service.signup('pending@example.com', 'SecureP@ss123');

      expect(result.isOk()).toBe(true);
      // A lost first email must not dead-end the user on a silent 201
      expect(emailSender.sendVerificationEmail).toHaveBeenCalledWith('pending@example.com', '123456');
      expect(emailSender.sendExistingAccountNotice).not.toHaveBeenCalled();
      expect(otpRepo.save).toHaveBeenCalled();
    });

    it('should still hash the password before discovering the email is taken', async () => {
      const { service, userRepo, hashService } = buildAuthService();

      userRepo.createWithPassword.mockResolvedValue(
        Result.err(new ConflictError('Email already registered'))
      );
      userRepo.findByEmail.mockResolvedValue(
        Result.ok({ id: 'user-1', email: 'x@example.com', roles: 'CANDIDATE', status: 'ACTIVE' })
      );

      await service.signup('x@example.com', 'SecureP@ss123');

      // Skipping argon2 on the conflict path would leak by timing what the
      // status code no longer leaks
      expect(hashService.hash).toHaveBeenCalledWith('SecureP@ss123');
    });
  });

  // ── Verify OTP ──────────────────────────────────────────────────

  describe('verifyOtp()', () => {
    it('should activate user and return tokens on valid OTP', async () => {
      const { service, userRepo, otpRepo } = buildAuthService();

      otpRepo.findActive.mockResolvedValue(
        Result.ok({
          id: 'otp-1',
          email: 'test@example.com',
          codeHash: 'hashed-otp',
          purpose: 'EMAIL_VERIFICATION',
          attempts: 0,
          expiresAt: new Date(Date.now() + 600000),
          createdAt: new Date(),
        })
      );

      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          roles: 'CANDIDATE',
          status: 'PENDING_VERIFICATION',
        })
      );
      userRepo.updateStatus.mockResolvedValue(Result.ok({}));

      const result = await service.verifyOtp('test@example.com', '123456', 'EMAIL_VERIFICATION');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.accessToken).toBe('mock-access-token');
        expect(result.value.refreshToken).toBe('mock-refresh-token');
        expect(result.value.user.email).toBe('test@example.com');
      }

      expect(userRepo.updateStatus).toHaveBeenCalledWith('user-1', 'ACTIVE');
      expect(otpRepo.delete).toHaveBeenCalledWith('otp-1');
    });

    it('should reject invalid OTP code', async () => {
      const { service, otpRepo, otpService } = buildAuthService();

      otpRepo.findActive.mockResolvedValue(
        Result.ok({
          id: 'otp-1',
          email: 'test@example.com',
          codeHash: 'correct-hash',
          purpose: 'EMAIL_VERIFICATION',
          attempts: 0,
          expiresAt: new Date(Date.now() + 600000),
          createdAt: new Date(),
        })
      );

      // Make hashOtp return a DIFFERENT hash to simulate wrong code
      otpService.hashOtp.mockReturnValue('wrong-hash');

      const result = await service.verifyOtp('test@example.com', '999999', 'EMAIL_VERIFICATION');

      expect(result.isErr()).toBe(true);
      expect(otpRepo.incrementAttempts).toHaveBeenCalledWith('otp-1');
    });

    it('should reject when max attempts (3) exceeded', async () => {
      const { service, otpRepo } = buildAuthService();

      otpRepo.findActive.mockResolvedValue(
        Result.ok({
          id: 'otp-1',
          email: 'test@example.com',
          codeHash: 'hashed-otp',
          purpose: 'EMAIL_VERIFICATION',
          attempts: 3, // Max reached
          expiresAt: new Date(Date.now() + 600000),
          createdAt: new Date(),
        })
      );

      const result = await service.verifyOtp('test@example.com', '123456', 'EMAIL_VERIFICATION');

      expect(result.isErr()).toBe(true);
      expect(otpRepo.delete).toHaveBeenCalledWith('otp-1');
    });

    it('should not issue tokens for a PASSWORD_RESET code', async () => {
      const { service, otpRepo, jwt } = buildAuthService();

      const result = await service.verifyOtp('test@example.com', '123456', 'PASSWORD_RESET' as any);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('UNSUPPORTED_OTP_PURPOSE');
      }
      // Rejected before the OTP is ever looked up — no session is minted
      expect(otpRepo.findActive).not.toHaveBeenCalled();
      expect(jwt.signAccess).not.toHaveBeenCalled();
      expect(jwt.signRefresh).not.toHaveBeenCalled();
    });

    it('should not issue tokens for an MFA code', async () => {
      const { service, jwt } = buildAuthService();

      const result = await service.verifyOtp('test@example.com', '123456', 'MFA' as any);

      expect(result.isErr()).toBe(true);
      expect(jwt.signAccess).not.toHaveBeenCalled();
    });

    it('should reject a suspended user holding a valid OTP', async () => {
      const { service, userRepo, otpRepo, jwt } = buildAuthService();

      otpRepo.findActive.mockResolvedValue(
        Result.ok({
          id: 'otp-1',
          email: 'test@example.com',
          codeHash: 'hashed-otp',
          purpose: 'EMAIL_VERIFICATION',
          attempts: 0,
          expiresAt: new Date(Date.now() + 600000),
          createdAt: new Date(),
        })
      );

      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          roles: 'CANDIDATE',
          status: 'SUSPENDED',
        })
      );

      const result = await service.verifyOtp('test@example.com', '123456', 'EMAIL_VERIFICATION');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('UNAUTHORIZED');
      }
      expect(userRepo.updateStatus).not.toHaveBeenCalled();
      expect(jwt.signAccess).not.toHaveBeenCalled();
    });
  });

  // ── Signin ──────────────────────────────────────────────────────

  describe('signin()', () => {
    it('should return tokens for an active user with correct password', async () => {
      const { service, userRepo, hashService } = buildAuthService();

      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          roles: 'CANDIDATE',
          status: 'ACTIVE',
        })
      );
      hashService.verify.mockResolvedValue(Result.ok(true));

      const result = await service.signin('test@example.com', 'CorrectPass!');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.accessToken).toBe('mock-access-token');
        expect(result.value.refreshToken).toBe('mock-refresh-token');
      }
    });

    it('should reject wrong password', async () => {
      const { service, userRepo, hashService } = buildAuthService();

      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          roles: 'CANDIDATE',
          status: 'ACTIVE',
        })
      );
      hashService.verify.mockResolvedValue(Result.ok(false));

      const result = await service.signin('test@example.com', 'WrongPass!');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidCredentialsError);
      }
    });

    it('should reject PENDING_VERIFICATION user', async () => {
      const { service, userRepo, hashService } = buildAuthService();

      userRepo.findByEmail.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          passwordHash: '$argon2id$hashed',
          roles: 'CANDIDATE',
          status: 'PENDING_VERIFICATION',
        })
      );
      hashService.verify.mockResolvedValue(Result.ok(true));

      const result = await service.signin('test@example.com', 'CorrectPass!');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(UserNotVerifiedError);
      }
    });

    it('should reject non-existent user', async () => {
      const { service, userRepo } = buildAuthService();

      userRepo.findByEmail.mockResolvedValue(Result.ok(null));

      const result = await service.signin('nobody@example.com', 'AnyPass!');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(InvalidCredentialsError);
      }
    });
  });

  // ── Refresh ─────────────────────────────────────────────────────

  describe('refreshTokens()', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    function mockValidRefresh(jwt: any, iat = nowSeconds) {
      jwt.verifyRefresh.mockResolvedValue(
        Result.ok({ sub: 'user-1', jti: 'jti-1', iat, exp: nowSeconds + 604800 })
      );
    }

    it('should rotate tokens for an active user', async () => {
      const { service, userRepo, jwt } = buildAuthService();
      mockValidRefresh(jwt);
      userRepo.findById.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          roles: 'CANDIDATE',
          status: 'ACTIVE',
          tokensValidFrom: new Date((nowSeconds - 3600) * 1000),
        })
      );

      const result = await service.refreshTokens('some-refresh-token');

      expect(result.isOk()).toBe(true);
      expect(jwt.revokeToken).toHaveBeenCalledWith('jti-1', expect.any(Number));
    });

    it('should refuse to refresh a suspended account', async () => {
      const { service, userRepo, jwt } = buildAuthService();
      mockValidRefresh(jwt);
      userRepo.findById.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          roles: 'CANDIDATE',
          status: 'SUSPENDED',
          tokensValidFrom: new Date((nowSeconds - 3600) * 1000),
        })
      );

      const result = await service.refreshTokens('some-refresh-token');

      expect(result.isErr()).toBe(true);
      expect(jwt.signAccess).not.toHaveBeenCalled();
    });

    it('should refuse a token issued before the last password reset', async () => {
      const { service, userRepo, jwt } = buildAuthService();
      // Token minted an hour ago, password reset 5 minutes ago
      mockValidRefresh(jwt, nowSeconds - 3600);
      userRepo.findById.mockResolvedValue(
        Result.ok({
          id: 'user-1',
          email: 'test@example.com',
          roles: 'CANDIDATE',
          status: 'ACTIVE',
          tokensValidFrom: new Date((nowSeconds - 300) * 1000),
        })
      );

      const result = await service.refreshTokens('stolen-refresh-token');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toMatch(/invalidated/i);
      }
      expect(jwt.signAccess).not.toHaveBeenCalled();
    });
  });
});
