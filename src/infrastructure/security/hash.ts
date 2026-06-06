import argon2 from 'argon2';
import { Result } from '../../shared/result.js';

export class HashService {
  async hash(password: string): Promise<Result<string, Error>> {
    try {
      const hashed = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });
      return Result.ok(hashed);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  async verify(password: string, hash: string): Promise<Result<boolean, Error>> {
    try {
      const isValid = await argon2.verify(hash, password);
      return Result.ok(isValid);
    } catch (error) {
      return Result.err(error as Error);
    }
  }
}
