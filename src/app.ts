import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { config } from './config';
import { prisma } from './infrastructure/db/prisma.js';
import { JwtService } from './infrastructure/security/jwt.js';
import { UserRepository } from './modules/user/user.repository.js';
import { UserService } from './modules/user/user.service.js';
import { UserController } from './modules/user/user.controller.js';
import { userRoutes } from './modules/user/user.routes.js';
import { OAuthConnectionRepository } from './modules/auth/oauth/oauth-connection.repository.js';
import { KnowledgeBaseRepository } from './modules/knowledge-base/kb.repository.js';
import { NotificationPreferenceRepository } from './modules/notifications/notification.repository.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Core Auth Service API',
        description: 'API documentation for Core Auth Service',
        version: '1.0.0'
      },
      servers: [{
        url: 'http://localhost:8080'
      }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      }
    }
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'full',
      deepLinking: false
    },
    staticCSP: true,
    transformStaticCSP: (header) => header
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  app.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['System'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' }
          }
        }
      }
    }
  }, async () => {
    return { status: 'ok' };
  });

  app.get('/', {
    schema: {
      description: 'Root endpoint',
      tags: ['System'],
      response: {
        200: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          }
        }
      }
    }
  }, async () => {
    return { message: 'Core Auth Service is running' };
  });

  // Initialize repositories
  const userRepository = new UserRepository(prisma);
  const oauthConnectionRepository = new OAuthConnectionRepository(prisma);
  const knowledgeBaseRepository = new KnowledgeBaseRepository(prisma);
  const notificationPreferenceRepository = new NotificationPreferenceRepository(prisma);

  // Initialize services
  const userService = new UserService(
    userRepository,
    oauthConnectionRepository,
    knowledgeBaseRepository,
    notificationPreferenceRepository
  );

  // Initialize controllers
  const userController = new UserController(userService);

  // Initialize JWT service
  const jwtService = new JwtService();

  // Register routes
  await app.register(userRoutes, {
    prefix: '/api/v1',
    userController: new UserController(userService),
    jwtService,
    userRepository,
  });

  // Placeholder for other modules
  // await app.register(authRoutes, { prefix: '/api/v1/auth' });
  // await app.register(kbRoutes, { prefix: '/api/v1/users/me/kb' });

  return app;
}
