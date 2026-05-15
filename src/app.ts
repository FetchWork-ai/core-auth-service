import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
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
      }]
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

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/', async () => {
    return { message: 'Core Auth Service is running' };
  });

  // Placeholder for module registration
  // await app.register(authRoutes, { prefix: '/api/v1/auth' });
  // await app.register(userRoutes, { prefix: '/api/v1/users' });
  // await app.register(kbRoutes, { prefix: '/api/v1/users/me/kb' });

  return app;
}
