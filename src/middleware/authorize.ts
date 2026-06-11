import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Must be used AFTER the `authenticate` middleware, as it relies on `request.currentUser`.
 * 
 * @param allowedRoles Array of roles permitted to access the route (e.g., ['ADMIN', 'RECRUITER'])
 */
export function authorize(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Ensure the user is authenticated first
    if (!request.currentUser) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required before authorization check',
      });
    }

    const userRoles = request.currentUser.roles;

    // 2. Check if the user has any of the allowed roles
    const hasAccess = userRoles.some((role) => allowedRoles.includes(role));

    if (!hasAccess) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'You do not have permission to access this resource',
      });
    }
  };
}
