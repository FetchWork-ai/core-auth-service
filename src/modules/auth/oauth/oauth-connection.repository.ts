import { PrismaClient, OAuthConnection } from '@prisma/client';
import { Result } from '../../../shared/result.js';

export class OAuthConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByProviderAndUserId(
    provider: string,
    userId: string
  ): Promise<Result<OAuthConnection | null, Error>> {
    try {
      const connection = await this.prisma.oAuthConnection.findUnique({
        where: {
          userId_provider: {
            userId,
            provider: provider as any,
          },
        },
      });
      return Result.ok(connection);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async upsertConnection(data: {
    userId: string;
    provider: string;
    providerUserId: string;
    encryptedToken: string;
    scope: string[];
    expiresAt?: Date | null;
  }): Promise<Result<OAuthConnection, Error>> {
    try {
      const connection = await this.prisma.oAuthConnection.upsert({
        where: {
          userId_provider: {
            userId: data.userId,
            provider: data.provider as any,
          },
        },
        create: {
          userId: data.userId,
          provider: data.provider as any,
          providerUserId: data.providerUserId,
          encryptedToken: data.encryptedToken,
          scope: data.scope,
          expiresAt: data.expiresAt ?? null,
        },
        update: {
          providerUserId: data.providerUserId,
          encryptedToken: data.encryptedToken,
          scope: data.scope,
          expiresAt: data.expiresAt ?? null,
        },
      });
      return Result.ok(connection);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async findAllByUserId(userId: string): Promise<Result<OAuthConnection[], Error>> {
    try {
      const connections = await this.prisma.oAuthConnection.findMany({
        where: { userId },
      });
      return Result.ok(connections);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async deleteByUserId(userId: string): Promise<Result<void, Error>> {
    try {
      await this.prisma.oAuthConnection.deleteMany({ where: { userId } });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error as Error);
    }
  }
}