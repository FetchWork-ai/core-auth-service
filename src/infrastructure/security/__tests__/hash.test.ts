import { describe, it, expect } from 'vitest';
import { HashService } from '../hash.js';

describe('HashService', () => {
  const hashService = new HashService();

  describe('hash()', () => {
    it('should return a valid Argon2id hash', async () => {
      const result = await hashService.hash('MySecureP@ss123');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toMatch(/^\$argon2id\$/);
      }
    });

    it('should produce different hashes for the same password (salted)', async () => {
      const result1 = await hashService.hash('SamePassword!');
      const result2 = await hashService.hash('SamePassword!');

      expect(result1.isOk()).toBe(true);
      expect(result2.isOk()).toBe(true);
      if (result1.isOk() && result2.isOk()) {
        expect(result1.value).not.toBe(result2.value);
      }
    });
  });

  describe('verify()', () => {
    it('should return true for a matching password', async () => {
      const password = 'CorrectHorse!Battery42';
      const hashResult = await hashService.hash(password);
      expect(hashResult.isOk()).toBe(true);

      if (hashResult.isOk()) {
        const verifyResult = await hashService.verify(password, hashResult.value);
        expect(verifyResult.isOk()).toBe(true);
        if (verifyResult.isOk()) {
          expect(verifyResult.value).toBe(true);
        }
      }
    });

    it('should return false for a wrong password', async () => {
      const hashResult = await hashService.hash('RightPassword!');
      expect(hashResult.isOk()).toBe(true);

      if (hashResult.isOk()) {
        const verifyResult = await hashService.verify('WrongPassword!', hashResult.value);
        expect(verifyResult.isOk()).toBe(true);
        if (verifyResult.isOk()) {
          expect(verifyResult.value).toBe(false);
        }
      }
    });
  });
});
