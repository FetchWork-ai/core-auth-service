import { FastifyRequest, FastifyReply } from 'fastify';
import { NotificationService } from './notification.service.js';
import { NotificationPreferenceData } from './notification.repository.js';
import { NotFoundError } from '../../shared/errors.js';

export class NotificationController {
  constructor(private readonly notifService: NotificationService) {}

  // ── GET / — Get current user's notification preferences ──────────────────

  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;

    const result = await this.notifService.getPreferences(userId);

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
        message: 'Failed to fetch notification preferences',
      });
    }

    return reply.send(result.value);
  }

  // ── PUT / — Update (upsert) notification preferences ─────────────────────

  async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;
    const data = request.body as NotificationPreferenceData;

    const result = await this.notifService.updatePreferences(userId, data);

    if (result.isErr()) {
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to update notification preferences',
      });
    }

    return reply.send(result.value);
  }

  // ── DELETE / — Reset notification preferences to defaults ────────────────

  async resetPreferences(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;

    const result = await this.notifService.resetPreferences(userId);

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
        message: 'Failed to reset notification preferences',
      });
    }

    return reply.status(204).send();
  }
}
