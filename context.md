# Core Auth Service - Progress Walkthrough

## Overview
This document summarizes the progress made so far in building the Core Auth Service using Fastify, adhering to Domain-Driven Design principles.

## Work Completed

### 1. Project Initialization & Structure
- Bootstrapped the Node.js project with `package.json` and TypeScript configuration (`tsconfig.json`).
- Set up the foundation for Domain-Driven Design.
- Established the Prisma database schema for data modeling.
- Implemented the `Result<T, E>` domain utility in `src/shared/result.ts` for standardized error handling.
- Created the foundational `docker-compose.yml` for infrastructure requirements.

### 2. Configuration Management
- Implemented robust, type-safe environment configuration using `zod` and `dotenv` in `src/config/index.ts`.
- Validated essential environment variables on startup to prevent misconfigurations, including:
  - `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL`
  - `DATABASE_URL`
  - `KAFKA_BROKERS`
  - `JWT_SECRET`
  - `OTP_SALT_SECRET` — HMAC salt for hashing OTP codes
  - `REDIS_URL`

### 3. Server Setup & Application Factory
- Configured the main Fastify application instance in `src/app.ts` with robust logging.
- Set up a server entry point in `src/server.ts` that handles graceful shutdown on `SIGINT` and `SIGTERM` signals.
- Integrated rate limiting using `@fastify/rate-limit` (100 requests per minute).

### 4. API Documentation & Testing Routes
- Installed and configured `@fastify/swagger` and `@fastify/swagger-ui` to auto-generate OpenAPI documentation.
- Exposed the Swagger documentation UI at the `/docs` route.
- Organized endpoints into Swagger tag groups: `System`, `Authentication - Email/Password`, `Authentication - OAuth`, `Authentication - Token Management`, `Users`.
- Added base routes for testing and health monitoring with integrated OpenAPI schemas:
  - `GET /health`: Returns a simple `{ status: 'ok' }` object.
  - `GET /`: Returns a `{ message: 'Core Auth Service is running' }` object.

### 5. Database Layer Implementation
- **Prisma Client**: Created `src/infrastructure/db/prisma.ts` with singleton pattern and connection/disconnection helpers.
- **Dependency Injection**: Set up `src/config/di.ts` with Awilix container registering all dependencies.
- **Error Classes**: Created comprehensive domain error classes in `src/shared/errors.ts`:
  - Core errors: `UnauthorizedError`, `NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`
  - OAuth errors: `InvalidProviderError`, `OAuthDeniedError`, `MissingEmailError`
  - Concurrency: `ConcurrencyConflictError`
  - Auth/OTP errors: `UserNotVerifiedError`, `InvalidCredentialsError`, `InvalidOtpError`, `MaxOtpAttemptsExceededError`, `OtpCooldownError`
- **Logging**: Implemented pino-based logger in `src/shared/logger.ts`.

### 6. Database Schema (Prisma)
- **Enums**: `UserRole`, `UserStatus` (PENDING_VERIFICATION, ACTIVE, SUSPENDED), `OtpPurpose` (EMAIL_VERIFICATION, PASSWORD_RESET, MFA), `OAuthProvider`, `DigestFrequency`
- **User model**: `id`, `email` (citext), `passwordHash` (optional, supports OAuth-only users), `status` (default PENDING_VERIFICATION), `roles`, timestamps, relations to OAuthConnection, NotificationPreference, KnowledgeBase
- **OtpRecord model**: `id`, `email` (citext), `codeHash`, `purpose`, `attempts` (brute-force tracking), `expiresAt`, timestamps, indexed on `[email, purpose]`
- **OAuthConnection model**: provider-specific tokens, encrypted storage
- **NotificationPreference model**: digest frequency, match score, quiet hours
- **KnowledgeBase model**: profile graph (JSON), versioned

### 7. Infrastructure Services
- **JWT Service**: `src/infrastructure/security/jwt.ts` — sign/verify methods for access (15m) and refresh (7d) tokens, token revocation support.
- **Encryption Service**: `src/infrastructure/security/encryption.ts` — AES-256-GCM envelope encryption for OAuth tokens.
- **Hash Service**: `src/infrastructure/security/hash.ts` — Argon2id password hashing with production parameters (64MB memory, 3 iterations, 4 parallelism).
- **OTP Service**: `src/infrastructure/security/otp.ts` — Cryptographic 6-digit OTP generation via `crypto.randomInt`, HMAC-SHA256 hashing for secure DB storage, 10-minute expiry.
- **Email Service**: `src/infrastructure/email/email.service.ts` — `IEmailSender` interface (port/adapter pattern) with two implementations:
  - `ConsoleEmailSender` — logs OTP to terminal for development
  - `SmtpEmailSender` — production SMTP sender via `nodemailer` (supports Resend, Mailtrap, SendGrid, AWS SES, or any SMTP provider). Auto-selected when `SMTP_*` environment variables are configured.
- **Kafka Producer**: `src/infrastructure/messaging/kafka.ts` — event publishing for ProfileEnrichmentTriggered, UserDeleted, PreferencesUpdated.

### 8. Repositories
- **UserRepository**: `src/modules/user/user.repository.ts` — findById, findByEmail, createWithPassword, upsertByEmail, updateStatus, updatePassword, update, delete
- **OtpRepository**: `src/modules/auth/otp/otp.repository.ts` — save (auto-invalidates previous OTPs), findActive (excludes expired), incrementAttempts, delete
- **OAuthConnectionRepository**: `src/modules/auth/oauth/oauth-connection.repository.ts` — findByProviderAndUserId, upsertConnection, findAllByUserId, deleteByUserId
- **KnowledgeBaseRepository**: `src/modules/knowledge-base/kb.repository.ts` — findByUserId, upsert, delete
- **NotificationPreferenceRepository**: `src/modules/notifications/notification.repository.ts` — findByUserId, upsert, delete

### 9. OAuth Providers
- **Interface**: `src/modules/auth/oauth/oauth-provider.interface.ts` with TokenResponse, RemoteProfile, OAuthCallbackDto types
- **GitHub Provider**: `src/modules/auth/oauth/github.provider.ts` — OAuth flow with token exchange and user profile fetching
- **LinkedIn Provider**: `src/modules/auth/oauth/linkedin.provider.ts` — OAuth flow with token exchange and user profile fetching

### 10. Auth Module (Email/Password + OTP + OAuth)
- **AuthService**: `src/modules/auth/auth.service.ts` — Full implementation:
  - `signup(email, password)`: Hashes password (Argon2id), creates user with PENDING_VERIFICATION status, generates/persists OTP, sends verification email, publishes Kafka event
  - `verifyOtp(email, code, purpose)`: Validates OTP hash against DB, tracks attempts (max 3), activates user on EMAIL_VERIFICATION success, issues JWT tokens
  - `signin(email, password)`: Validates credentials, checks user status (rejects PENDING_VERIFICATION with 403, SUSPENDED with 401), issues JWT tokens
  - `resendOtp(email, purpose)`: Enforces 60-second cooldown, generates new OTP, sends email. Returns 200 for unknown emails (anti-enumeration)
  - `handleCallback(dto)`: OAuth callback flow (GitHub/LinkedIn) — token exchange, profile fetch, token encryption, user upsert, connection persist, JWT issuance
  - `refreshTokens(refreshToken)`: Token rotation with revocation
  - `requestPasswordReset(email)`: Generates PASSWORD_RESET OTP, enforces 60s cooldown, sends reset email. Returns 200 for unknown emails (anti-enumeration)
  - `resetPassword(email, code, newPassword)`: Verifies OTP (max 3 attempts), hashes new password (Argon2id), updates DB. Activates pending users on success
- **AuthController**: `src/modules/auth/auth.controller.ts` — HTTP handlers with proper status code mapping (201, 400, 401, 403, 404, 409, 429)
- **AuthRoutes**: `src/modules/auth/auth.routes.ts` — Full Swagger/OpenAPI documentation for all endpoints:
  - `POST /api/v1/auth/signup` — Email/password registration (201, 400, 409)
  - `POST /api/v1/auth/verify-otp` — OTP verification, returns JWT tokens (200, 400, 429)
  - `POST /api/v1/auth/signin` — Email/password sign-in (200, 401, 403)
  - `POST /api/v1/auth/otp/resend` — Resend OTP with 60s cooldown (200, 429)
  - `POST /api/v1/auth/:provider/callback` — OAuth callback (200, 400)
  - `POST /api/v1/auth/refresh` — Token refresh with rotation (200, 401)
  - `POST /api/v1/auth/password-reset/request` — Request password reset OTP (200, 429)
  - `POST /api/v1/auth/password-reset` — Reset password with OTP (200, 400, 404, 429)

### 11. User Module
- **UserService**: Full implementation with getCurrentUser, updateUser, deleteUser
- **UserController**: `src/modules/user/user.controller.ts` — handles HTTP requests
- **UserRoutes**: `src/modules/user/user.routes.ts` — GET /users/me, PUT /users/me, DELETE /users/me
- **Authenticate Middleware**: `src/middleware/authenticate.ts` — JWT verification and user hydration

### 12. Security Features
- **Argon2id** password hashing (64MB memory, 3 iterations, parallelism 4)
- **Cryptographic OTP** via `crypto.randomInt` (6-digit codes)
- **HMAC-SHA256** hashed OTP storage (no plaintext OTPs in DB)
- **Max 3 attempts** per OTP before auto-deletion (brute-force protection)
- **60-second cooldown** between OTP resend requests (throttling)
- **10-minute OTP expiry** (time-limited validity)
- **Anti-enumeration**: resend endpoint always returns 200 for unknown emails
- **AES-256-GCM** encryption for stored OAuth provider tokens

### 13. Knowledge Base Module
- **KnowledgeBaseService**: `src/modules/knowledge-base/kb.service.ts` — Full implementation:
  - `getKnowledgeBase(userId)`: Retrieves the user's knowledge base profile graph from the database
  - `upsertProfileGraph(userId, incoming, expectedVersion)`: Deep-merges incoming profile graph data with existing data, enforcing optimistic concurrency via version checking
  - `deleteKnowledgeBase(userId)`: Removes the user's knowledge base record
  - `deepMergeProfileGraph(existing, incoming)`: Private recursive merge algorithm — concatenates & deduplicates arrays, recursively merges nested objects, overwrites scalars with incoming values
- **KnowledgeBaseController**: `src/modules/knowledge-base/kb.controller.ts` — HTTP handlers for GET, PUT, DELETE with proper status codes (200, 204, 404, 409)
- **KnowledgeBaseRoutes**: `src/modules/knowledge-base/kb.routes.ts` — Full Swagger/OpenAPI documentation:
  - `GET /api/v1/users/me/kb` — Retrieve knowledge base (200, 404)
  - `PUT /api/v1/users/me/kb` — Upsert profile graph with deep merge and version check (200, 404, 409)
  - `DELETE /api/v1/users/me/kb` — Delete knowledge base (204, 404)
- All routes require Bearer token authentication via `authenticate` middleware

### 14. Notifications Module
- **NotificationService**: `src/modules/notifications/notification.service.ts` — Full implementation:
  - `getPreferences(userId)`: Retrieves the user's notification preferences from the database
  - `updatePreferences(userId, data)`: Upserts notification preferences — creates with sensible defaults if none exist, otherwise updates only the provided fields
  - `resetPreferences(userId)`: Deletes the user's notification preferences, restoring system defaults
- **NotificationController**: `src/modules/notifications/notification.controller.ts` — HTTP handlers for GET, PUT, DELETE with proper status codes (200, 204, 404)
- **NotificationRoutes**: `src/modules/notifications/notification.routes.ts` — Full Swagger/OpenAPI documentation:
  - `GET /api/v1/users/me/notifications` — Retrieve notification preferences (200, 404)
  - `PUT /api/v1/users/me/notifications` — Upsert notification preferences (200)
  - `DELETE /api/v1/users/me/notifications` — Reset preferences to defaults (204, 404)
- **Configurable preferences**: digestFrequency (INSTANT/DAILY/WEEKLY/NEVER), minMatchScore (0.00–1.00), notifyOnNewJobs, notifyOnStatusChange, quietHoursStart/End (HH:MM), channels (email/push/sms)
- All routes require Bearer token authentication via `authenticate` middleware

### 15. Middleware & Security Hardening
- **Role-Based Access Control (RBAC)**: Added `src/middleware/authorize.ts` which checks `request.currentUser.roles` against allowed roles (returns 403 Forbidden).
- **Global Error Handler**: Added `src/middleware/error-handler.ts` which standardizes error responses. Catches `DomainError` variants, Fastify schema validation errors, and logs unhandled exceptions securely (returning generic 500 without leaking stack traces).
- **Token Blocklist**: Upgraded `JwtService` to use `ioredis` for true stateful token revocation. `isRevoked` checks Redis via `EXISTS bl_<jti>`, and `revokeToken` sets a Redis key with an expiration (`EX`) equal to the token's remaining TTL, automatically cleaning up expired blocklist entries.

### 16. Testing
- **Vitest Configuration**: `vitest.config.ts` — Node environment, global imports, 15s timeout
- **Unit Tests**:
  - `src/infrastructure/security/__tests__/hash.test.ts` — HashService: Argon2id hashing produces valid hashes, salted (different hashes per call), correct password verification, wrong password rejection (4 tests)
  - `src/infrastructure/security/__tests__/otp.test.ts` — OtpService: 6-digit code generation, 10-minute expiry, deterministic HMAC-SHA256 hashing, different hashes for different codes/emails, unique codes across calls (8 tests)
  - `src/modules/knowledge-base/__tests__/kb-merge.test.ts` — KnowledgeBaseService deep merge: scalar overwrite, array concatenation/deduplication, nested object recursive merge, new key addition, existing key preservation, edge cases (empty objects, deeply nested) (10 tests)
- **Integration Tests**:
  - `src/modules/auth/__tests__/auth-lifecycle.test.ts` — AuthService with mocked repos: signup success, duplicate email conflict, OTP verification with user activation, invalid OTP rejection, max attempts exceeded, signin success, wrong password, PENDING_VERIFICATION rejection, non-existent user (9 tests)
- **Route Tests**:
  - `src/modules/auth/__tests__/auth-routes.test.ts` — Fastify injection: POST /signup (201, 409, 400), POST /signin (200, 401), POST /verify-otp (200) with mocked AuthService (6 tests)
- **Total: 37 tests, 5 test files, all passing**

---

## Next Steps

### Priority 1: Email/Password Authentication (COMPLETED ✅)
- ✅ Implement signup, signin, verify-otp, resend-otp endpoints
- ✅ Add Argon2id password hashing
- ✅ Add OTP generation, hashing, and verification
- ✅ Add email sender interface (Console implementation for dev)
- ✅ Update Prisma schema with UserStatus, OtpPurpose, OtpRecord
- ✅ Full Swagger documentation for all auth endpoints

### Priority 2: User Module Implementation (COMPLETED ✅)
- ✅ Implement User routes in `src/modules/user/user.routes.ts`
- ✅ Implement User controller in `src/modules/user/user.controller.ts`
- ✅ Complete UserService implementation

### Priority 3: Production Email Sender (COMPLETED ✅)
- ✅ Implement SMTP/SendGrid/SES adapter for `IEmailSender` interface
- ✅ Replace `ConsoleEmailSender` with production implementation (SmtpEmailSender via nodemailer)
- ✅ Add email templates for verification and password reset
- ✅ Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` environment config with Zod validation
- ✅ Conditional wiring: uses `SmtpEmailSender` when SMTP vars are set, falls back to `ConsoleEmailSender`
- ✅ Implement password reset flow:
  - `POST /api/v1/auth/password-reset/request` — sends PASSWORD_RESET OTP
  - `POST /api/v1/auth/password-reset` — verifies OTP and updates password (single-step)
  - Added `updatePassword` method to `UserRepository`
  - Added `requestPasswordReset` and `resetPassword` methods to `AuthService`

### Priority 4: Knowledge Base Module (COMPLETED ✅)
- ✅ Implement KB routes in `src/modules/knowledge-base/kb.routes.ts` with full Swagger/OpenAPI docs
- ✅ Implement KB controller in `src/modules/knowledge-base/kb.controller.ts`
- ✅ Implement deepMergeProfileGraph logic in KnowledgeBaseService:
  - Arrays: concatenated and deduplicated (by value for primitives, by JSON for objects)
  - Nested objects: recursively merged
  - Scalars: incoming value overwrites existing
- ✅ Optimistic concurrency control via `expectedVersion` (returns 409 on version mismatch)
- ✅ Endpoints registered at `/api/v1/users/me/kb`:
  - `GET /` — Retrieve the user's knowledge base (200, 404)
  - `PUT /` — Upsert (deep-merge) the profile graph with version check (200, 409, 404)
  - `DELETE /` — Delete the user's knowledge base (204, 404)
- ✅ All routes require Bearer token authentication

### Priority 5: Notifications Module (COMPLETED ✅)
- ✅ Implement notification routes in `src/modules/notifications/notification.routes.ts` with full Swagger/OpenAPI docs
- ✅ Implement notification controller in `src/modules/notifications/notification.controller.ts`
- ✅ Complete NotificationService implementation:
  - `getPreferences(userId)`: Fetch with NotFoundError handling
  - `updatePreferences(userId, data)`: Upsert with partial updates (only provided fields are changed)
  - `resetPreferences(userId)`: Delete preferences to restore system defaults
- ✅ Endpoints registered at `/api/v1/users/me/notifications`:
  - `GET /` — Retrieve notification preferences (200, 404)
  - `PUT /` — Upsert notification preferences with partial fields (200)
  - `DELETE /` — Reset preferences to system defaults (204, 404)
- ✅ Configurable preferences: digestFrequency, minMatchScore, notifyOnNewJobs, notifyOnStatusChange, quietHours, channels
- ✅ All routes require Bearer token authentication

### Priority 6: Middleware & Security Hardening (COMPLETED ✅)
- ✅ Implement `src/middleware/authorize.ts` — Role-based access control
- ✅ Implement `src/middleware/error-handler.ts` — Global error serialization
- ✅ Add Redis integration for JWT token blocklist (replace in-memory stubs) with `ioredis`

### Priority 7: Testing (COMPLETED ✅)
- ✅ Add vitest configuration (`vitest.config.ts`)
- ✅ Unit tests for HashService (4 tests) — Argon2id hashing and verification
- ✅ Unit tests for OtpService (8 tests) — code generation, HMAC hashing, uniqueness
- ✅ Unit tests for KB deep merge (10 tests) — scalar overwrite, array dedup, nested merge, edge cases
- ✅ Integration tests for signup → verify → signin lifecycle (9 tests) — mocked repositories
- ✅ Route tests with Fastify injection (6 tests) — POST /signup, /signin, /verify-otp
- ✅ **37 tests total, 5 test files, all passing**