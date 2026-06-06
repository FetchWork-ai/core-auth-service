import { Result } from '../../shared/result.js';
import pino from 'pino';

export interface IEmailSender {
  sendVerificationEmail(email: string, code: string): Promise<Result<void, Error>>;
  sendPasswordResetEmail(email: string, code: string): Promise<Result<void, Error>>;
}

export class ConsoleEmailSender implements IEmailSender {
  constructor(private readonly logger: pino.Logger) {}

  async sendVerificationEmail(email: string, code: string): Promise<Result<void, Error>> {
    this.logger.info({ email, code }, '📧 [EMAIL VERIFICATION OTP] SENT');
    return Result.ok(undefined);
  }

  async sendPasswordResetEmail(email: string, code: string): Promise<Result<void, Error>> {
    this.logger.info({ email, code }, '📧 [PASSWORD RESET OTP] SENT');
    return Result.ok(undefined);
  }
}
