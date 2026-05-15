import * as jose from 'jose';
import { config } from '../../config/index.js';
import { Result } from '../../shared/result.js';
import { UnauthorizedError } from '../../shared/errors.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface JwtPayload {
  sub: string;
  roles?: string[];
  iat?: number;
  exp?: number;
  jti?: string;
}

export class JwtService {
  private accessTokenSecret: Uint8Array;
  private refreshTokenSecret: Uint8Array;

  constructor() {
    this.accessTokenSecret = secret;
    this.refreshTokenSecret = secret;
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

  async isRevoked(_jti: string): Promise<boolean> {
    // TODO: Implement Redis-based blocklist check
    return false;
  }

  async revokeToken(_jti: string): Promise<void> {
    // TODO: Implement Redis-based token revocation
  }
}