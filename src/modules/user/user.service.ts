import { User, Prisma } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError } from '../../shared/errors.js';
import { UserRepository } from './user.repository.js';
import { OAuthConnectionRepository } from '../auth/oauth/oauth-connection.repository.js';
import { KnowledgeBaseRepository } from '../knowledge-base/kb.repository.js';
import { NotificationPreferenceRepository } from '../notifications/notification.repository.js';
import { KafkaProducer, EventName } from '../../infrastructure/messaging/kafka.js';

export interface UserProfile {
  id: string;
  email: string;
  roles: string[];
  createdAt: Date;
  connectedProviders: Array<{
    provider: string;
    providerUserId: string;
    scopes: string[];
    connectedAt: Date;
  }>;
}

export interface UpdateUserData {
  roles?: 'CANDIDATE' | 'RECRUITER' | 'ADMIN';
}

export class UserService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly oauthConnRepo: OAuthConnectionRepository,
    private readonly kbRepo: KnowledgeBaseRepository,
    private readonly notificationPrefRepo: NotificationPreferenceRepository,
    private readonly kafkaProducer: KafkaProducer
  ) {}

  async getCurrentUser(userId: string): Promise<Result<UserProfile, NotFoundError>> {
    const userResult = await this.userRepo.findById(userId);
    if (userResult.isErr()) {
      return Result.err(new NotFoundError('User not found'));
    }

    const user = userResult.value;
    if (!user) {
      return Result.err(new NotFoundError('User not found'));
    }

    const oauthResult = await this.oauthConnRepo.findAllByUserId(userId);
    if (oauthResult.isErr()) {
      return Result.err(new NotFoundError('Failed to fetch OAuth connections'));
    }

    const connectedProviders = oauthResult.value.map((conn) => ({
      provider: conn.provider,
      providerUserId: conn.providerUserId,
      scopes: conn.scope,
      connectedAt: conn.createdAt,
    }));

    return Result.ok({
      id: user.id,
      email: user.email,
      roles: [user.roles],
      createdAt: user.createdAt,
      connectedProviders,
    });
  }

  async updateUser(userId: string, data: UpdateUserData): Promise<Result<User, NotFoundError>> {
    const updateData: Prisma.UserUpdateInput = {};
    if (data.roles) {
      updateData.roles = data.roles;
    }

    const result = await this.userRepo.update(userId, data);
    return result;
  }

  async deleteUser(userId: string): Promise<Result<void, NotFoundError>> {
    // Delete related records first (cascade should handle this, but being explicit)
    await this.oauthConnRepo.deleteByUserId(userId);
    await this.kbRepo.delete(userId);
    await this.notificationPrefRepo.delete(userId);

    const result = await this.userRepo.delete(userId);
    return result;
  }

  async submitProfileLinks(userId: string, linkedinUrl?: string, githubUrl?: string): Promise<Result<void, NotFoundError>> {
    const userResult = await this.userRepo.findById(userId);
    if (userResult.isErr() || !userResult.value) {
      return Result.err(new NotFoundError('User not found'));
    }

    // Save into database
    await this.userRepo.updateProfileUrls(userId, linkedinUrl, githubUrl);

    await this.kafkaProducer.publish(EventName.ProfileEnrichmentTriggered, {
      userId,
      provider: 'MANUAL',
      providerAccessToken: '',
      linkedinProfileUrl: linkedinUrl,
      githubProfileUrl: githubUrl,
    });

    return Result.ok(undefined);
  }
}