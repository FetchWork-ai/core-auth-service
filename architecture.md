# Core Auth Service — Architecture

## Overview

The Core Auth Service is a Fastify 5 microservice responsible for:
- OAuth 2.0 authentication (GitHub, LinkedIn)
- JWT-based session management (access + refresh tokens)
- User profile management
- Emitting domain events to downstream services via Kafka

It is built following **Domain-Driven Design (DDD)** principles with a clear separation between the HTTP layer, domain logic, and infrastructure concerns.

---

## High-Level System Architecture

```mermaid
graph TB
    Client(["Client / Browser"])
    AuthService["Core Auth Service\n(Fastify 5 · Node.js)"]
    DB[("PostgreSQL\n(Prisma ORM)")]
    Redis[("Redis\nToken Blocklist")]
    Kafka["Apache Kafka\nEvent Bus"]
    Downstream["Downstream Services\n(Profile Enrichment, etc.)"]

    Client -->|"HTTPS (REST)"| AuthService
    AuthService -->|"Prisma Client"| DB
    AuthService -->|"Token Revocation"| Redis
    AuthService -->|"Domain Events"| Kafka
    Kafka -->|"Consumes Events"| Downstream
```

---

## Directory Structure

```
src/
├── app.ts                          # Fastify app factory & plugin/route registration
├── server.ts                       # Entry point — listens, handles SIGINT/SIGTERM
│
├── config/
│   ├── index.ts                    # Zod-validated environment configuration
│   └── di.ts                       # Awilix DI container setup
│
├── shared/
│   ├── result.ts                   # Result<T, E> monad (Ok / Err)
│   ├── errors.ts                   # Domain error hierarchy
│   └── logger.ts                   # Pino-based structured logger
│
├── middleware/
│   └── authenticate.ts             # JWT verification + user hydration hook
│
├── infrastructure/
│   ├── db/
│   │   └── prisma.ts               # Prisma singleton client
│   ├── security/
│   │   ├── jwt.ts                  # JWT sign/verify (access & refresh)
│   │   └── encryption.ts           # AES-256-GCM envelope encryption
│   └── messaging/
│       └── kafka.ts                # KafkaJS producer + typed event publishing
│
└── modules/
    ├── auth/
    │   ├── auth.service.ts         # OAuth callback flow, token refresh
    │   └── oauth/
    │       ├── oauth-provider.interface.ts   # IOAuthProvider contract
    │       ├── github.provider.ts            # GitHub OAuth strategy
    │       ├── linkedin.provider.ts          # LinkedIn OAuth strategy
    │       └── oauth-connection.repository.ts
    │
    ├── user/
    │   ├── user.repository.ts      # DB operations for User entity
    │   ├── user.service.ts         # Business logic: get, update, delete user
    │   ├── user.controller.ts      # HTTP request handling
    │   └── user.routes.ts          # Route definitions (GET/PUT/DELETE /users/me)
    │
    ├── knowledge-base/
    │   ├── kb.repository.ts        # DB operations for KnowledgeBase entity
    │   └── kb.service.ts           # Placeholder service
    │
    └── notifications/
        ├── notification.repository.ts
        └── notification.service.ts  # Placeholder service
```

---

## Layered Architecture

```mermaid
graph LR
    subgraph HTTP ["HTTP Layer"]
        Routes["Routes\n(user.routes.ts)"]
        Controller["Controller\n(user.controller.ts)"]
        Middleware["Middleware\n(authenticate.ts)"]
    end

    subgraph Domain ["Domain / Application Layer"]
        Service["Service\n(user.service.ts\nauth.service.ts)"]
        Errors["Domain Errors\n(errors.ts)"]
        ResultMonad["Result Monad\n(result.ts)"]
    end

    subgraph Infra ["Infrastructure Layer"]
        Repo["Repositories\n(user.repo / oauth.repo /\nkb.repo / notif.repo)"]
        JWT["JwtService\n(jwt.ts)"]
        Enc["EncryptionService\n(encryption.ts)"]
        Kafka["KafkaProducer\n(kafka.ts)"]
        Prisma["PrismaClient\n(prisma.ts)"]
    end

    Routes --> Controller
    Routes --> Middleware
    Middleware --> JWT
    Controller --> Service
    Service --> Repo
    Service --> JWT
    Service --> Enc
    Service --> Kafka
    Repo --> Prisma
```

---

## Request Flow: Authenticated User Endpoint

```mermaid
sequenceDiagram
    participant C as Client
    participant R as Route (Fastify)
    participant M as authenticate middleware
    participant J as JwtService
    participant DB as UserRepository (Prisma)
    participant Ctrl as UserController
    participant S as UserService

    C->>R: GET /api/v1/users/me\nAuthorization: Bearer <token>
    R->>M: preHandler hook fires
    M->>J: verifyAccess(token)
    J-->>M: Result<JwtPayload>
    M->>J: isRevoked(jti)
    J-->>M: false
    M->>DB: findById(sub)
    DB-->>M: User record
    M-->>R: request.currentUser = { id, email, roles }
    R->>Ctrl: getCurrentUser(request, reply)
    Ctrl->>S: getCurrentUser(userId)
    S->>DB: findById + loadConnections
    DB-->>S: UserProfile
    S-->>Ctrl: Result.ok(profile)
    Ctrl-->>C: 200 { id, email, roles, connectedProviders, createdAt }
```

---

## OAuth Login Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant AS as AuthService
    participant P as OAuthProvider\n(GitHub / LinkedIn)
    participant E as EncryptionService
    participant UR as UserRepository
    participant OR as OAuthConnectionRepository
    participant J as JwtService
    participant K as KafkaProducer

    C->>AS: handleCallback({ code, provider, redirectUri })
    AS->>P: exchangeCode(dto)
    P-->>AS: TokenResponse { accessToken, refreshToken }
    AS->>P: getUserProfile(accessToken)
    P-->>AS: RemoteProfile { id, email }
    AS->>E: encrypt(accessToken)
    E-->>AS: encryptedToken
    AS->>UR: upsertByEmail({ email })
    UR-->>AS: User (new or existing)
    AS->>OR: upsertConnection({ userId, provider, encryptedToken })
    OR-->>AS: OAuthConnection record
    AS->>J: signAccess({ sub, roles })
    AS->>J: signRefresh({ sub })
    alt User is brand new
        AS->>K: publish(ProfileEnrichmentTriggered, { userId, provider, accessToken })
    end
    AS-->>C: { accessToken, refreshToken, expiresIn, user }
```

---

## Token Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Issued : OAuth login / refresh
    Issued --> Active : Client stores & uses token
    Active --> Expired : 15 min (access) / 7 days (refresh)
    Active --> Revoked : Logout / token rotation
    Revoked --> [*]
    Expired --> [*]

    note right of Active
        JWT verified per request
        Redis blocklist checked
        (Redis integration pending)
    end note
```

---

## Domain Error Hierarchy

```mermaid
classDiagram
    class DomainError {
        <<abstract>>
        +string code
        +string message
    }

    DomainError <|-- UnauthorizedError
    DomainError <|-- NotFoundError
    DomainError <|-- ForbiddenError
    DomainError <|-- ValidationError
    DomainError <|-- ConflictError
    DomainError <|-- InvalidProviderError
    DomainError <|-- OAuthDeniedError
    DomainError <|-- MissingEmailError
    DomainError <|-- ConcurrencyConflictError
    DomainError <|-- AuthError

    class UnauthorizedError { code = "UNAUTHORIZED" }
    class NotFoundError { code = "NOT_FOUND" }
    class ForbiddenError { code = "FORBIDDEN" }
    class ValidationError { code = "VALIDATION_ERROR" }
    class ConflictError { code = "CONFLICT" }
    class InvalidProviderError { code = "INVALID_PROVIDER" }
    class OAuthDeniedError { code = "OAUTH_DENIED" }
    class MissingEmailError { code = "MISSING_EMAIL" }
    class ConcurrencyConflictError { code = "CONCURRENCY_CONFLICT" }
    class AuthError { code = "AUTH_ERROR" }
```

---

## API Routes (Current)

| Method   | Path                  | Auth Required | Tag    | Description                    |
|----------|-----------------------|:-------------:|--------|--------------------------------|
| `GET`    | `/`                   | ❌            | System | Root health ping               |
| `GET`    | `/health`             | ❌            | System | Service health check           |
| `GET`    | `/docs`               | ❌            | —      | Swagger UI                     |
| `GET`    | `/api/v1/users/me`    | ✅ Bearer JWT | Users  | Get current user profile       |
| `PUT`    | `/api/v1/users/me`    | ✅ Bearer JWT | Users  | Update current user role       |
| `DELETE` | `/api/v1/users/me`    | ✅ Bearer JWT | Users  | Delete current user account    |

---

## Infrastructure Services

### JwtService (`infrastructure/security/jwt.ts`)
- **Algorithm**: HS256 (HMAC-SHA256)
- `signAccess(payload)` — expires in **15 minutes**
- `signRefresh(payload)` — expires in **7 days**
- `verifyAccess(token)` → `Result<JwtPayload>`
- `verifyRefresh(token)` → `Result<JwtPayload>`
- `isRevoked(jti)` / `revokeToken(jti)` — **TODO: Redis blocklist**

### EncryptionService (`infrastructure/security/encryption.ts`)
- **Algorithm**: AES-256-GCM (envelope encryption)
- Used to encrypt OAuth provider tokens before persistence

### KafkaProducer (`infrastructure/messaging/kafka.ts`)
- Client ID: `user-kb-service`
- Events published:
  | Event | Topic | Trigger |
  |---|---|---|
  | `ProfileEnrichmentTriggered` | `user-kb.ProfileEnrichmentTriggered` | New user created via OAuth |
  | `UserDeleted` | `user-kb.UserDeleted` | User account deleted |
  | `PreferencesUpdated` | `user-kb.PreferencesUpdated` | Notification prefs updated |

---

## Environment Configuration (`config/index.ts`)

| Variable       | Type     | Default         | Required |
|----------------|----------|-----------------|----------|
| `NODE_ENV`     | enum     | `development`   | ❌       |
| `PORT`         | number   | `8080`          | ❌       |
| `HOST`         | string   | `0.0.0.0`       | ❌       |
| `LOG_LEVEL`    | enum     | `info`          | ❌       |
| `DATABASE_URL` | URL      | —               | ✅       |
| `REDIS_URL`    | URL      | —               | ❌       |
| `KAFKA_BROKERS`| CSV list | —               | ✅       |
| `JWT_SECRET`   | string   | —               | ✅ (≥32 chars) |

---

## Dependency Injection (`config/di.ts`)

The service uses **Awilix** for IoC in `CLASSIC` (constructor injection) mode.

```mermaid
graph TD
    Container["Awilix Container"]

    Container --> Prisma["prisma (value)"]
    Container --> Logger["logger (value)"]
    Container --> Config["config (value)"]
    Container --> JwtSvc["JwtService (singleton)"]
    Container --> EncSvc["EncryptionService (singleton)"]
    Container --> KafkaProd["KafkaProducer (singleton)"]
    Container --> UserRepo["UserRepository"]
    Container --> OAuthRepo["OAuthConnectionRepository"]
    Container --> KbRepo["KnowledgeBaseRepository"]
    Container --> NotifRepo["NotificationPreferenceRepository"]
    Container --> AuthSvc["AuthService"]
    Container --> UserSvc["UserService"]
    Container --> KbSvc["KnowledgeBaseService"]
    Container --> NotifSvc["NotificationService"]
```

---

## What's Not Yet Implemented

| Item | Status |
|------|--------|
| Auth routes (`/api/v1/auth/callback`, `/api/v1/auth/refresh`) | 🔴 Pending |
| Knowledge Base routes & controller | 🔴 Pending |
| Notifications routes & controller | 🔴 Pending |
| Redis token blocklist (`isRevoked` / `revokeToken`) | 🔴 Pending |
| `authorize.ts` — Role-based access control middleware | 🔴 Pending |
| `error-handler.ts` — Global error serialization plugin | 🔴 Pending |
| Unit & integration tests | 🔴 Pending |
