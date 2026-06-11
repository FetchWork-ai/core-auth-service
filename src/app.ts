import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { config } from './config';
import { prisma } from './infrastructure/db/prisma.js';
import { JwtService } from './infrastructure/security/jwt.js';
import { HashService } from './infrastructure/security/hash.js';
import { OtpService } from './infrastructure/security/otp.js';
import { UserRepository } from './modules/user/user.repository.js';
import { UserService } from './modules/user/user.service.js';
import { UserController } from './modules/user/user.controller.js';
import { userRoutes } from './modules/user/user.routes.js';
import { OAuthConnectionRepository } from './modules/auth/oauth/oauth-connection.repository.js';
import { OtpRepository } from './modules/auth/otp/otp.repository.js';
import { KnowledgeBaseRepository } from './modules/knowledge-base/kb.repository.js';
import { NotificationPreferenceRepository } from './modules/notifications/notification.repository.js';
import { EncryptionService } from './infrastructure/security/encryption.js';
import { KafkaProducer } from './infrastructure/messaging/kafka.js';
import { ConsoleEmailSender, SmtpEmailSender } from './infrastructure/email/email.service.js';
import { IOAuthProvider } from './modules/auth/oauth/oauth-provider.interface.js';
import { GitHubProvider } from './modules/auth/oauth/github.provider.js';
import { LinkedInProvider } from './modules/auth/oauth/linkedin.provider.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { KnowledgeBaseService } from './modules/knowledge-base/kb.service.js';
import { KnowledgeBaseController } from './modules/knowledge-base/kb.controller.js';
import { kbRoutes } from './modules/knowledge-base/kb.routes.js';
import { logger } from './shared/logger.js';

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
        description: 'API documentation for Core Auth Service — supports OAuth (GitHub, LinkedIn) and Email/Password with OTP verification.',
        version: '1.0.0'
      },
      servers: [{
        url: 'http://localhost:8080'
      }],
      tags: [
        { name: 'System', description: 'Health check and system endpoints' },
        { name: 'Authentication - Email/Password', description: 'Email/password registration, sign-in, and OTP verification' },
        { name: 'Authentication - OAuth', description: 'OAuth provider authentication (GitHub, LinkedIn)' },
        { name: 'Authentication - Token Management', description: 'JWT token refresh and management' },
        { name: 'Users', description: 'User profile management' },
      ],
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
    staticCSP: false
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
  const otpRepository = new OtpRepository(prisma);

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

  // Initialize Auth Service dependencies
  const encryptionService = new EncryptionService();
  const kafkaProducer = new KafkaProducer();
  const hashService = new HashService();
  const otpService = new OtpService();
  
  let emailSender;
  if (
    config.SMTP_HOST &&
    config.SMTP_PORT &&
    config.SMTP_USER &&
    config.SMTP_PASS &&
    config.SMTP_FROM
  ) {
    emailSender = new SmtpEmailSender(logger, {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
      from: config.SMTP_FROM,
    });
  } else {
    emailSender = new ConsoleEmailSender(logger);
  }
  
  const providers = new Map<string, IOAuthProvider>();
  providers.set('GITHUB', new GitHubProvider());
  providers.set('LINKEDIN', new LinkedInProvider());

  const authService = new AuthService(
    providers,
    userRepository,
    oauthConnectionRepository,
    encryptionService,
    jwtService,
    kafkaProducer,
    hashService,
    otpService,
    emailSender,
    otpRepository
  );
  
  const authController = new AuthController(authService);

  // Register routes
  await app.register(userRoutes, {
    prefix: '/api/v1',
    userController: new UserController(userService),
    jwtService,
    userRepository,
  });

  await app.register(authRoutes, { 
    prefix: '/api/v1/auth',
    authController 
  });
  
  // Knowledge Base module
  const knowledgeBaseService = new KnowledgeBaseService(knowledgeBaseRepository);
  const kbController = new KnowledgeBaseController(knowledgeBaseService);

  await app.register(kbRoutes, {
    prefix: '/api/v1/users/me/kb',
    kbController,
    jwtService,
    userRepository,
  });

  return app;
}
