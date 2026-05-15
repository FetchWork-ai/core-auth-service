import { asClass, asValue, createContainer } from 'awilix';
import { prisma } from '../infrastructure/db/prisma.js';
import { logger } from '../shared/logger.js';
import { config } from './index.js';

// Import infrastructure services (to be implemented)
import { JwtService } from '../infrastructure/security/jwt.js';
import { EncryptionService } from '../infrastructure/security/encryption.js';
import { KafkaProducer } from '../infrastructure/messaging/kafka.js';

// Import repositories (to be implemented)
import { UserRepository } from '../modules/user/user.repository.js';
import { OAuthConnectionRepository } from '../modules/auth/oauth/oauth-connection.repository.js';
import { KnowledgeBaseRepository } from '../modules/knowledge-base/kb.repository.js';
import { NotificationPreferenceRepository } from '../modules/notifications/notification.repository.js';

// Import services (to be implemented)
import { AuthService } from '../modules/auth/auth.service.js';
import { UserService } from '../modules/user/user.service.js';
import { KnowledgeBaseService } from '../modules/knowledge-base/kb.service.js';
import { NotificationService } from '../modules/notifications/notification.service.js';

export interface AppDependencies {
  // Infrastructure
  prisma: typeof prisma;
  logger: typeof logger;
  config: typeof config;

  // Security
  jwtService: JwtService;
  encryptionService: EncryptionService;

  // Messaging
  kafkaProducer: KafkaProducer;

  // Repositories
  userRepository: UserRepository;
  oauthConnectionRepository: OAuthConnectionRepository;
  knowledgeBaseRepository: KnowledgeBaseRepository;
  notificationPreferenceRepository: NotificationPreferenceRepository;

  // Services
  authService: AuthService;
  userService: UserService;
  knowledgeBaseService: KnowledgeBaseService;
  notificationService: NotificationService;
}

export const container = createContainer<AppDependencies>({
  injectionMode: 'CLASSIC',
});

export function registerDependencies() {
  // Infrastructure
  container.register({
    prisma: asValue(prisma),
    logger: asValue(logger),
    config: asValue(config),
  });

  // Security services (placeholder registrations - will be replaced when implemented)
  container.register({
    jwtService: asClass(JwtService).singleton(),
    encryptionService: asClass(EncryptionService).singleton(),
  });

  // Messaging
  container.register({
    kafkaProducer: asClass(KafkaProducer).singleton(),
  });

  // Repositories
  container.register({
    userRepository: asClass(UserRepository),
    oauthConnectionRepository: asClass(OAuthConnectionRepository),
    knowledgeBaseRepository: asClass(KnowledgeBaseRepository),
    notificationPreferenceRepository: asClass(NotificationPreferenceRepository),
  });

  // Services
  container.register({
    authService: asClass(AuthService),
    userService: asClass(UserService),
    knowledgeBaseService: asClass(KnowledgeBaseService),
    notificationService: asClass(NotificationService),
  });

  return container;
}