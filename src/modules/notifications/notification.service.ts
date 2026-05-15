import { Result } from '../../shared/result.js';

export class NotificationService {
  async getPreferences(_userId: string): Promise<Result<any, Error>> {
    return Result.err(new Error('Not implemented'));
  }

  async updatePreferences(_userId: string, _data: any): Promise<Result<any, Error>> {
    return Result.err(new Error('Not implemented'));
  }
}