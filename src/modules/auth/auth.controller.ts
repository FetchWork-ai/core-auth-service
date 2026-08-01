import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service.js';
import { OAuthCallbackDto } from './oauth/oauth-provider.interface.js';
import {
  ConflictError,
  InvalidCredentialsError,
  UserNotVerifiedError,
  InvalidOtpError,
  MaxOtpAttemptsExceededError,
  OtpCooldownError,
  UnauthorizedError,
  NotFoundError,
} from '../../shared/errors.js';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── Email/Password Sign-Up ──────────────────────────────────────────────

  async signup(request: FastifyRequest, reply: FastifyReply) {
    const { email, password } = request.body as { email: string; password: string };

    const result = await this.authService.signup(email, password);

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof ConflictError) {
        return reply.status(409).send({ error: error.code, message: error.message });
      }

      return reply.status(400).send({ error: error.code, message: error.message });
    }

    return reply.status(201).send(result.value);
  }

  // ── OTP Verification ────────────────────────────────────────────────────

  async verifyOtp(request: FastifyRequest, reply: FastifyReply) {
    const { email, code, purpose } = request.body as {
      email: string;
      code: string;
      purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'MFA';
    };

    const result = await this.authService.verifyOtp(email, code, purpose);

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof MaxOtpAttemptsExceededError) {
        return reply.status(429).send({ error: error.code, message: error.message });
      }

      if (error instanceof UnauthorizedError) {
        return reply.status(401).send({ error: error.code, message: error.message });
      }

      return reply.status(400).send({ error: error.code, message: error.message });
    }

    return reply.send(result.value);
  }

  // ── Email/Password Sign-In ──────────────────────────────────────────────

  async signin(request: FastifyRequest, reply: FastifyReply) {
    const { email, password } = request.body as { email: string; password: string };

    const result = await this.authService.signin(email, password);

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof UserNotVerifiedError) {
        return reply.status(403).send({ error: error.code, message: error.message });
      }

      if (error instanceof InvalidCredentialsError) {
        return reply.status(401).send({ error: error.code, message: error.message });
      }

      return reply.status(401).send({ error: error.code, message: error.message });
    }

    return reply.send(result.value);
  }

  // ── Resend OTP ──────────────────────────────────────────────────────────

  async resendOtp(request: FastifyRequest, reply: FastifyReply) {
    const { email, purpose } = request.body as {
      email: string;
      purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'MFA';
    };

    const result = await this.authService.resendOtp(email, purpose);

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof OtpCooldownError) {
        return reply.status(429).send({ error: error.code, message: error.message });
      }

      return reply.status(400).send({ error: error.code, message: error.message });
    }

    return reply.send(result.value);
  }

  // ── OAuth Callback (existing) ───────────────────────────────────────────

  async handleCallback(request: FastifyRequest, reply: FastifyReply) {
    const { provider } = request.params as { provider: string };
    const body = request.body as OAuthCallbackDto;

    const result = await this.authService.handleCallback({
      provider,
      ...body,
    });

    if (result.isErr()) {
      return reply.status(400).send({
        error: result.error.code,
        message: result.error.message,
      });
    }

    return reply.send(result.value);
  }

  async refreshTokens(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = request.body as { refreshToken: string };

    const result = await this.authService.refreshTokens(refreshToken);

    if (result.isErr()) {
      return reply.status(401).send({
        error: result.error.code,
        message: result.error.message,
      });
    }

    return reply.send(result.value);
  }

  // ── Sign Out ────────────────────────────────────────────────────────────

  async signout(request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken } = request.body as { refreshToken: string };

    // Revoke the access token too when the client bothered to send it, otherwise
    // it stays usable for the remainder of its 15m life.
    const header = request.headers.authorization;
    const accessToken = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    const result = await this.authService.signout(refreshToken, accessToken);

    return reply.send(result.isOk() ? result.value : { message: 'Signed out.' });
  }

  // ── Password Reset Flow ──────────────────────────────────────────────────

  async requestPasswordReset(request: FastifyRequest, reply: FastifyReply) {
    const { email } = request.body as { email: string };

    const result = await this.authService.requestPasswordReset(email);

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof OtpCooldownError) {
        return reply.status(429).send({ error: error.code, message: error.message });
      }

      return reply.status(400).send({ error: error.code, message: error.message });
    }

    return reply.send(result.value);
  }

  async resetPassword(request: FastifyRequest, reply: FastifyReply) {
    const { email, code, newPassword } = request.body as {
      email: string;
      code: string;
      newPassword: string;
    };

    const result = await this.authService.resetPassword(email, code, newPassword);

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof MaxOtpAttemptsExceededError) {
        return reply.status(429).send({ error: error.code, message: error.message });
      }

      if (error instanceof NotFoundError) {
        return reply.status(404).send({ error: error.code, message: error.message });
      }

      return reply.status(400).send({ error: error.code, message: error.message });
    }

    return reply.send(result.value);
  }
}
