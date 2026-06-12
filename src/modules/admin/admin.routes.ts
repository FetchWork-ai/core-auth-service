import { FastifyInstance } from 'fastify';
import { AdminController } from './admin.controller.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { JwtService } from '../../infrastructure/security/jwt.js';
import { UserRepository } from '../user/user.repository.js';

interface AdminRoutesOptions {
  adminController: AdminController;
  jwtService: JwtService;
  userRepository: UserRepository;
}

export async function adminRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions
) {
  const { adminController, jwtService, userRepository } = options;

  // Add pre-handler for authentication and authorization
  const authenticateMiddleware = authenticate(jwtService, userRepository);
  const authorizeAdminMiddleware = authorize(['ADMIN']);
  const preHandler = [authenticateMiddleware, authorizeAdminMiddleware];

  // GET /api/v1/admin/users - List users
  fastify.get(
    '/users',
    {
      preHandler,
      schema: {
        description: 'List all users with pagination and filtering',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1 },
            limit: { type: 'integer', default: 10 },
            search: { type: 'string' },
            role: { type: 'string', enum: ['CANDIDATE', 'RECRUITER', 'ADMIN'] },
            status: { type: 'string', enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'] }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    email: { type: 'string' },
                    roles: { type: 'string' },
                    status: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' }
                  }
                }
              },
              meta: {
                type: 'object',
                properties: {
                  total: { type: 'integer' },
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  totalPages: { type: 'integer' }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return adminController.listUsers(request as any, reply);
    }
  );

  // GET /api/v1/admin/users/:id - Get specific user details
  fastify.get(
    '/users/:id',
    {
      preHandler,
      schema: {
        description: 'Get detailed profile of a specific user',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        },
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
      return adminController.getUserDetails(request as any, reply);
    }
  );

  // PATCH /api/v1/admin/users/:id - Update user role and status
  fastify.patch(
    '/users/:id',
    {
      preHandler,
      schema: {
        description: 'Update user role or status',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        },
        body: {
          type: 'object',
          properties: {
            roles: { type: 'string', enum: ['CANDIDATE', 'RECRUITER', 'ADMIN'] },
            status: { type: 'string', enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'] }
          }
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              status: { type: 'string' },
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
      }
    },
    async (request, reply) => {
      return adminController.updateUser(request as any, reply);
    }
  );

  // DELETE /api/v1/admin/users/:id - Delete a user
  fastify.delete(
    '/users/:id',
    {
      preHandler,
      schema: {
        description: 'Delete a user',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' }
          },
          required: ['id']
        },
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
      return adminController.deleteUser(request as any, reply);
    }
  );

  // GET /api/v1/admin/stats - Get system statistics
  fastify.get(
    '/stats',
    {
      preHandler,
      schema: {
        description: 'Get system statistics',
        tags: ['Admin'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              totalUsers: { type: 'integer' },
              statusCounts: {
                type: 'object',
                additionalProperties: { type: 'integer' }
              },
              roleCounts: {
                type: 'object',
                additionalProperties: { type: 'integer' }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return adminController.getSystemStats(request, reply);
    }
  );
}
