# Middleware & Security Hardening

This documentation covers the security and middleware improvements implemented across the `core-auth-service`. These additions make the application secure, resilient, and production-ready.

---

## 1. Role-Based Access Control (RBAC)

**Location**: `src/middleware/authorize.ts`

The `authorize` middleware ensures that only users with specific roles can access protected routes.

### How it Works
1.  **Dependency**: It must run *after* the `authenticate` middleware, which decodes the JWT and sets `request.currentUser`.
2.  **Validation**: It takes an array of allowed roles (e.g., `['ADMIN', 'RECRUITER']`) and checks if the authenticated user possesses at least one of those roles.
3.  **Rejection**: If the user lacks the required roles, it immediately halts the request and returns a `403 Forbidden` response.

### Usage Example
```typescript
fastify.get('/admin/dashboard', {
  preHandler: [
    authenticateMiddleware, 
    authorize(['ADMIN']) // Only admins can access this route
  ]
}, async (request, reply) => {
  // ... handler logic
});
```

---

## 2. Global Error Handler

**Location**: `src/middleware/error-handler.ts`

The global error handler intercepts all errors thrown during a request's lifecycle, ensuring that the client receives a standardized, secure JSON response.

### Handled Error Types
*   **Domain Errors**: Custom application errors (e.g., `NotFoundError`, `ConflictError`, `UnauthorizedError`) are mapped to their correct HTTP status codes (404, 409, 401).
*   **Validation Errors**: Fastify schema validation errors (e.g., missing required body fields, invalid formats) are intercepted and returned as `400 Bad Request` with detailed schema paths indicating exactly what was wrong.
*   **Malformed JSON**: Native parsing errors are caught and returned as `400 Bad Request`.
*   **Unhandled Exceptions**: If a completely unexpected error occurs (e.g., database connection failure), it returns a generic `500 Internal Server Error`. The actual stack trace is **securely logged** via Pino and is never leaked to the client.

---

## 3. Stateful JWT Token Revocation (Redis Blocklist)

**Location**: `src/infrastructure/security/jwt.ts`

To support secure sign-outs and token refresh rotation, JWTs must be explicitly invalidated. Because JWTs are stateless by design, we use **Redis** to maintain a blocklist.

### How it Works
1.  **Revocation (`revokeToken`)**: When a token needs to be invalidated (e.g., during a token refresh), its unique ID (`jti`) is added to Redis.
    *   **Auto-Cleanup**: We use the Redis `SETEX` command to set the key with an expiration time (`EX`) equal to the token's remaining time-to-live (TTL). Once the token would have naturally expired anyway, Redis automatically deletes it, preventing memory bloat.
2.  **Verification (`isRevoked`)**: Every time a token is verified, the system checks Redis. If the `jti` is found in the blocklist, the token is rejected.
3.  **Graceful Fallback**: If `REDIS_URL` is missing from `.env` (e.g., during local development without Docker), the system gracefully falls back to an in-memory `Set`. This ensures development isn't blocked, though it is not recommended for production.
