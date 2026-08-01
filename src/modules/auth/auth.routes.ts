import { FastifyInstance } from 'fastify';
import { AuthController } from './auth.controller.js';

export interface AuthRoutesOptions {
  authController: AuthController;
}

// ── Shared schema definitions ───────────────────────────────────────────────

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
      schema: {
        description: 'Register a new user with email and password. A 6-digit OTP verification code is sent to the provided email.',
        summary: 'Email/Password Sign-Up',
        tags: ['Authentication - Email/Password'],
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', description: 'User email address' },
            password: {
              type: 'string',
              minLength: 8,
              description: 'Password (min 8 characters, should contain uppercase, lowercase, number, and special character)',
            },
          },
        },
        response: {
          201: {
            description: 'User created successfully. Verification OTP sent to email.',
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
          409: {
            description: 'Conflict — user with this email already exists',
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

  // ── POST /password-reset/request ───────────────────────────────────────

  fastify.post(
    '/password-reset/request',
    {
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
            newPassword: { type: 'string', minLength: 8, description: 'New password (minimum 8 characters)' },
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
