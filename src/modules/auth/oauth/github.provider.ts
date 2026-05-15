import { Result } from '../../../shared/result.js';
import { OAuthDeniedError, MissingEmailError } from '../../../shared/errors.js';
import {
  IOAuthProvider,
  TokenResponse,
  RemoteProfile,
  OAuthCallbackDto,
} from './oauth-provider.interface.js';
import { config } from '../../../config/index.js';
import { logger } from '../../../shared/logger.js';

export class GitHubProvider implements IOAuthProvider {
  readonly provider = 'GITHUB';
  private readonly clientId = process.env.GITHUB_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GITHUB_CLIENT_SECRET ?? '';
  private readonly redirectUri = process.env.GITHUB_REDIRECT_URI ?? '';

  async exchangeCode(dto: OAuthCallbackDto): Promise<Result<TokenResponse, OAuthDeniedError>> {
    try {
      const params = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: dto.code,
        redirect_uri: dto.redirectUri,
        ...(dto.codeVerifier && { code_verifier: dto.codeVerifier }),
      });

      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await response.json() as any;

      if (data.error) {
        logger.warn({ error: data.error }, 'GitHub OAuth error');
        return Result.err(new OAuthDeniedError(data.error_description ?? 'OAuth exchange failed'));
      }

      return Result.ok({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
        scope: data.scope?.split(' ') ?? [],
      });
    } catch (error) {
      logger.error({ err: error }, 'GitHub token exchange failed');
      return Result.err(new OAuthDeniedError('Failed to exchange authorization code'));
    }
  }

  async getUserProfile(accessToken: string): Promise<Result<RemoteProfile, MissingEmailError>> {
    try {
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!userResponse.ok) {
        return Result.err(new MissingEmailError('Failed to fetch GitHub profile'));
      }

      const userData = await userResponse.json() as any;

      // GitHub may return null email if not granted
      if (!userData.email) {
        // Try to fetch emails
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        });

        if (emailResponse.ok) {
          const emails = await emailResponse.json() as any[];
          const primaryEmail = emails.find((e: any) => e.primary && e.verified);
          if (primaryEmail) {
            return Result.ok({
              id: String(userData.id),
              email: primaryEmail.email,
              name: userData.name,
              avatarUrl: userData.avatar_url,
            });
          }
        }
        return Result.err(new MissingEmailError());
      }

      return Result.ok({
        id: String(userData.id),
        email: userData.email,
        name: userData.name,
        avatarUrl: userData.avatar_url,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch GitHub profile');
      return Result.err(new MissingEmailError('Failed to fetch GitHub user profile'));
    }
  }
}