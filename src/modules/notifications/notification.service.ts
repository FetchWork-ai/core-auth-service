import { NotificationPreference } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError } from '../../shared/errors.js';
import { NotificationPreferenceRepository, NotificationPreferenceData } from './notification.repository.js';

export interface NotificationPreferenceResponse {
  id: string;
  userId: string;
  digestFrequency: string;
  minMatchScore: number;
  notifyOnNewJobs: boolean;
  notifyOnStatusChange: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  channels: string[];
  createdAt: string;
  updatedAt: string;
}

export class NotificationService {
  constructor(private readonly notifRepo: NotificationPreferenceRepository) {}

  // ── Get Preferences ──────────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<Result<NotificationPreferenceResponse, NotFoundError>> {
    const result = await this.notifRepo.findByUserId(userId);
    if (result.isErr()) {
      return Result.err(new NotFoundError('Notification preferences not found'));
    }

    const prefs = result.value;
    if (!prefs) {
      return Result.err(new NotFoundError('Notification preferences not found'));
    }

    return Result.ok(this.serialize(prefs));
  }

  // ── Update (Upsert) Preferences ──────────────────────────────────────────

  async updatePreferences(
    userId: string,
    data: NotificationPreferenceData
  ): Promise<Result<NotificationPreferenceResponse, Error>> {
    const result = await this.notifRepo.upsert(userId, data);
    if (result.isErr()) {
      return Result.err(result.error);
    }

    return Result.ok(this.serialize(result.value));
  }

  // ── Reset Preferences (Delete) ───────────────────────────────────────────

  async resetPreferences(userId: string): Promise<Result<void, NotFoundError>> {
    return this.notifRepo.delete(userId);
  }

  // ── Serialization ────────────────────────────────────────────────────────

  private serialize(prefs: NotificationPreference): NotificationPreferenceResponse {
    return {
      id: prefs.id,
      userId: prefs.userId,
      digestFrequency: prefs.digestFrequency,
      minMatchScore: Number(prefs.minMatchScore),
      notifyOnNewJobs: prefs.notifyOnNewJobs,
      notifyOnStatusChange: prefs.notifyOnStatusChange,
      quietHoursStart: prefs.quietHoursStart,
      quietHoursEnd: prefs.quietHoursEnd,
      channels: prefs.channels as string[],
      createdAt: prefs.createdAt.toISOString(),
      updatedAt: prefs.updatedAt.toISOString(),
    };
  }
}