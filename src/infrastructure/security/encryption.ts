import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Result } from '../../shared/result.js';
import { DomainError } from '../../shared/errors.js';
import { config } from '../../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class EncryptionError extends DomainError {
  constructor(message: string) {
    super(message, 'ENCRYPTION_ERROR');
  }
}

export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    // In production, fetch from KMS/Vault. For now, derive from env or use a default.
    const keyHex = config.ENCRYPTION_KEY;
    this.key = Buffer.from(keyHex.padEnd(32, '0').slice(0, 32));
  }

  async encrypt(plaintext: string): Promise<Result<string, EncryptionError>> {
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.key, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      const authTag = cipher.getAuthTag();

      // Format: base64(iv):base64(ciphertext):base64(authTag)
      return Result.ok(`${iv.toString('base64')}:${encrypted}:${authTag.toString('base64')}`);
    } catch (error) {
      return Result.err(new EncryptionError('Failed to encrypt data'));
    }
  }

  async decrypt(envelope: string): Promise<Result<string, EncryptionError>> {
    try {
      const [ivBase64, ciphertext, authTagBase64] = envelope.split(':');

      if (!ivBase64 || !ciphertext || !authTagBase64) {
        return Result.err(new EncryptionError('Invalid envelope format'));
      }

      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');

      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return Result.ok(decrypted);
    } catch (error) {
      return Result.err(new EncryptionError('Failed to decrypt data'));
    }
  }
}