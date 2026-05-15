import { Result } from '../../shared/result.js';
import { UserRepository } from '../user/user.repository.js';
import { OAuthConnectionRepository } from './oauth/oauth-connection.repository.js';
import { EncryptionService } from '../../infrastructure/security/encryption.js';
import { JwtService } from '../../infrastructure/security/jwt.js';
import { KafkaProducer, EventName } from '../../infrastructure/messaging/kafka.js';
import {
  IOAuthProvider,
  OAuthCallbackDto,
  TokenResponse,
  RemoteProfile,
} from './oauth/oauth-provider.interface.js';
import {
  InvalidProviderError,
  OAuthDeniedError,
  MissingEmailError,
  UnauthorizedError,
  DomainError,
} from '../../shared/errors.js';

export class AuthError extends DomainError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
  }
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    roles: string[];
    isNew: boolean;
  };
}

export class AuthService {
  constructor(
    private readonly providers: Map<string, IOAuthProvider>,
    private readonly userRepo: UserRepository,
    private readonly oauthRepo: OAuthConnectionRepository,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
    private readonly kafka: KafkaProducer
  ) {}

  async handleCallback(dto: OAuthCallbackDto & { provider: string }): Promise<Result<AuthResult, AuthError>> {
    // 1. Look up the OAuth provider strategy
    const provider = this.providers.get(dto.provider.toUpperCase());
    if (!provider) {
      return Result.err(new InvalidProviderError(dto.provider));
    }

    // 2. Exchange authorization code for provider tokens
    const tokenResponse = await provider.exchangeCode(dto);
    if (tokenResponse.isErr()) {
      return Result.err(tokenResponse.error);
    }

    // 3. Fetch the remote user profile (email, id, etc.)
    const remoteProfile = await provider.getUserProfile(tokenResponse.value.accessToken);
    if (remoteProfile.isErr()) {
      return Result.err(remoteProfile.error);
    }

    // 4. Encrypt the access & refresh tokens before persistence
    const encryptedAccess = await this.encryption.encrypt(tokenResponse.value.accessToken);
    if (encryptedAccess.isErr()) {
      return Result.err(encryptedAccess.error);
    }

    let encryptedRefresh: string | null = null;
    if (tokenResponse.value.refreshToken) {
      const result = await this.encryption.encrypt(tokenResponse.value.refreshToken);
      if (result.isOk()) {
        encryptedRefresh = result.value;
      }
    }

    // 5. Atomic upsert: find by email or OAuth identity, create if neither exists
    const userResult = await this.userRepo.upsertByEmail({
      email: remoteProfile.value.email,
      defaultRole: 'CANDIDATE',
    });

    if (userResult.isErr()) {
      return Result.err(new AuthError('Failed to upsert user'));
    }

    const user = userResult.value;
    const isNew = user.createdAt.getTime() === user.updatedAt.getTime();

    // 6. Persist (or update) the OAuth connection row
    const connectionResult = await this.oauthRepo.upsertConnection({
      userId: user.id,
      provider: dto.provider.toUpperCase(),
      providerUserId: remoteProfile.value.id,
      encryptedToken: encryptedAccess.value,
      scope: tokenResponse.value.scope ?? [],
      expiresAt: tokenResponse.value.expiresAt,
    });

    if (connectionResult.isErr()) {
      return Result.err(new AuthError('Failed to upsert OAuth connection'));
    }

    // 7. Issue tokens
    const accessToken = await this.jwt.signAccess({ sub: user.id, roles: [user.roles] });
    const refreshToken = await this.jwt.signRefresh({ sub: user.id });

    // 8. If this is a brand-new user, request profile enrichment
    if (isNew) {
      await this.kafka.publish(EventName.ProfileEnrichmentTriggered, {
        userId: user.id,
        provider: dto.provider.toUpperCase(),
        providerAccessToken: tokenResponse.value.accessToken,
      });
    }

    return Result.ok({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        roles: [user.roles],
        isNew,
      },
    });
  }

  async refreshTokens(refreshToken: string): Promise<Result<{ accessToken: string; refreshToken: string }, UnauthorizedError>> {
    // Verify refresh token
    const payload = await this.jwt.verifyRefresh(refreshToken);
    if (payload.isErr()) {
      return Result.err(payload.error);
    }

    // Check if token is revoked (single-use check)
    const isRevoked = await this.jwt.isRevoked(payload.value.jti!);
    if (isRevoked) {
      return Result.err(new UnauthorizedError('Token has been revoked'));
    }

    // Fetch user
    const userResult = await this.userRepo.findById(payload.value.sub!);
    if (userResult.isErr() || !userResult.value) {
      return Result.err(new UnauthorizedError('User not found'));
    }

    // Revoke old token and issue new ones
    await this.jwt.revokeToken(payload.value.jti!);

    const accessToken = await this.jwt.signAccess({ sub: userResult.value.id, roles: [userResult.value.roles] });
    const newRefreshToken = await this.jwt.signRefresh({ sub: userResult.value.id });

    return Result.ok({ accessToken, refreshToken: newRefreshToken });
  }
}