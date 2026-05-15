import { FastifyRequest, FastifyReply } from 'fastify';
import { UserService, UserProfile, UpdateUserData } from './user.service.js';
import { NotFoundError } from '../../shared/errors.js';

export class UserController {
  constructor(private readonly userService: UserService) {}

  async getCurrentUser(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;

    const result = await this.userService.getCurrentUser(userId);

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
        message: 'Failed to fetch user',
      });
    }

    const profile = result.value;
    return reply.send(this.serializeUserProfile(profile));
  }

  async updateCurrentUser(request: FastifyRequest<{ Body: UpdateUserData }>, reply: FastifyReply) {
    const userId = request.currentUser.id;
    const data = request.body;

    const result = await this.userService.updateUser(userId, data);

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
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    });
  }

  async deleteCurrentUser(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;

    const result = await this.userService.deleteUser(userId);

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

  private serializeUserProfile(profile: UserProfile) {
    return {
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
    };
  }
}