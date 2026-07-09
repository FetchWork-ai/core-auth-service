import { FastifyInstance } from 'fastify';
import { UserController } from './user.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { JwtService } from '../../infrastructure/security/jwt.js';
import { UserRepository } from './user.repository.js';

interface UserRoutesOptions {
  userController: UserController;
  jwtService: JwtService;
  userRepository: UserRepository;
}

export async function userRoutes(
  fastify: FastifyInstance,
  options: UserRoutesOptions
) {
  const { userController, jwtService, userRepository } = options;

  // Add pre-handler for authentication
  const authenticateMiddleware = authenticate(jwtService, userRepository);

  // GET /api/v1/users/me - Get current user profile
  fastify.get(
    '/users/me',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description: 'Get current user profile',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              connectedProviders: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string' },
                    providerUserId: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' } },
                    connectedAt: { type: 'string', format: 'date-time' }
                  }
                }
              },
              createdAt: { type: 'string', format: 'date-time' }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return userController.getCurrentUser(request, reply);
    }
  );

  // PUT /api/v1/users/me - Update current user (non-privileged fields only)
  fastify.put(
    '/users/me',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description: 'Update current user profile (non-privileged fields only — role changes require ADMIN)',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            // Only safe, non-privileged fields go here.
            // 'roles' is intentionally excluded to prevent privilege escalation.
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      },
    },
    async (request, reply) => {
      return userController.updateCurrentUser(request as any, reply);
    }
  );


  // DELETE /api/v1/users/me - Delete current user
  fastify.delete(
    '/users/me',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description: 'Delete current user',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        response: {
          204: {
            type: 'null',
            description: 'User deleted successfully'
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return userController.deleteCurrentUser(request, reply);
    }
  );

  // POST /api/v1/users/me/profile-links - Submit profile links for enrichment
  fastify.post(
    '/users/me/profile-links',
    {
      preHandler: authenticateMiddleware,
      schema: {
        description: 'Submit LinkedIn and/or GitHub profile links to trigger profile enrichment',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            linkedinUrl: { type: 'string', format: 'uri' },
            githubUrl: { type: 'string', format: 'uri' }
          }
        },
        response: {
          202: {
            type: 'object',
            properties: {
              message: { type: 'string' }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' }
            }
          }
        }
      },
    },
    async (request, reply) => {
      return userController.submitProfileLinks(request as any, reply);
    }
  );
}