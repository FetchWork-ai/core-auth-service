import * as jose from 'jose';
import Redis from 'ioredis';
import { config } from '../../config/index.js';
import { Result } from '../../shared/result.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface JwtPayload {
  sub: string;
  roles?: string[];
  iat?: number;
  exp?: number;
  jti?: string;
}

/**
 * True when a token predates the user's token epoch (bumped on password reset).
 *
 * `iat` is whole seconds, so the epoch is floored to the same resolution — a token
 * minted in the same second as the bump is kept rather than spuriously rejected.
 */
export function isIssuedBeforeEpoch(
  payload: JwtPayload,
  tokensValidFrom: Date | null | undefined
): boolean {
  if (!tokensValidFrom) return false;
  if (payload.iat === undefined) return true; // unstamped token can't be placed — reject
  return payload.iat < Math.floor(tokensValidFrom.getTime() / 1000);
}

export class JwtService {
  private accessTokenSecret: Uint8Array;
  private refreshTokenSecret: Uint8Array;
  private redisClient: Redis | null = null;
  private fallbackBlocklist = new Set<string>();

  constructor() {
    this.accessTokenSecret = secret;
    this.refreshTokenSecret = secret;

    if (config.REDIS_URL) {
      this.redisClient = new Redis(config.REDIS_URL);
      this.redisClient.on('error', (err) => logger.error({ err }, 'Redis blocklist connection error'));
      logger.info('Redis connected for JWT blocklist');
    } else {
      logger.warn('REDIS_URL not set. Using in-memory fallback blocklist for JWTs. NOT RECOMMENDED FOR PRODUCTION.');
    }
  }

  async signAccess(payload: Omit<JwtPayload, 'jti'>): Promise<string> {
    const jti = crypto.randomUUID();
    return new jose.SignJWT({ ...payload, jti })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .setJti(jti)
      .sign(this.accessTokenSecret);
  }

  async signRefresh(payload: Omit<JwtPayload, 'jti' | 'roles'>): Promise<string> {
    const jti = crypto.randomUUID();
    return new jose.SignJWT({ ...payload, jti })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .setJti(jti)
      .sign(this.refreshTokenSecret);
  }

  async verifyAccess(token: string): Promise<Result<JwtPayload, UnauthorizedError>> {
    try {
      const { payload } = await jose.jwtVerify(token, this.accessTokenSecret);
      return Result.ok(payload as JwtPayload);
    } catch (error) {
      return Result.err(new UnauthorizedError('Invalid or expired token'));
    }
  }

  async verifyRefresh(token: string): Promise<Result<JwtPayload, UnauthorizedError>> {
    try {
      const { payload } = await jose.jwtVerify(token, this.refreshTokenSecret);
      return Result.ok(payload as JwtPayload);
    } catch (error) {
      return Result.err(new UnauthorizedError('Invalid or expired refresh token'));
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (this.redisClient) {
      const exists = await this.redisClient.exists(`bl_${jti}`);
      return exists === 1;
    }
    return this.fallbackBlocklist.has(jti);
  }

  async revokeToken(jti: string, expiresInSeconds: number): Promise<void> {
    if (this.redisClient) {
      // Set key with expiry so it auto-cleans up from Redis
      await this.redisClient.set(`bl_${jti}`, '1', 'EX', Math.max(1, expiresInSeconds));
    } else {
      this.fallbackBlocklist.add(jti);
      // In-memory cleanup to avoid unbounded memory leak in dev
      setTimeout(() => this.fallbackBlocklist.delete(jti), expiresInSeconds * 1000).unref();
    }
  }
}