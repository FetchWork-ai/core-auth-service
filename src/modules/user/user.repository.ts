import { PrismaClient, User } from '@prisma/client';
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

  async upsertByEmail(data: {
    email: string;
    defaultRole?: 'CANDIDATE' | 'RECRUITER' | 'ADMIN';
  }): Promise<Result<User, Error>> {
    try {
      const user = await this.prisma.user.upsert({
        where: { email: data.email },
        create: {
          email: data.email,
          roles: data.defaultRole ?? 'CANDIDATE',
        },
        update: {},
      });
      return Result.ok(user);
    } catch (error) {
      return Result.err(error as Error);
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

  async delete(id: string): Promise<Result<void, NotFoundError>> {
    try {
      await this.prisma.user.delete({ where: { id } });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(new NotFoundError('User not found'));
    }
  }
}