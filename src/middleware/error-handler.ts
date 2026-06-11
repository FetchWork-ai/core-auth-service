import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { DomainError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export function globalErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // 1. Handle our custom Domain Errors
  if (error instanceof DomainError) {
    let statusCode = 400; // Default Bad Request

    // Map specific DomainErrors to HTTP status codes
    switch (error.name) {
      case 'NotFoundError':
        statusCode = 404;
        break;
      case 'UnauthorizedError':
      case 'InvalidCredentialsError':
      case 'OAuthDeniedError':
        statusCode = 401;
        break;
      case 'UserNotVerifiedError':
        statusCode = 403;
        break;
      case 'ConflictError':
      case 'ConcurrencyConflictError':
        statusCode = 409;
        break;
      case 'MaxOtpAttemptsExceededError':
      case 'OtpCooldownError':
        statusCode = 429;
        break;
    }

    return reply.status(statusCode).send({
      error: error.code || error.name,
      message: error.message,
    });
  }

  // 2. Handle Fastify Validation Errors (Zod/Schema validation)
  if (error.validation) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: error.validation,
    });
  }

  // 3. Handle specific JSON parsing errors
  if (error.statusCode === 400 && error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
     return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'Invalid content type or malformed JSON',
     });
  }

  // 4. Handle unexpected generic errors securely (don't leak stack traces to the client)
  logger.error(
    {
      err: error,
      url: request.url,
      method: request.method,
      body: request.body,
    },
    'Unhandled server error'
  );

  return reply.status(500).send({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred. Please try again later.',
  });
}
