import { Result } from '../../shared/result.js';
import { UserRepository } from '../user/user.repository.js';
import { OAuthConnectionRepository } from './oauth/oauth-connection.repository.js';
import { EncryptionService } from '../../infrastructure/security/encryption.js';
import { JwtService } from '../../infrastructure/security/jwt.js';
import { KafkaProducer, EventName } from '../../infrastructure/messaging/kafka.js';
import { HashService } from '../../infrastructure/security/hash.js';
import { OtpService } from '../../infrastructure/security/otp.js';
import { IEmailSender } from '../../infrastructure/email/email.service.js';
import { OtpRepository } from './otp/otp.repository.js';
import {
  IOAuthProvider,
  OAuthCallbackDto,
  TokenResponse,
  RemoteProfile,
} from './oauth/oauth-provider.interface.js';
import {
  InvalidProviderError,
  OAuthDeniedError,
  MissingEmailError,
  UnauthorizedError,
  DomainError,
  ConflictError,
  InvalidCredentialsError,
  UserNotVerifiedError,
  InvalidOtpError,
  MaxOtpAttemptsExceededError,
  OtpCooldownError,
  NotFoundError,
} from '../../shared/errors.js';

export class AuthError extends DomainError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
  }
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    roles: string[];
    isNew: boolean;
  };
}

export class AuthService {
  private readonly MAX_OTP_ATTEMPTS = 3;
  private readonly OTP_COOLDOWN_SECONDS = 60;

  constructor(
    private readonly providers: Map<string, IOAuthProvider>,
    private readonly userRepo: UserRepository,
    private readonly oauthRepo: OAuthConnectionRepository,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
    private readonly kafka: KafkaProducer,
    private readonly hashService: HashService,
    private readonly otpService: OtpService,
    private readonly emailSender: IEmailSender,
    private readonly otpRepo: OtpRepository
  ) {}

  // ── Email/Password Sign-Up ──────────────────────────────────────────────

  async signup(email: string, password: string): Promise<Result<{ message: string; email: string }, DomainError>> {
    // 1. Hash password
    const hashResult = await this.hashService.hash(password);
    if (hashResult.isErr()) {
      return Result.err(new AuthError('Failed to hash password'));
    }

    // 2. Create user with PENDING_VERIFICATION status
    const userResult = await this.userRepo.createWithPassword({
      email,
      passwordHash: hashResult.value,
    });

    if (userResult.isErr()) {
      return Result.err(userResult.error as DomainError);
    }

    // 3. Generate OTP and persist
    const otp = this.otpService.generate(email);
    const otpResult = await this.otpRepo.save({
      email,
      codeHash: otp.codeHash,
      purpose: 'EMAIL_VERIFICATION',
      expiresAt: otp.expiresAt,
    });

    if (otpResult.isErr()) {
      return Result.err(new AuthError('Failed to generate verification code'));
    }

    // 4. Send verification email
    await this.emailSender.sendVerificationEmail(email, otp.code);

    // 5. Publish Kafka event
    await this.kafka.publish(EventName.ProfileEnrichmentTriggered, {
      userId: userResult.value.id,
      provider: 'EMAIL',
      providerAccessToken: '',
    });

    return Result.ok({
      message: 'User registered successfully. Verification code sent to email.',
      email,
    });
  }

  // ── OTP Verification ────────────────────────────────────────────────────

  async verifyOtp(
    email: string,
    code: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'MFA'
  ): Promise<Result<AuthResult, DomainError>> {
    // 1. Find active OTP
    const otpResult = await this.otpRepo.findActive(email, purpose);
    if (otpResult.isErr()) {
      return Result.err(new InvalidOtpError());
    }

    const otpRecord = otpResult.value;
    if (!otpRecord) {
      return Result.err(new InvalidOtpError());
    }

    // 2. Check max attempts
    if (otpRecord.attempts >= this.MAX_OTP_ATTEMPTS) {
      await this.otpRepo.delete(otpRecord.id);
      return Result.err(new MaxOtpAttemptsExceededError());
    }

    // 3. Verify OTP hash
    const expectedHash = this.otpService.hashOtp(code, email);
    if (expectedHash !== otpRecord.codeHash) {
      await this.otpRepo.incrementAttempts(otpRecord.id);
      return Result.err(new InvalidOtpError());
    }

    // 4. Delete OTP (single use)
    await this.otpRepo.delete(otpRecord.id);

    // 5. Find user and update status
    const userResult = await this.userRepo.findByEmail(email);
    if (userResult.isErr() || !userResult.value) {
      return Result.err(new InvalidOtpError('User not found'));
    }

    const user = userResult.value;

    // 6. If this is email verification, activate the user
    if (purpose === 'EMAIL_VERIFICATION') {
      await this.userRepo.updateStatus(user.id, 'ACTIVE');
    }

    // 7. Issue tokens
    const accessToken = await this.jwt.signAccess({ sub: user.id, roles: [user.roles] });
    const refreshToken = await this.jwt.signRefresh({ sub: user.id });

    return Result.ok({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        roles: [user.roles],
        isNew: false,
      },
    });
  }

  // ── Email/Password Sign-In ──────────────────────────────────────────────

  async signin(email: string, password: string): Promise<Result<AuthResult, DomainError>> {
    // 1. Find user by email
    const userResult = await this.userRepo.findByEmail(email);
    if (userResult.isErr() || !userResult.value) {
      return Result.err(new InvalidCredentialsError());
    }

    const user = userResult.value;

    // 2. Check if user has a password (could be OAuth-only)
    if (!user.passwordHash) {
      return Result.err(new InvalidCredentialsError());
    }

    // 3. Verify password
    const verifyResult = await this.hashService.verify(password, user.passwordHash);
    if (verifyResult.isErr() || !verifyResult.value) {
      return Result.err(new InvalidCredentialsError());
    }

    // 4. Check user status
    if (user.status === 'PENDING_VERIFICATION') {
      return Result.err(new UserNotVerifiedError());
    }

    if (user.status === 'SUSPENDED') {
      return Result.err(new UnauthorizedError('Account has been suspended'));
    }

    // 5. Issue tokens
    const accessToken = await this.jwt.signAccess({ sub: user.id, roles: [user.roles] });
    const refreshToken = await this.jwt.signRefresh({ sub: user.id });

    return Result.ok({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        roles: [user.roles],
        isNew: false,
      },
    });
  }

  // ── Resend OTP ──────────────────────────────────────────────────────────

  async resendOtp(
    email: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'MFA'
  ): Promise<Result<{ message: string }, DomainError>> {
    // 1. Check cooldown — if an active OTP was created < 60s ago, reject
    const existingOtp = await this.otpRepo.findActive(email, purpose);
    if (existingOtp.isOk() && existingOtp.value) {
      const secondsSinceCreated = (Date.now() - existingOtp.value.createdAt.getTime()) / 1000;
      if (secondsSinceCreated < this.OTP_COOLDOWN_SECONDS) {
        return Result.err(new OtpCooldownError());
      }
    }

    // 2. Verify user exists
    const userResult = await this.userRepo.findByEmail(email);
    if (userResult.isErr() || !userResult.value) {
      // Return success anyway to avoid email enumeration
      return Result.ok({ message: 'Verification code resent.' });
    }

    // 3. Generate and persist new OTP
    const otp = this.otpService.generate(email);
    const otpResult = await this.otpRepo.save({
      email,
      codeHash: otp.codeHash,
      purpose,
      expiresAt: otp.expiresAt,
    });

    if (otpResult.isErr()) {
      return Result.err(new AuthError('Failed to generate verification code'));
    }

    // 4. Send email
    if (purpose === 'EMAIL_VERIFICATION') {
      await this.emailSender.sendVerificationEmail(email, otp.code);
    } else {
      await this.emailSender.sendPasswordResetEmail(email, otp.code);
    }

    return Result.ok({ message: 'Verification code resent.' });
  }

  // ── OAuth Callback (existing) ───────────────────────────────────────────

  async handleCallback(dto: OAuthCallbackDto & { provider: string }): Promise<Result<AuthResult, AuthError>> {
    // 1. Look up the OAuth provider strategy
    const provider = this.providers.get(dto.provider.toUpperCase());
    if (!provider) {
      return Result.err(new InvalidProviderError(dto.provider));
    }

    // 2. Exchange authorization code for provider tokens
    const tokenResponse = await provider.exchangeCode(dto);
    if (tokenResponse.isErr()) {
      return Result.err(tokenResponse.error);
    }

    // 3. Fetch the remote user profile (email, id, etc.)
    const remoteProfile = await provider.getUserProfile(tokenResponse.value.accessToken);
    if (remoteProfile.isErr()) {
      return Result.err(remoteProfile.error);
    }

    // 4. Encrypt the access & refresh tokens before persistence
    const encryptedAccess = await this.encryption.encrypt(tokenResponse.value.accessToken);
    if (encryptedAccess.isErr()) {
      return Result.err(encryptedAccess.error);
    }

    let encryptedRefresh: string | null = null;
    if (tokenResponse.value.refreshToken) {
      const result = await this.encryption.encrypt(tokenResponse.value.refreshToken);
      if (result.isOk()) {
        encryptedRefresh = result.value;
      }
    }

    // 5. Atomic upsert: find by email or OAuth identity, create if neither exists
    const userResult = await this.userRepo.upsertByEmail({
      email: remoteProfile.value.email,
      defaultRole: 'CANDIDATE',
    });

    if (userResult.isErr()) {
      return Result.err(new AuthError('Failed to upsert user'));
    }

    const user = userResult.value;
    const isNew = user.createdAt.getTime() === user.updatedAt.getTime();

    // 6. Persist (or update) the OAuth connection row
    const connectionResult = await this.oauthRepo.upsertConnection({
      userId: user.id,
      provider: dto.provider.toUpperCase(),
      providerUserId: remoteProfile.value.id,
      encryptedToken: encryptedAccess.value,
      scope: tokenResponse.value.scope ?? [],
      expiresAt: tokenResponse.value.expiresAt,
    });

    if (connectionResult.isErr()) {
      return Result.err(new AuthError('Failed to upsert OAuth connection'));
    }

    // 7. Issue tokens
    const accessToken = await this.jwt.signAccess({ sub: user.id, roles: [user.roles] });
    const refreshToken = await this.jwt.signRefresh({ sub: user.id });

    // 8. If this is a brand-new user, request profile enrichment
    if (isNew) {
      await this.kafka.publish(EventName.ProfileEnrichmentTriggered, {
        userId: user.id,
        provider: dto.provider.toUpperCase(),
        providerAccessToken: tokenResponse.value.accessToken,
      });
    }

    return Result.ok({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        roles: [user.roles],
        isNew,
      },
    });
  }

  async refreshTokens(refreshToken: string): Promise<Result<{ accessToken: string; refreshToken: string }, UnauthorizedError>> {
    // Verify refresh token
    const payload = await this.jwt.verifyRefresh(refreshToken);
    if (payload.isErr()) {
      return Result.err(payload.error);
    }

    // Check if token is revoked (single-use check)
    const isRevoked = await this.jwt.isRevoked(payload.value.jti!);
    if (isRevoked) {
      return Result.err(new UnauthorizedError('Token has been revoked'));
    }

    // Fetch user
    const userResult = await this.userRepo.findById(payload.value.sub!);
    if (userResult.isErr() || !userResult.value) {
      return Result.err(new UnauthorizedError('User not found'));
    }

    // Revoke old token and issue new ones
    await this.jwt.revokeToken(payload.value.jti!);

    const accessToken = await this.jwt.signAccess({ sub: userResult.value.id, roles: [userResult.value.roles] });
    const newRefreshToken = await this.jwt.signRefresh({ sub: userResult.value.id });

    return Result.ok({ accessToken, refreshToken: newRefreshToken });
  }

  // ── Request Password Reset ─────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<Result<{ message: string }, DomainError>> {
    // 1. Check cooldown for existing PASSWORD_RESET OTP
    const existingOtp = await this.otpRepo.findActive(email, 'PASSWORD_RESET');
    if (existingOtp.isOk() && existingOtp.value) {
      const secondsSinceCreated = (Date.now() - existingOtp.value.createdAt.getTime()) / 1000;
      if (secondsSinceCreated < this.OTP_COOLDOWN_SECONDS) {
        return Result.err(new OtpCooldownError());
      }
    }

    // 2. Verify user exists
    const userResult = await this.userRepo.findByEmail(email);
    if (userResult.isErr() || !userResult.value) {
      // Return success anyway to prevent email enumeration
      return Result.ok({ message: 'If the email exists, a password reset code has been sent.' });
    }

    const user = userResult.value;
    if (user.status === 'SUSPENDED') {
      return Result.err(new UnauthorizedError('Account has been suspended'));
    }

    // 3. Generate and persist OTP
    const otp = this.otpService.generate(email);
    const otpResult = await this.otpRepo.save({
      email,
      codeHash: otp.codeHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: otp.expiresAt,
    });

    if (otpResult.isErr()) {
      return Result.err(new AuthError('Failed to generate password reset code'));
    }

    // 4. Send email
    await this.emailSender.sendPasswordResetEmail(email, otp.code);

    return Result.ok({ message: 'If the email exists, a password reset code has been sent.' });
  }

  // ── Reset Password ──────────────────────────────────────────────────────

  async resetPassword(
    email: string,
    code: string,
    newPassword: string
  ): Promise<Result<{ message: string }, DomainError>> {
    // 1. Find active PASSWORD_RESET OTP
    const otpResult = await this.otpRepo.findActive(email, 'PASSWORD_RESET');
    if (otpResult.isErr()) {
      return Result.err(new InvalidOtpError());
    }

    const otpRecord = otpResult.value;
    if (!otpRecord) {
      return Result.err(new InvalidOtpError());
    }

    // 2. Check max attempts
    if (otpRecord.attempts >= this.MAX_OTP_ATTEMPTS) {
      await this.otpRepo.delete(otpRecord.id);
      return Result.err(new MaxOtpAttemptsExceededError());
    }

    // 3. Verify OTP hash
    const expectedHash = this.otpService.hashOtp(code, email);
    if (expectedHash !== otpRecord.codeHash) {
      await this.otpRepo.incrementAttempts(otpRecord.id);
      return Result.err(new InvalidOtpError());
    }

    // 4. Delete OTP (single use)
    await this.otpRepo.delete(otpRecord.id);

    // 5. Find user
    const userResult = await this.userRepo.findByEmail(email);
    if (userResult.isErr() || !userResult.value) {
      return Result.err(new NotFoundError('User not found'));
    }

    const user = userResult.value;
    if (user.status === 'SUSPENDED') {
      return Result.err(new UnauthorizedError('Account has been suspended'));
    }

    // 6. Hash new password
    const hashResult = await this.hashService.hash(newPassword);
    if (hashResult.isErr()) {
      return Result.err(new AuthError('Failed to hash password'));
    }

    // 7. Update password in DB
    const updateResult = await this.userRepo.updatePassword(user.id, hashResult.value);
    if (updateResult.isErr()) {
      return Result.err(updateResult.error as DomainError);
    }

    // 8. If user was pending verification, activate them now
    if (user.status === 'PENDING_VERIFICATION') {
      await this.userRepo.updateStatus(user.id, 'ACTIVE');
    }

    return Result.ok({ message: 'Password reset successful.' });
  }
}