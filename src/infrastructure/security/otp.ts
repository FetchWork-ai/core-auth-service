import crypto from 'crypto';

export interface GeneratedOtp {
  code: string;       // Plaintext (to be sent via email)
  codeHash: string;   // Hashed version (to be saved in DB)
  expiresAt: Date;
}

export class OtpService {
  private readonly EXPIRY_MINUTES = 10;
  private readonly SALT_SECRET: string;

  constructor() {
    this.SALT_SECRET = process.env.OTP_SALT_SECRET ?? 'fallback-otp-salt';
  }

  generate(email: string): GeneratedOtp {
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.EXPIRY_MINUTES);

    const codeHash = this.hashOtp(code, email);

    return { code, codeHash, expiresAt };
  }

  hashOtp(code: string, email: string): string {
    return crypto
      .createHmac('sha256', this.SALT_SECRET)
      .update(`${code}:${email}`)
      .digest('hex');
  }
}
