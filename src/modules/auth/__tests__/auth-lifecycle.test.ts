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
        expect(result.value.message).toContain('registered successfully');
        expect(result.value.email).toBe('test@example.com');
      }

      expect(userRepo.createWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        passwordHash: '$argon2id$hashed',
      });

      expect(emailSender.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', '123456');
      expect(otpRepo.save).toHaveBeenCalled();
    });

    it('should return error when email already exists', async () => {
      const { service, userRepo } = buildAuthService();

      userRepo.createWithPassword.mockResolvedValue(
        Result.err(new ConflictError('Email already registered'))
      );

      const result = await service.signup('existing@example.com', 'Password1!');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ConflictError);
      }
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
});
