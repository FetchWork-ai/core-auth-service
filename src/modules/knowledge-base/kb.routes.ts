import { FastifyInstance } from 'fastify';
import { KnowledgeBaseController } from './kb.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { JwtService } from '../../infrastructure/security/jwt.js';
import { UserRepository } from '../user/user.repository.js';

interface KbRoutesOptions {
  kbController: KnowledgeBaseController;
  jwtService: JwtService;
  userRepository: UserRepository;
}

const errorResponseSchema = {
  type: 'object' as const,
  properties: {
    error: { type: 'string' as const },
    message: { type: 'string' as const },
  },
};

const kbResponseSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    userId: { type: 'string' as const },
    profileGraph: {
      type: 'object' as const,
      description: 'JSON object representing the user\'s parsed profile data (skills, experience, education, etc.)',
      additionalProperties: true,
    },
    version: { type: 'integer' as const },
    lastEnrichedAt: { type: 'string' as const, format: 'date-time' as const, nullable: true },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
    updatedAt: { type: 'string' as const, format: 'date-time' as const },
  },
};

export async function kbRoutes(
  fastify: FastifyInstance,
  options: KbRoutesOptions
) {
  const { kbController, jwtService, userRepository } = options;

  const authenticateMiddleware = authenticate(jwtService, userRepository);

  // ── GET / — Get current user's knowledge base ──────────────────────────

  fastify.get(
    '/',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description: 'Retrieve the current authenticated user\'s knowledge base profile graph.',
        summary: 'Get Knowledge Base',
        tags: ['Knowledge Base'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Knowledge base retrieved successfully',
            ...kbResponseSchema,
          },
          404: {
            description: 'Knowledge base not found for this user',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return kbController.getKnowledgeBase(request, reply);
    }
  );

  // ── PUT / — Upsert (deep-merge) the profile graph ─────────────────────

  fastify.put(
    '/',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description:
          'Create or update the user\'s knowledge base profile graph. ' +
          'The incoming `profileGraph` is deep-merged with the existing data: ' +
          'arrays are concatenated and deduplicated, nested objects are recursively merged, ' +
          'and scalar values are overwritten. Optimistic concurrency is enforced via `expectedVersion`.',
        summary: 'Upsert Profile Graph',
        tags: ['Knowledge Base'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['profileGraph', 'expectedVersion'],
          properties: {
            profileGraph: {
              type: 'object',
              description: 'The profile graph data to merge',
              additionalProperties: true,
            },
            expectedVersion: {
              type: 'integer',
              description:
                'The version number you last read. Set to 0 when creating for the first time. ' +
                'If the current version in the database does not match, a 409 Conflict is returned.',
            },
          },
        },
        response: {
          200: {
            description: 'Profile graph upserted successfully',
            ...kbResponseSchema,
          },
          409: {
            description: 'Version conflict — the knowledge base was modified since you last read it',
            ...errorResponseSchema,
          },
          404: {
            description: 'User not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return kbController.upsertProfileGraph(request, reply);
    }
  );

  // ── DELETE / — Delete the knowledge base ───────────────────────────────

  fastify.delete(
    '/',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description: 'Delete the current authenticated user\'s knowledge base.',
        summary: 'Delete Knowledge Base',
        tags: ['Knowledge Base'],
        security: [{ bearerAuth: [] }],
        response: {
          204: {
            type: 'null',
            description: 'Knowledge base deleted successfully',
          },
          404: {
            description: 'Knowledge base not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return kbController.deleteKnowledgeBase(request, reply);
    }
  );
}
