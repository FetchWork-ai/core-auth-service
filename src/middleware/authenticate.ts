import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtService, isIssuedBeforeEpoch } from '../infrastructure/security/jwt.js';
import { UserRepository } from '../modules/user/user.repository.js';
import { UnauthorizedError } from '../shared/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: {
      id: string;
      email: string;
      roles: string[];
    };
  }
}

export function authenticate(jwtService: JwtService, userRepo: UserRepository) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Extract the Authorization header
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'MISSING_TOKEN',
        message: 'Authorization header must be: Bearer <token>',
      });
    }

    const token = header.slice(7);

    // 2. Verify the JWT signature + expiry
    const payload = await jwtService.verifyAccess(token);
    if (payload.isErr()) {
      return reply.status(401).send({
        error: 'INVALID_TOKEN',
        message: payload.error.message,
      });
    }

    // 3. Check if the token has been revoked (logout blocklist)
    const isRevoked = await jwtService.isRevoked(payload.value.jti!);
    if (isRevoked) {
      return reply.status(401).send({
        error: 'TOKEN_REVOKED',
        message: 'This token has been revoked',
      });
    }

    // 4. Hydrate the user from the database (ensures user still exists)
    const userResult = await userRepo.findById(payload.value.sub!);
    if (userResult.isErr() || !userResult.value) {
      return reply.status(401).send({
        error: 'USER_NOT_FOUND',
        message: 'The user associated with this token no longer exists',
      });
    }

    const user = userResult.value;

    // 5. A suspended account must lose access immediately, not when its token expires
    if (user.status !== 'ACTIVE') {
      return reply.status(403).send({
        error: 'ACCOUNT_NOT_ACTIVE',
        message: 'This account is not active',
      });
    }

    // 6. Reject tokens issued before the user's last password reset
    if (isIssuedBeforeEpoch(payload.value, user.tokensValidFrom)) {
      return reply.status(401).send({
        error: 'TOKEN_INVALIDATED',
        message: 'This token was invalidated by a credential change',
      });
    }

    // 7. Attach to request context for downstream handlers
    request.currentUser = {
      id: user.id,
      email: user.email,
      roles: [user.roles],
    };
  };
}