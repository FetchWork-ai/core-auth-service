import { PrismaClient, KnowledgeBase } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError } from '../../shared/errors.js';

export class KnowledgeBaseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<Result<KnowledgeBase | null, Error>> {
    try {
      const kb = await this.prisma.knowledgeBase.findUnique({
        where: { userId },
      });
      return Result.ok(kb);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async upsert(
    userId: string,
    data: {
      profileGraph: any;
      version: number;
      lastEnrichedAt: Date;
    }
  ): Promise<Result<KnowledgeBase, Error>> {
    try {
      const kb = await this.prisma.knowledgeBase.upsert({
        where: { userId },
        create: {
          userId,
          profileGraph: data.profileGraph,
          version: data.version,
          lastEnriched: data.lastEnrichedAt,
        },
        update: {
          profileGraph: data.profileGraph,
          version: data.version,
          lastEnriched: data.lastEnrichedAt,
        },
      });
      return Result.ok(kb);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async delete(userId: string): Promise<Result<void, NotFoundError>> {
    try {
      await this.prisma.knowledgeBase.delete({ where: { userId } });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(new NotFoundError('Knowledge base not found'));
    }
  }
}