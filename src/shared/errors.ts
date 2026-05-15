export abstract class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found') {
    super(message, 'NOT_FOUND');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN');
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Validation failed') {
    super(message, 'VALIDATION_ERROR');
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflict') {
    super(message, 'CONFLICT');
  }
}

export class InvalidProviderError extends DomainError {
  constructor(provider: string) {
    super(`Unsupported OAuth provider: ${provider}`, 'INVALID_PROVIDER');
  }
}

export class OAuthDeniedError extends DomainError {
  constructor(message = 'The authorization code has expired or was revoked') {
    super(message, 'OAUTH_DENIED');
  }
}

export class MissingEmailError extends DomainError {
  constructor(message = 'OAuth provider did not return an email address') {
    super(message, 'MISSING_EMAIL');
  }
}

export class ConcurrencyConflictError extends DomainError {
  constructor(message = 'Version mismatch') {
    super(message, 'CONCURRENCY_CONFLICT');
  }
}