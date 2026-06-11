import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
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
    // Derive a 256-bit key from the env secret using SHA-256
    // In production, fetch from KMS/Vault instead.
    const keyMaterial = config.ENCRYPTION_KEY;
    this.key = createHash('sha256').update(keyMaterial).digest();
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