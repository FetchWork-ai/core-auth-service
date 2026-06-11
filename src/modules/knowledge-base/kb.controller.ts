import { FastifyRequest, FastifyReply } from 'fastify';
import { KnowledgeBaseService } from './kb.service.js';
import { NotFoundError, ConcurrencyConflictError } from '../../shared/errors.js';

export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  // ── GET / — Get current user's knowledge base ────────────────────────────

  async getKnowledgeBase(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;

    const result = await this.kbService.getKnowledgeBase(userId);

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
        message: 'Failed to fetch knowledge base',
      });
    }

    return reply.send(result.value);
  }

  // ── PUT / — Upsert (deep-merge) the profile graph ───────────────────────

  async upsertProfileGraph(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;
    const { profileGraph, expectedVersion } = request.body as {
      profileGraph: any;
      expectedVersion: number;
    };

    const result = await this.kbService.upsertProfileGraph(
      userId,
      profileGraph,
      expectedVersion
    );

    if (result.isErr()) {
      const error = result.error;

      if (error instanceof ConcurrencyConflictError) {
        return reply.status(409).send({
          error: error.code,
          message: error.message,
        });
      }

      if (error instanceof NotFoundError) {
        return reply.status(404).send({
          error: error.code,
          message: error.message,
        });
      }

      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to update knowledge base',
      });
    }

    return reply.send(result.value);
  }

  // ── DELETE / — Delete the knowledge base ─────────────────────────────────

  async deleteKnowledgeBase(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.currentUser.id;

    const result = await this.kbService.deleteKnowledgeBase(userId);

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
        message: 'Failed to delete knowledge base',
      });
    }

    return reply.status(204).send();
  }
}
