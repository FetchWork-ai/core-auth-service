import { PrismaClient, User, UserStatus } from '@prisma/client';
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

  async updatePassword(id: string, passwordHash: string): Promise<Result<User, NotFoundError>> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: { passwordHash },
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
}