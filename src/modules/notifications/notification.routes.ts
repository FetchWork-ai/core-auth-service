import { FastifyInstance } from 'fastify';
import { NotificationController } from './notification.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { JwtService } from '../../infrastructure/security/jwt.js';
import { UserRepository } from '../user/user.repository.js';

interface NotificationRoutesOptions {
  notificationController: NotificationController;
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

const notificationPreferenceResponseSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    userId: { type: 'string' as const },
    digestFrequency: {
      type: 'string' as const,
      enum: ['INSTANT', 'DAILY', 'WEEKLY', 'NEVER'],
    },
    minMatchScore: {
      type: 'number' as const,
      description: 'Minimum match score threshold (0.00–1.00)',
    },
    notifyOnNewJobs: { type: 'boolean' as const },
    notifyOnStatusChange: { type: 'boolean' as const },
    quietHoursStart: {
      type: 'string' as const,
      nullable: true,
      description: 'Start of quiet hours in HH:MM format (e.g. "22:00")',
    },
    quietHoursEnd: {
      type: 'string' as const,
      nullable: true,
      description: 'End of quiet hours in HH:MM format (e.g. "07:00")',
    },
    channels: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Notification delivery channels (e.g. ["email", "push", "sms"])',
    },
    createdAt: { type: 'string' as const, format: 'date-time' as const },
    updatedAt: { type: 'string' as const, format: 'date-time' as const },
  },
};

export async function notificationRoutes(
  fastify: FastifyInstance,
  options: NotificationRoutesOptions
) {
  const { notificationController, jwtService, userRepository } = options;

  const authenticateMiddleware = authenticate(jwtService, userRepository);

  // ── GET / — Get notification preferences ───────────────────────────────

  fastify.get(
    '/',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description:
          'Retrieve the current authenticated user\'s notification preferences including digest frequency, ' +
          'match score threshold, quiet hours, and delivery channels.',
        summary: 'Get Notification Preferences',
        tags: ['Notification Preferences'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Notification preferences retrieved successfully',
            ...notificationPreferenceResponseSchema,
          },
          404: {
            description: 'No notification preferences found for this user (use PUT to create)',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return notificationController.getPreferences(request, reply);
    }
  );

  // ── PUT / — Update (upsert) notification preferences ──────────────────

  fastify.put(
    '/',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description:
          'Create or update the authenticated user\'s notification preferences. ' +
          'All fields are optional — only the provided fields will be updated. ' +
          'If no preferences exist yet, they will be created with sensible defaults for omitted fields.',
        summary: 'Update Notification Preferences',
        tags: ['Notification Preferences'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            digestFrequency: {
              type: 'string',
              enum: ['INSTANT', 'DAILY', 'WEEKLY', 'NEVER'],
              description: 'How often to receive digest notifications',
            },
            minMatchScore: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Minimum match score threshold (0.00–1.00). Only matches above this score trigger notifications.',
            },
            notifyOnNewJobs: {
              type: 'boolean',
              description: 'Whether to receive notifications when new matching jobs are found',
            },
            notifyOnStatusChange: {
              type: 'boolean',
              description: 'Whether to receive notifications when application status changes',
            },
            quietHoursStart: {
              type: 'string',
              pattern: '^\\d{2}:\\d{2}$',
              description: 'Start of quiet hours in HH:MM format (e.g. "22:00"). Set to null to disable.',
              nullable: true,
            },
            quietHoursEnd: {
              type: 'string',
              pattern: '^\\d{2}:\\d{2}$',
              description: 'End of quiet hours in HH:MM format (e.g. "07:00"). Set to null to disable.',
              nullable: true,
            },
            channels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Notification delivery channels (e.g. ["email", "push", "sms"])',
            },
          },
        },
        response: {
          200: {
            description: 'Notification preferences updated successfully',
            ...notificationPreferenceResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return notificationController.updatePreferences(request, reply);
    }
  );

  // ── DELETE / — Reset notification preferences ─────────────────────────

  fastify.delete(
    '/',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description:
          'Delete the authenticated user\'s notification preferences, resetting them to system defaults. ' +
          'A subsequent GET will return 404 until new preferences are created via PUT.',
        summary: 'Reset Notification Preferences',
        tags: ['Notification Preferences'],
        security: [{ bearerAuth: [] }],
        response: {
          204: {
            type: 'null',
            description: 'Notification preferences deleted (reset to defaults)',
          },
          404: {
            description: 'No notification preferences existed to delete',
            ...errorResponseSchema,
          },
        },
      },
    },
    async (request, reply) => {
      return notificationController.resetPreferences(request, reply);
    }
  );
}
