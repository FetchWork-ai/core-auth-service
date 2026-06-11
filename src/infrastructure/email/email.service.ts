import { Result } from '../../shared/result.js';
import pino from 'pino';
import nodemailer from 'nodemailer';

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

export class SmtpEmailSender implements IEmailSender {
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(
    private readonly logger: pino.Logger,
    options: {
      host: string;
      port: number;
      user: string;
      pass: string;
      from: string;
    }
  ) {
    this.from = options.from;
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465, // true for port 465, false for other ports
      auth: {
        user: options.user,
        pass: options.pass,
      },
    });
  }

  async sendVerificationEmail(email: string, code: string): Promise<Result<void, Error>> {
    try {
      this.logger.info({ email }, 'Sending verification email via SMTP');
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Verify your email address',
        text: `Your verification code is: ${code}. It expires in 10 minutes.`,
        html: `<p>Your verification code is: <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      });
      return Result.ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, email }, 'Failed to send verification email via SMTP');
      return Result.err(error as Error);
    }
  }

  async sendPasswordResetEmail(email: string, code: string): Promise<Result<void, Error>> {
    try {
      this.logger.info({ email }, 'Sending password reset email via SMTP');
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Reset your password',
        text: `Your password reset code is: ${code}. It expires in 10 minutes.`,
        html: `<p>Your password reset code is: <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      });
      return Result.ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, email }, 'Failed to send password reset email via SMTP');
      return Result.err(error as Error);
    }
  }
}
