import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminService, AdminListUsersOptions, AdminUpdateUserData } from './admin.service.js';
import { NotFoundError } from '../../shared/errors.js';
import { UserRole, UserStatus } from '@prisma/client';

export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  async listUsers(
    request: FastifyRequest<{ Querystring: { page?: number; limit?: number; search?: string; role?: UserRole; status?: UserStatus } }>,
    reply: FastifyReply
  ) {
    const options: AdminListUsersOptions = {
      page: request.query.page,
      limit: request.query.limit,
      search: request.query.search,
      role: request.query.role,
      status: request.query.status,
    };

    const result = await this.adminService.listUsers(options);

    if (result.isErr()) {
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to list users',
      });
    }

    return reply.send(result.value);
  }

  async getUserDetails(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) {
    const userId = request.params.id;
    const result = await this.adminService.getUserDetails(userId);

    if (result.isErr()) {
      const error = result.error;
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch user details',
      });
    }

    const profile = result.value;
    return reply.send({
      id: profile.id,
      email: profile.email,
      roles: profile.roles,
      connectedProviders: profile.connectedProviders.map((p) => ({
        provider: p.provider,
        providerUserId: p.providerUserId,
        scopes: p.scopes,
        connectedAt: p.connectedAt.toISOString(),
      })),
      createdAt: profile.createdAt.toISOString(),
    });
  }

  async updateUser(
    request: FastifyRequest<{ Params: { id: string }; Body: AdminUpdateUserData }>,
    reply: FastifyReply
  ) {
    const targetUserId = request.params.id;
    const data = request.body;

    const result = await this.adminService.updateUser(targetUserId, data);

    if (result.isErr()) {
      const error = result.error;
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to update user',
      });
    }

    const user = result.value;
    return reply.send({
      id: user.id,
      email: user.email,
      roles: [user.roles],
      status: user.status,
      updatedAt: user.updatedAt.toISOString(),
    });
  }

  async deleteUser(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) {
    const targetUserId = request.params.id;

    const result = await this.adminService.deleteUser(targetUserId);

    if (result.isErr()) {
      const error = result.error;
      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to delete user',
      });
    }

    return reply.status(204).send();
  }

  async getSystemStats(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const result = await this.adminService.getSystemStats();

    if (result.isErr()) {
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to get system stats',
      });
    }

    return reply.send(result.value);
  }
}
