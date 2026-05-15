import { Result } from '../../../shared/result.js';
import { OAuthDeniedError, MissingEmailError } from '../../../shared/errors.js';

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string[];
}

export interface RemoteProfile {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface OAuthCallbackDto {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface IOAuthProvider {
  readonly provider: string;

  exchangeCode(dto: OAuthCallbackDto): Promise<Result<TokenResponse, OAuthDeniedError>>;

  getUserProfile(accessToken: string): Promise<Result<RemoteProfile, MissingEmailError>>;
}