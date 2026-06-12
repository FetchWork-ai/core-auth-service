import { User, Prisma, UserRole, UserStatus } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError } from '../../shared/errors.js';
import { UserRepository } from '../user/user.repository.js';
import { UserService, UserProfile } from '../user/user.service.js';

export interface AdminListUsersOptions {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface AdminUpdateUserData {
  roles?: UserRole;
  status?: UserStatus;
}

export class AdminService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly userService: UserService
  ) {}

  async listUsers(options: AdminListUsersOptions): Promise<Result<PaginatedResult<User>, Error>> {
    const page = options.page && options.page > 0 ? options.page : 1;
    const limit = options.limit && options.limit > 0 ? options.limit : 10;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};
    if (options.role) {
      where.roles = options.role;
    }
    if (options.status) {
      where.status = options.status;
    }
    if (options.search) {
      where.email = { contains: options.search, mode: 'insensitive' };
    }

    const [usersResult, countResult] = await Promise.all([
      this.userRepo.findMany({ skip, take: limit, where, orderBy: { createdAt: 'desc' } }),
      this.userRepo.count(where),
    ]);

    if (usersResult.isErr()) return Result.err(usersResult.error);
    if (countResult.isErr()) return Result.err(countResult.error);

    const total = countResult.value;

    return Result.ok({
      data: usersResult.value,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  async getUserDetails(userId: string): Promise<Result<UserProfile, NotFoundError>> {
    // We can reuse the UserService method which already fetches OAuth connections
    return this.userService.getCurrentUser(userId);
  }

  async updateUser(userId: string, data: AdminUpdateUserData): Promise<Result<User, NotFoundError | Error>> {
    let updatedUser: User | null = null;

    if (data.roles) {
      const roleResult = await this.userRepo.update(userId, { roles: data.roles });
      if (roleResult.isErr()) return Result.err(roleResult.error);
      updatedUser = roleResult.value;
    }

    if (data.status) {
      const statusResult = await this.userRepo.updateStatus(userId, data.status);
      if (statusResult.isErr()) return Result.err(statusResult.error);
      updatedUser = statusResult.value;
    }

    if (!updatedUser) {
      // If no updates were provided, just fetch the user
      const userResult = await this.userRepo.findById(userId);
      if (userResult.isErr()) return Result.err(userResult.error);
      if (!userResult.value) return Result.err(new NotFoundError('User not found'));
      updatedUser = userResult.value;
    }

    return Result.ok(updatedUser);
  }

  async deleteUser(userId: string): Promise<Result<void, NotFoundError>> {
    return this.userService.deleteUser(userId);
  }

  async getSystemStats(): Promise<Result<any, Error>> {
    return this.userRepo.getStats();
  }
}
