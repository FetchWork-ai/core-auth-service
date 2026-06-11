import { describe, it, expect } from 'vitest';
import { OtpService } from '../otp.js';

describe('OtpService', () => {
  const otpService = new OtpService();

  describe('generate()', () => {
    it('should produce a 6-digit numeric code', () => {
      const otp = otpService.generate('test@example.com');

      expect(otp.code).toMatch(/^\d{6}$/);
    });

    it('should produce a non-empty codeHash', () => {
      const otp = otpService.generate('test@example.com');

      expect(otp.codeHash).toBeDefined();
      expect(otp.codeHash.length).toBeGreaterThan(0);
    });

    it('should set expiry approximately 10 minutes in the future', () => {
      const before = Date.now();
      const otp = otpService.generate('test@example.com');
      const after = Date.now();

      const tenMinutesMs = 10 * 60 * 1000;
      // Allow 2 second tolerance
      expect(otp.expiresAt.getTime()).toBeGreaterThanOrEqual(before + tenMinutesMs - 2000);
      expect(otp.expiresAt.getTime()).toBeLessThanOrEqual(after + tenMinutesMs + 2000);
    });

    it('should produce different codes on successive calls', () => {
      const codes = new Set<string>();
      // Generate 10 OTPs and check uniqueness (probabilistic but very reliable)
      for (let i = 0; i < 10; i++) {
        codes.add(otpService.generate(`test${i}@example.com`).code);
      }
      // Extremely unlikely all 10 are the same
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('hashOtp()', () => {
    it('should produce a deterministic HMAC-SHA256 hash', () => {
      const hash1 = otpService.hashOtp('123456', 'user@example.com');
      const hash2 = otpService.hashOtp('123456', 'user@example.com');

      expect(hash1).toBe(hash2);
    });

    it('should produce a 64-character hex string', () => {
      const hash = otpService.hashOtp('123456', 'user@example.com');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return different hashes for different codes', () => {
      const hash1 = otpService.hashOtp('123456', 'user@example.com');
      const hash2 = otpService.hashOtp('654321', 'user@example.com');

      expect(hash1).not.toBe(hash2);
    });

    it('should return different hashes for different emails', () => {
      const hash1 = otpService.hashOtp('123456', 'alice@example.com');
      const hash2 = otpService.hashOtp('123456', 'bob@example.com');

      expect(hash1).not.toBe(hash2);
    });
  });
});
