import { FastifyInstance, FastifyRequest } from 'fastify';
import { AuthController } from './auth.controller.js';

export interface AuthRoutesOptions {
  authController: AuthController;
}

// ── Shared schema definitions ───────────────────────────────────────────────

// Enforces what the description has always claimed: lower, upper, digit, symbol.
// The upper bound keeps an attacker from burning CPU on megabyte-long argon2 inputs.
const PASSWORD_PATTERN = '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,128}$';
const PASSWORD_RULES =
  'Minimum 8 characters (max 128) and must contain an uppercase letter, a lowercase letter, a number, and a special character';

const passwordSchema = {
  type: 'string',
  minLength: 8,
  maxLength: 128,
  pattern: PASSWORD_PATTERN,
  description: PASSWORD_RULES,
};

/**
 * Per-email rate limit for the OTP endpoints.
 *
 * The global bucket is keyed by IP, which a distributed attacker sidesteps for free.
 * Keying by the email in the body caps how many codes can be minted for — and guessed
 * against — a single account, closing the "3 attempts, but attempts reset with every
 * new code" cycle. Runs at preValidation so the parsed body is available; the payload
 * is untrusted at that point, hence the type guard and the IP fallback.
 */
function perEmailRateLimit(label: string, max: number, timeWindow: string) {
  return {
    max,
    timeWindow,
    hook: 'preValidation' as const,
    keyGenerator: (req: FastifyRequest) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === 'string'
        ? `${label}:email:${email.trim().toLowerCase()}`
        : `${label}:ip:${req.ip}`;
    },
    // The plugin *throws* whatever this returns, so statusCode must be carried
    // through — omit it and Fastify serialises the rejection as a 500.
    errorResponseBuilder: (_req: FastifyRequest, context: { statusCode: number }) => ({
      statusCode: context.statusCode,
      error: 'RATE_LIMITED',
      message: 'Too many requests for this account. Please try again later.',
    }),
  };
}

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
  },
};

const authTokenResponseSchema = {
  type: 'object',
  properties: {
    accessToken: { type: 'string', description: 'JWT access token (15m expiry)' },
    refreshToken: { type: 'string', description: 'JWT refresh token (7d expiry)' },
    expiresIn: { type: 'number', description: 'Access token TTL in seconds' },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        roles: { type: 'array', items: { type: 'string' } },
        isNew: { type: 'boolean' },
      },
    },
  },
};

export async function authRoutes(
  fastify: FastifyInstance,
  options: AuthRoutesOptions
) {
  const { authController } = options;

  // ── POST /signup ────────────────────────────────────────────────────────

  fastify.post(
    '/signup',
    {
      config: { rateLimit: perEmailRateLimit('signup', 5, '1 hour') },
      schema: {
        description:
          'Register a new user with email and password. A 6-digit OTP verification code is sent to the provided email. Always returns 201, whether or not the email is already registered — an existing account holder is notified by email rather than the caller being told the address is taken.',
        summary: 'Email/Password Sign-Up',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User email address' },
            password: passwordSchema,
          },
        },
        response: {
          201: {
            description: 'Registration accepted. Returned identically for new and already-registered emails.',
            type: 'object',
            properties: {
              message: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
          },
          400: {
            description: 'Bad request — validation error or password too weak',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.signup(request, reply);
    }
  );

  // ── POST /verify-otp ───────────────────────────────────────────────────

  fastify.post(
    '/verify-otp',
    {
      config: { rateLimit: perEmailRateLimit('verify-otp', 10, '1 hour') },
      schema: {
        description: 'Verify a 6-digit EMAIL_VERIFICATION OTP code sent via email. On success the user status is set to ACTIVE and JWT tokens are returned. PASSWORD_RESET codes are not accepted here — redeem them at POST /password-reset, which requires a new password.',
        summary: 'Verify Email OTP',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email', 'code', 'purpose'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User email address' },
            code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP code' },
            purpose: {
              type: 'string',
              enum: ['EMAIL_VERIFICATION'],
              description: 'Purpose of the OTP verification. Only EMAIL_VERIFICATION exchanges an OTP for a session.',
            },
          },
        },
        response: {
          200: {
            description: 'OTP verified successfully. Returns JWT tokens and user info.',
            ...authTokenResponseSchema,
          },
          400: {
            description: 'Invalid or expired OTP, or an OTP purpose that cannot be verified here',
            ...errorResponseSchema,
          },
          401: {
            description: 'Account has been suspended',
            ...errorResponseSchema,
          },
          429: {
            description: 'Too many failed verification attempts',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.verifyOtp(request, reply);
    }
  );

  // ── POST /signin ───────────────────────────────────────────────────────

  fastify.post(
    '/signin',
    {
      schema: {
        description: 'Sign in with email and password. Returns JWT tokens on success. Returns 403 if the email is not yet verified.',
        summary: 'Email/Password Sign-In',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User email address' },
            password: { type: 'string', description: 'User password' },
          },
        },
        response: {
          200: {
            description: 'Sign-in successful. Returns JWT tokens and user info.',
            ...authTokenResponseSchema,
          },
          401: {
            description: 'Invalid email or password',
            ...errorResponseSchema,
          },
          403: {
            description: 'Email not verified — user must complete OTP verification first',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.signin(request, reply);
    }
  );

  // ── POST /otp/resend ───────────────────────────────────────────────────

  fastify.post(
    '/otp/resend',
    {
      config: { rateLimit: perEmailRateLimit('otp-resend', 5, '1 hour') },
      schema: {
        description: 'Resend a new 6-digit OTP to the specified email. Subject to a 60-second cooldown between requests. Always returns 200 to prevent email enumeration.',
        summary: 'Resend OTP',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email', 'purpose'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User email address' },
            purpose: {
              type: 'string',
              enum: ['EMAIL_VERIFICATION', 'PASSWORD_RESET', 'MFA'],
              description: 'Purpose of the OTP',
            },
          },
        },
        response: {
          200: {
            description: 'OTP resent (or silently ignored for unknown emails)',
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          429: {
            description: 'Cooldown period not expired — please wait before requesting a new OTP',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.resendOtp(request, reply);
    }
  );

  // ── POST /:provider/callback (OAuth - existing) ────────────────────────

  fastify.post(
    '/:provider/callback',
    {
      schema: {
        description: 'Exchange an OAuth authorization code for JWT tokens. Supports GitHub provider.',
        summary: 'OAuth Callback',
        tags: ['Authentication - OAuth'],
        params: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['github'] },
          },
        },
        body: {
          type: 'object',
          required: ['code', 'redirectUri'],
          properties: {
            code: { type: 'string', description: 'OAuth authorization code' },
            redirectUri: { type: 'string', description: 'OAuth redirect URI' },
            codeVerifier: { type: 'string', description: 'PKCE code verifier (optional)' },
          },
        },
        response: {
          200: {
            description: 'OAuth authentication successful. Returns JWT tokens and user info.',
            ...authTokenResponseSchema,
          },
          400: {
            description: 'OAuth error — invalid code, denied access, or missing email',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.handleCallback(request, reply);
    }
  );

  // ── POST /refresh (existing) ───────────────────────────────────────────

  fastify.post(
    '/refresh',
    {
      schema: {
        description: 'Exchange a valid refresh token for a new pair of access and refresh tokens. The old refresh token is revoked (rotation).',
        summary: 'Refresh Tokens',
        tags: ['Authentication - Token Management'],
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', description: 'JWT refresh token' },
          },
        },
        response: {
          200: {
            description: 'Tokens refreshed successfully',
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              refreshToken: { type: 'string' },
            },
          },
          401: {
            description: 'Invalid or revoked refresh token',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.refreshTokens(request, reply);
    }
  );

  // ── POST /signout ──────────────────────────────────────────────────────

  fastify.post(
    '/signout',
    {
      schema: {
        description:
          'Sign out by revoking the presented refresh token. If an Authorization header is supplied, that access token is revoked as well. Always returns 200 — an invalid or expired token means the caller is signed out regardless.',
        summary: 'Sign Out',
        tags: ['Authentication - Token Management'],
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string', description: 'JWT refresh token to revoke' },
          },
        },
        response: {
          200: {
            description: 'Signed out',
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      return authController.signout(request, reply);
    }
  );

  // ── POST /password-reset/request ───────────────────────────────────────

  fastify.post(
    '/password-reset/request',
    {
      config: { rateLimit: perEmailRateLimit('password-reset-request', 5, '1 hour') },
      schema: {
        description: 'Request a password reset OTP code. Sends an email to the user if the account exists.',
        summary: 'Request Password Reset OTP',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User registered email address' },
          },
        },
        response: {
          200: {
            description: 'Password reset OTP generated and email sent (if email exists)',
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          429: {
            description: 'OTP resend cooldown active (60 seconds)',
            ...errorResponseSchema,
          },
          400: {
            description: 'Validation error',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.requestPasswordReset(request, reply);
    }
  );

  // ── POST /password-reset ───────────────────────────────────────────────

  fastify.post(
    '/password-reset',
    {
      config: { rateLimit: perEmailRateLimit('password-reset', 10, '1 hour') },
      schema: {
        description: 'Reset password using the OTP code received via email.',
        summary: 'Reset Password',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email', 'code', 'newPassword'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User registered email address' },
            code: { type: 'string', minLength: 6, maxLength: 6, description: '6-digit OTP code received in email' },
            newPassword: passwordSchema,
          },
        },
        response: {
          200: {
            description: 'Password reset successful',
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          429: {
            description: 'Maximum OTP verification attempts exceeded',
            ...errorResponseSchema,
          },
          404: {
            description: 'User not found',
            ...errorResponseSchema,
          },
          400: {
            description: 'Invalid OTP code or password validation failed',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return authController.resetPassword(request, reply);
    }
  );
}
