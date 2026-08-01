import crypto from 'crypto';

export interface GeneratedOtp {
  code: string;       // Plaintext (to be sent via email)
  codeHash: string;   // Hashed version (to be saved in DB)
  expiresAt: Date;
}

export class OtpService {
  private readonly EXPIRY_MINUTES = 10;
  private readonly SALT_SECRET: string;

  // The salt must be injected — never defaulted. A fallback value would make every
  // OTP hash forgeable from public source if the secret were missing in production.
  constructor(saltSecret: string) {
    if (!saltSecret || saltSecret.length < 16) {
      throw new Error('OtpService requires a salt secret of at least 16 characters');
    }
    this.SALT_SECRET = saltSecret;
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
