import { PrismaClient, User, UserStatus, Prisma } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError, ConflictError } from '../../shared/errors.js';

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Result<User | null, Error>> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id } });
      return Result.ok(user);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async findByEmail(email: string): Promise<Result<User | null, Error>> {
    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      return Result.ok(user);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async createWithPassword(data: {
    email: string;
    passwordHash: string;
    defaultRole?: 'CANDIDATE' | 'RECRUITER' | 'ADMIN';
  }): Promise<Result<User, ConflictError | Error>> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: data.email,
          passwordHash: data.passwordHash,
          status: 'PENDING_VERIFICATION',
          roles: data.defaultRole ?? 'CANDIDATE',
        },
      });
      return Result.ok(user);
    } catch (error: any) {
      // Prisma unique constraint violation
      if (error?.code === 'P2002') {
        return Result.err(new ConflictError('A user with this email already exists'));
      }
      return Result.err(error as Error);
    }
  }

  async upsertByEmail(data: {
    email: string;
    defaultRole?: 'CANDIDATE' | 'RECRUITER' | 'ADMIN';
  }): Promise<Result<User, Error>> {
    try {
      const user = await this.prisma.user.upsert({
        where: { email: data.email },
        create: {
          email: data.email,
          status: 'ACTIVE',
          roles: data.defaultRole ?? 'CANDIDATE',
        },
        update: {},
      });
      return Result.ok(user);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async updateStatus(id: string, status: UserStatus): Promise<Result<User, NotFoundError>> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: { status },
      });
      return Result.ok(user);
    } catch (error) {
      return Result.err(new NotFoundError('User not found'));
    }
  }

  async update(id: string, data: Partial<Pick<User, 'roles'>>): Promise<Result<User, NotFoundError>> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data,
      });
      return Result.ok(user);
    } catch (error) {
      return Result.err(new NotFoundError('User not found'));
    }
  }

  async updateProfileUrls(id: string, linkedinProfileUrl?: string, githubProfileUrl?: string): Promise<Result<User, NotFoundError>> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: { linkedinProfileUrl, githubProfileUrl },
      });
      return Result.ok(user);
    } catch (error) {
      return Result.err(new NotFoundError('User not found'));
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<Result<User, NotFoundError>> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        // Bumping the token epoch alongside the hash is what makes a reset actually
        // end existing sessions — every token issued before this instant stops verifying.
        data: { passwordHash, tokensValidFrom: new Date() },
      });
      return Result.ok(user);
    } catch (error) {
      return Result.err(new NotFoundError('User not found'));
    }
  }

  async delete(id: string): Promise<Result<void, NotFoundError>> {
    try {
      await this.prisma.user.delete({ where: { id } });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(new NotFoundError('User not found'));
    }
  }

  async findMany(params: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<Result<User[], Error>> {
    try {
      const users = await this.prisma.user.findMany({
        skip: params.skip,
        take: params.take,
        where: params.where,
        orderBy: params.orderBy,
      });
      return Result.ok(users);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async count(where?: Prisma.UserWhereInput): Promise<Result<number, Error>> {
    try {
      const count = await this.prisma.user.count({ where });
      return Result.ok(count);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async getStats(): Promise<Result<any, Error>> {
    try {
      const [totalUsers, statusCounts, roleCounts] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.groupBy({
          by: ['status'],
          _count: { status: true },
        }),
        this.prisma.user.groupBy({
          by: ['roles'],
          _count: { roles: true },
        }),
      ]);

      return Result.ok({
        totalUsers,
        statusCounts: statusCounts.reduce((acc, curr) => {
          acc[curr.status] = curr._count.status;
          return acc;
        }, {} as Record<string, number>),
        roleCounts: roleCounts.reduce((acc, curr) => {
          acc[curr.roles] = curr._count.roles;
          return acc;
        }, {} as Record<string, number>),
      });
    } catch (error) {
      return Result.err(error as Error);
    }
  }
}