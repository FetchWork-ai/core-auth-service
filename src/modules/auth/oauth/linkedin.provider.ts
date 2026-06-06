import { Result } from '../../../shared/result.js';
import { OAuthDeniedError, MissingEmailError } from '../../../shared/errors.js';
import {
  IOAuthProvider,
  TokenResponse,
  RemoteProfile,
  OAuthCallbackDto,
} from './oauth-provider.interface.js';
import { logger } from '../../../shared/logger.js';
import { config } from '../../../config/index.js';

export class LinkedInProvider implements IOAuthProvider {
  readonly provider = 'LINKEDIN';
  private readonly clientId = config.LINKEDIN_CLIENT_ID;
  private readonly clientSecret = config.LINKEDIN_CLIENT_SECRET;
  private readonly redirectUri = config.LINKEDIN_REDIRECT_URI;

  async exchangeCode(dto: OAuthCallbackDto): Promise<Result<TokenResponse, OAuthDeniedError>> {
    try {
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: dto.code,
        redirect_uri: dto.redirectUri,
        ...(dto.codeVerifier && { code_verifier: dto.codeVerifier }),
      });

      const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = await response.json() as any;

      if (data.error) {
        logger.warn({ error: data.error }, 'LinkedIn OAuth error');
        return Result.err(new OAuthDeniedError(data.error_description ?? 'OAuth exchange failed'));
      }

      return Result.ok({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scope: data.scope?.split(' ') ?? [],
      });
    } catch (error) {
      logger.error({ err: error }, 'LinkedIn token exchange failed');
      return Result.err(new OAuthDeniedError('Failed to exchange authorization code'));
    }
  }

  async getUserProfile(accessToken: string): Promise<Result<RemoteProfile, MissingEmailError>> {
    try {
      const response = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return Result.err(new MissingEmailError('Failed to fetch LinkedIn profile'));
      }

      const data = await response.json() as any;

      if (!data.email) {
        return Result.err(new MissingEmailError());
      }

      return Result.ok({
        id: data.sub,
        email: data.email,
        name: data.name,
        avatarUrl: data.picture,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch LinkedIn profile');
      return Result.err(new MissingEmailError('Failed to fetch LinkedIn user profile'));
    }
  }
}