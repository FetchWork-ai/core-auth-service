import { Result } from '../../shared/result.js';
import pino from 'pino';
import nodemailer from 'nodemailer';

export interface IEmailSender {
  sendVerificationEmail(email: string, code: string): Promise<Result<void, Error>>;
  sendPasswordResetEmail(email: string, code: string): Promise<Result<void, Error>>;
  /**
   * Sent when someone tries to register an email that already has an account.
   * Signup answers 201 either way, so this is what tells the real owner what happened.
   */
  sendExistingAccountNotice(email: string): Promise<Result<void, Error>>;
}

export class ConsoleEmailSender implements IEmailSender {
  constructor(private readonly logger: pino.Logger) {}

  async sendVerificationEmail(email: string, _code: string): Promise<Result<void, Error>> {
    this.logger.info({ recipient: this.maskEmail(email) }, '📧 [EMAIL VERIFICATION OTP] SENT');
    return Result.ok(undefined);
  }

  async sendPasswordResetEmail(email: string, _code: string): Promise<Result<void, Error>> {
    this.logger.info({ recipient: this.maskEmail(email) }, '📧 [PASSWORD RESET OTP] SENT');
    return Result.ok(undefined);
  }

  async sendExistingAccountNotice(email: string): Promise<Result<void, Error>> {
    this.logger.info({ recipient: this.maskEmail(email) }, '📧 [EXISTING ACCOUNT NOTICE] SENT');
    return Result.ok(undefined);
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}***@${domain}`;
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
      this.logger.info({ recipient: this.maskEmail(email) }, 'Sending verification email via SMTP');
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Verify your email address',
        text: `Your verification code is: ${code}. It expires in 10 minutes.`,
        html: `<p>Your verification code is: <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      });
      return Result.ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, recipient: this.maskEmail(email) }, 'Failed to send verification email via SMTP');
      return Result.err(error as Error);
    }
  }

  async sendPasswordResetEmail(email: string, code: string): Promise<Result<void, Error>> {
    try {
      this.logger.info({ recipient: this.maskEmail(email) }, 'Sending password reset email via SMTP');
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Reset your password',
        text: `Your password reset code is: ${code}. It expires in 10 minutes.`,
        html: `<p>Your password reset code is: <strong>${code}</strong>. It expires in 10 minutes.</p>`,
      });
      return Result.ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, recipient: this.maskEmail(email) }, 'Failed to send password reset email via SMTP');
      return Result.err(error as Error);
    }
  }

  async sendExistingAccountNotice(email: string): Promise<Result<void, Error>> {
    try {
      this.logger.info({ recipient: this.maskEmail(email) }, 'Sending existing-account notice via SMTP');
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'You already have an account',
        text:
          'Someone tried to register an account with this email address, but one already exists. ' +
          'If that was you, sign in instead — or reset your password if you have forgotten it. ' +
          'If it was not you, no action is needed; your account is unchanged.',
        html:
          '<p>Someone tried to register an account with this email address, but one already exists.</p>' +
          '<p>If that was you, sign in instead — or reset your password if you have forgotten it.</p>' +
          '<p>If it was not you, no action is needed; your account is unchanged.</p>',
      });
      return Result.ok(undefined);
    } catch (error) {
      this.logger.error({ err: error, recipient: this.maskEmail(email) }, 'Failed to send existing-account notice via SMTP');
      return Result.err(error as Error);
    }
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return '***';
    return `${local[0]}***@${domain}`;
  }
}
