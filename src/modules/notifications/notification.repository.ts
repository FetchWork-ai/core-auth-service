import { PrismaClient, NotificationPreference } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError } from '../../shared/errors.js';

export interface NotificationPreferenceData {
  digestFrequency?: string;
  minMatchScore?: number;
  notifyOnNewJobs?: boolean;
  notifyOnStatusChange?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  channels?: string[];
}

export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<Result<NotificationPreference | null, Error>> {
    try {
      const prefs = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });
      return Result.ok(prefs);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async upsert(
    userId: string,
    data: NotificationPreferenceData
  ): Promise<Result<NotificationPreference, Error>> {
    try {
      const prefs = await this.prisma.notificationPreference.upsert({
        where: { userId },
        create: {
          userId,
          digestFrequency: (data.digestFrequency as any) ?? 'DAILY',
          minMatchScore: data.minMatchScore ? data.minMatchScore : 0.7,
          notifyOnNewJobs: data.notifyOnNewJobs ?? true,
          notifyOnStatusChange: data.notifyOnStatusChange ?? false,
          quietHoursStart: data.quietHoursStart ?? null,
          quietHoursEnd: data.quietHoursEnd ?? null,
          channels: data.channels ?? [],
        },
        update: {
          ...(data.digestFrequency && { digestFrequency: data.digestFrequency as any }),
          ...(data.minMatchScore !== undefined && { minMatchScore: data.minMatchScore }),
          ...(data.notifyOnNewJobs !== undefined && { notifyOnNewJobs: data.notifyOnNewJobs }),
          ...(data.notifyOnStatusChange !== undefined && { notifyOnStatusChange: data.notifyOnStatusChange }),
          ...(data.quietHoursStart !== undefined && { quietHoursStart: data.quietHoursStart }),
          ...(data.quietHoursEnd !== undefined && { quietHoursEnd: data.quietHoursEnd }),
          ...(data.channels !== undefined && { channels: data.channels }),
        },
      });
      return Result.ok(prefs);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async delete(userId: string): Promise<Result<void, NotFoundError>> {
    try {
      await this.prisma.notificationPreference.delete({ where: { userId } });
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(new NotFoundError('Notification preferences not found'));
    }
  }
}