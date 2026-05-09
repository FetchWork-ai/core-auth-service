# User & Knowledge Base Service — Low-Level Design

**Status:** Draft v1.0  
**Owner:** Platform Backend Team  
**Tech Stack:** Node.js 22 (TypeScript 5.x), Fastify 5, Prisma ORM 6, PostgreSQL 16, Apache Kafka (kafkajs)

---

## 1. Directory & Module Structure

```text
user-kb-service/
├── src/
│   ├── server.ts                    # Fastify bootstrap, plugin registration, graceful shutdown
│   ├── app.ts                       # App factory (exported for integration tests)
│   ├── config/
│   │   ├── index.ts                 # Typed env loader (zod-validated)
│   │   └── di.ts                    # Awilix IoC container — registers all deps
│   │
│   ├── modules/                     # Feature modules (vertical slices)
│   │   ├── auth/
│   │   │   ├── auth.routes.ts       # POST /auth/oauth/callback, POST /auth/refresh
│   │   │   ├── auth.controller.ts   # Request parsing, response serialization
│   │   │   ├── auth.service.ts      # OAuth orchestration, JWT issuance
│   │   │   ├── auth.schema.ts       # Fastify JSON schemas (req/res validation)
│   │   │   ├── oauth/
│   │   │   │   ├── oauth-provider.interface.ts
│   │   │   │   ├── github.provider.ts
│   │   │   │   └── linkedin.provider.ts
│   │   │   └── __tests__/
│   │   │       ├── auth.service.spec.ts
│   │   │       └── auth.routes.spec.ts
│   │   │
│   │   ├── user/
│   │   │   ├── user.routes.ts       # GET /users/me, PUT /users/me, DELETE /users/me
│   │   │   ├── user.controller.ts
│   │   │   ├── user.service.ts
│   │   │   ├── user.repository.ts   # Prisma queries (Data Mapper pattern)
│   │   │   ├── user.schema.ts
│   │   │   └── __tests__/
│   │   │
│   │   ├── knowledge-base/
│   │   │   ├── kb.routes.ts         # GET /users/me/kb, PUT /users/me/kb
│   │   │   ├── kb.controller.ts
│   │   │   ├── kb.service.ts        # Upsert & merge logic for the JSONB graph
│   │   │   ├── kb.repository.ts
│   │   │   ├── kb.schema.ts
│   │   │   └── __tests__/
│   │   │
│   │   └── notifications/
│   │       ├── notification.routes.ts   # GET /users/me/preferences, PUT /users/me/preferences
│   │       ├── notification.controller.ts
│   │       ├── notification.service.ts
│   │       ├── notification.repository.ts
│   │       ├── notification.schema.ts
│   │       └── __tests__/
│   │
│   ├── infrastructure/
│   │   ├── db/
│   │   │   ├── prisma.ts            # Singleton PrismaClient
│   │   │   └── migrations/          # Prisma migrate output
│   │   ├── cache/
│   │   │   └── redis.ts             # ioredis client (session blocklist, rate-limit)
│   │   ├── messaging/
│   │   │   ├── kafka.ts             # Kafka producer singleton (kafkajs)
│   │   │   ├── kafka-consumer.ts    # Optional: inbound event handlers
│   │   │   └── events.ts            # Event name constants + typed payload maps
│   │   └── security/
│   │       ├── jwt.ts               # sign/verify/refresh helpers (jose)
│   │       ├── encryption.ts        # AES-256-GCM envelope encryption for OAuth tokens
│   │       └── hashing.ts           # argon2id wrapper
│   │
│   ├── middleware/
│   │   ├── authenticate.ts          # JWT verification + user hydration
│   │   ├── authorize.ts             # Role-based guard factory (requireRole('ADMIN'))
│   │   ├── rate-limit.ts            # @fastify/rate-limit config
│   │   └── error-handler.ts         # Global error serializer (never leak internals)
│   │
│   └── shared/
│       ├── errors.ts                # Domain error classes (UnauthorizedError, NotFoundError, ...)
│       ├── result.ts                # Result<T,E> discriminated union for service returns
│       ├── types.ts                 # Shared TS utilities (DeepPartial, Branded types, etc.)
│       └── logger.ts                # pino instance (structured JSON logging)
│
├── prisma/
│   └── schema.prisma
├── test/
│   ├── integration/                 # Testcontainers-powered DB + Kafka tests
│   └── fixtures/                    # Shared seed factories
├── docker-compose.yml               # PostgreSQL 16 + Kafka (KRaft) + Redis for local dev
├── Dockerfile
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

**Key conventions:**
- Each module owns its **routes → controller → service → repository** vertical. No cross-module imports at the repository layer.
- Services return `Result<T, DomainError>` unions — never throw for expected failures.
- All runtime configuration is loaded via `config/index.ts` and validated with Zod at startup (fail-fast).
- The Prisma client is **not** used directly in services; repositories wrap it, making them the single point to swap for raw SQL if needed.

---

## 2. Database Schema (Prisma ORM)

### 2.1 Entity-Relationship Diagram

```mermaid
erDiagram
    User ||--o{ OAuthConnection : "has many"
    User ||--o| NotificationPreference : "has one"
    User ||--o| KnowledgeBase : "has one"

    User {
        string id PK "uuid"
        string email UK "Citext"
        string roles "Enum: CANDIDATE, RECRUITER, ADMIN"
        datetime createdAt
        datetime updatedAt
    }

    OAuthConnection {
        string id PK "uuid"
        string userId FK "uuid"
        string provider "Enum: GITHUB, LINKEDIN"
        string providerUserId
        string encryptedToken "AES-256-GCM envelope"
        string scope "array"
        datetime expiresAt
        datetime createdAt
        datetime updatedAt
    }

    NotificationPreference {
        string id PK "uuid"
        string userId FK "Unique"
        string digestFrequency "Enum"
        float minMatchScore
        boolean notifyOnNewJobs
        boolean notifyOnStatusChange
        string quietHoursStart
        string quietHoursEnd
        string channels "jsonb"
        datetime createdAt
        datetime updatedAt
    }

    KnowledgeBase {
        string id PK "uuid"
        string userId FK "Unique"
        string profileGraph "jsonb"
        int version "Optimistic lock"
        datetime lastEnriched
        datetime createdAt
        datetime updatedAt
    }
```

### 2.2 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearch"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Enums ───────────────────────────────────────────────────────────────────

enum UserRole {
  CANDIDATE
  RECRUITER
  ADMIN
}

enum OAuthProvider {
  GITHUB
  LINKEDIN
}

enum DigestFrequency {
  INSTANT
  DAILY
  WEEKLY
  NEVER
}

// ── User ────────────────────────────────────────────────────────────────────

model User {
  id        String    @id @default(uuid()) @db.Uuid
  email     String    @unique @db.Citext
  roles     UserRole  @default(CANDIDATE)
  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  // Relations
  oauthConnections     OAuthConnection[]
  notificationPrefs    NotificationPreference?
  knowledgeBase        KnowledgeBase?

  @@map("users")
}

// ── OAuth Connection ────────────────────────────────────────────────────────

model OAuthConnection {
  id              String        @id @default(uuid()) @db.Uuid
  userId          String        @db.Uuid
  provider        OAuthProvider
  providerUserId  String        @map("provider_user_id")
  encryptedToken  String        @map("encrypted_token_ref") @db.Text
  // encryptedToken holds: base64(iv) + ":" + base64(ciphertext) + ":" + base64(auth-tag)
  // The DEK itself is stored in a KMS/vault; the service only holds a key reference.
  scope           String[]      // ["read:user","user:email"]
  expiresAt       DateTime?     @map("expires_at")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@unique([userId, provider])   // one connection per provider per user
  @@map("oauth_connections")
}

// ── Notification Preference ─────────────────────────────────────────────────

model NotificationPreference {
  id                 String          @id @default(uuid()) @db.Uuid
  userId             String          @unique @db.Uuid
  digestFrequency    DigestFrequency @default(DAILY)
  minMatchScore      Decimal         @default(0.70) @db.Decimal(3, 2)  // 0.00–1.00
  notifyOnNewJobs    Boolean         @default(true)
  notifyOnStatusChange Boolean       @default(false)
  quietHoursStart    String?         @db.VarChar(5)  // "22:00"
  quietHoursEnd      String?         @db.VarChar(5)  // "07:00"
  channels           JsonB           @default("[]")  // ["email","push","in_app"]
  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")

  user   User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notification_preferences")
}

// ── Knowledge Base ──────────────────────────────────────────────────────────

model KnowledgeBase {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @unique @db.Uuid
  profileGraph  JsonB    @map("profile_graph")  // See §4.2 for the JSON schema
  version       Int      @default(1)
  lastEnriched  DateTime? @map("last_enriched_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("knowledge_bases")
}
```

**Design notes:**
- **`@db.Citext`** on `User.email` provides case-insensitive uniqueness without an extra index.
- **`encryptedToken`** uses envelope encryption: the data key is fetched from a KMS at startup, cached in memory, and used for AES-256-GCM encrypt/decrypt at the application layer. The column stores only the ciphertext envelope.
- **`NotificationPreference.channels`** is JSONB so new channel types (SMS, webhook) don't require migrations.
- **`KnowledgeBase.profileGraph`** is JSONB — PostgreSQL can index into it with GIN indexes if we later need to query by skills or titles. The version column enables optimistic concurrency control.

---

## 3. API Contracts

All endpoints are prefixed with `/api/v1`. All bodies are `application/json`. Fastify JSON schemas validate every request/response (no ajv surprises at runtime).

### 3.1 `POST /api/v1/auth/oauth/callback`

Handles the second leg of the OAuth 2.0 authorization code flow.

**Request:**
```json
{
  "provider": "GITHUB",
  "code": "abc123def456",
  "redirectUri": "[https://app.example.com/oauth/callback](https://app.example.com/oauth/callback)",
  "codeVerifier": "s256-challenge-verifier-string"
}
```

**Response `200 OK`:**
```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiIs...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJl...",
  "expiresIn": 900,
  "user": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "dev@example.com",
    "roles": ["CANDIDATE"],
    "isNew": true
  }
}
```

**Response `400 Bad Request`:**
```json
{
  "error": "INVALID_PROVIDER",
  "message": "Unsupported OAuth provider: FACEBOOK"
}
```

**Response `401 Unauthorized`:**
```json
{
  "error": "OAUTH_DENIED",
  "message": "The authorization code has expired or was revoked"
}
```

### 3.2 `GET /api/v1/users/me`

Returns the authenticated user's profile. Requires `Authorization: Bearer <accessToken>`.

**Response `200 OK`:**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "dev@example.com",
  "roles": ["CANDIDATE"],
  "connectedProviders": [
    {
      "provider": "GITHUB",
      "providerUserId": "octocat",
      "scopes": ["read:user", "user:email"],
      "connectedAt": "2026-05-01T12:00:00Z"
    }
  ],
  "createdAt": "2026-04-15T08:30:00Z"
}
```

### 3.3 `PUT /api/v1/users/me/preferences`

Upserts notification preferences for the authenticated user. Returns the full preference object.

**Request:**
```json
{
  "digestFrequency": "WEEKLY",
  "minMatchScore": 0.80,
  "notifyOnNewJobs": true,
  "notifyOnStatusChange": true,
  "quietHoursStart": "22:00",
  "quietHoursEnd": "07:00",
  "channels": ["email", "push"]
}
```

*All fields are optional — only send what you want to change.*

**Response `200 OK`:**
```json
{
  "digestFrequency": "WEEKLY",
  "minMatchScore": 0.80,
  "notifyOnNewJobs": true,
  "notifyOnStatusChange": true,
  "quietHoursStart": "22:00",
  "quietHoursEnd": "07:00",
  "channels": ["email", "push"]
}
```

### 3.4 `GET /api/v1/users/me/kb`

Returns the current Knowledge Base graph for the authenticated user.

**Response `200 OK`:**
```json
{
  "version": 3,
  "profileGraph": {
    "skills": [
      { "name": "TypeScript", "level": "EXPERT", "yearsOfExperience": 6 },
      { "name": "PostgreSQL", "level": "ADVANCED", "yearsOfExperience": 4 }
    ],
    "jobTitles": ["Senior Backend Engineer", "Tech Lead"],
    "industries": ["SaaS", "FinTech"],
    "education": [
      { "degree": "M.Sc.", "field": "Computer Science", "year": 2018 }
    ],
    "certifications": ["AWS Solutions Architect Associate"],
    "preferredLocations": ["Remote", "Berlin"],
    "salaryExpectations": { "currency": "EUR", "min": 85000, "max": 110000 },
    "rawProviderData": {
      "github": { "publicRepos": 42, "topLanguages": ["TypeScript", "Go"] },
      "linkedin": { "connections": 500 }
    }
  },
  "lastEnrichedAt": "2026-05-09T10:00:00Z"
}
```

---

## 4. Internal Business Logic & Services

### 4.1 `AuthService` — OAuth Callback Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant AC as AuthController
    participant AS as AuthService
    participant Provider as OAuth Strategy
    participant Enc as EncryptionService
    participant DB as Prisma (DB)
    participant JWT as JwtService
    participant Kafka as KafkaProducer

    Client->>AC: POST /oauth/cb (provider, code)
    AC->>AS: handleCallback(dto)
    
    AS->>Provider: exchangeCode(dto)
    Provider-->>AS: TokenResponse (accessToken, refreshToken)
    
    AS->>Provider: getUserProfile(accessToken)
    Provider-->>AS: RemoteProfile (email, id)
    
    AS->>Enc: encrypt(tokens)
    Enc-->>AS: Encrypted Envelopes
    
    AS->>DB: upsertByEmail(email)
    DB-->>AS: User Entity (yields isNew status)
    
    AS->>DB: upsertConnection(provider, encryptedTokens)
    DB-->>AS: OAuthConnection Entity
    
    AS->>JWT: signAccess() & signRefresh()
    JWT-->>AS: JWT Pair
    
    opt If isNew == true
        AS->>Kafka: publish(ProfileEnrichmentTriggered, payload)
        note right of Kafka: Event consumed by external<br/>Profile Enrichment Worker
    end
    
    AS-->>AC: AuthResult (Tokens + User)
    AC-->>Client: 200 OK
```

**Service pseudocode:**

```typescript
// src/modules/auth/auth.service.ts

interface OAuthCallbackDto {
  provider: OAuthProvider;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; roles: UserRole[]; isNew: boolean };
}

export class AuthService {
  constructor(
    private readonly providers: Map<OAuthProvider, IOAuthProvider>,
    private readonly userRepo: UserRepository,
    private readonly oauthRepo: OAuthConnectionRepository,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
    private readonly kafka: KafkaProducer,
  ) {}

  async handleCallback(dto: OAuthCallbackDto): Promise<Result<AuthResult, AuthError>> {
    // 1. Look up the OAuth provider strategy
    const provider = this.providers.get(dto.provider);
    if (!provider) return Result.err(new InvalidProviderError(dto.provider));

    // 2. Exchange authorization code for provider tokens
    const tokenResponse = await provider.exchangeCode(dto);
    if (tokenResponse.isErr()) return tokenResponse; // propagate upstream error

    // 3. Fetch the remote user profile (email, id, etc.)
    const remoteProfile = await provider.getUserProfile(tokenResponse.value.accessToken);
    if (remoteProfile.isErr()) return remoteProfile;

    // 4. Encrypt the access & refresh tokens before persistence
    const encryptedAccess  = await this.encryption.encrypt(tokenResponse.value.accessToken);
    const encryptedRefresh = tokenResponse.value.refreshToken
      ? await this.encryption.encrypt(tokenResponse.value.refreshToken)
      : null;

    // 5. Atomic upsert: find by email or OAuth identity, create if neither exists
    const user = await this.userRepo.upsertByEmail({
      email: remoteProfile.value.email,
      defaultRole: UserRole.CANDIDATE,
    });
    const isNew = user.createdAt.getTime() === user.updatedAt.getTime();

    // 6. Persist (or update) the OAuth connection row
    await this.oauthRepo.upsertConnection({
      userId: user.id,
      provider: dto.provider,
      providerUserId: remoteProfile.value.id,
      encryptedToken: encryptedAccess,
      scope: tokenResponse.value.scope ?? [],
      expiresAt: tokenResponse.value.expiresAt,
    });

    // 7. Issue tokens
    const accessToken  = await this.jwt.signAccess({ sub: user.id, roles: user.roles });
    const refreshToken = await this.jwt.signRefresh({ sub: user.id });

    // 8. If this is a brand-new user, request profile enrichment
    if (isNew) {
      await this.kafka.publish(EventName.ProfileEnrichmentTriggered, {
        userId: user.id,
        provider: dto.provider,
        providerAccessToken: tokenResponse.value.accessToken, // ephemeral — consumed once
        timestamp: new Date().toISOString(),
      });
    }

    return Result.ok({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: { id: user.id, email: user.email, roles: user.roles, isNew },
    });
  }
}
```

**Important edge cases handled:**
- **Existing user, new provider:** The user row is matched by email; a second `OAuthConnection` row is added. No duplicate user is created.
- **Token encryption failure:** The entire operation fails before any row is written. The `upsertByEmail` call is idempotent.
- **Provider returns no email:** GitHub can suppress the email scope. The service returns a `MISSING_EMAIL` error, and the client must prompt the user to grant the `user:email` scope.

---

### 4.2 `KnowledgeBaseService` — Profile Graph Upsert

The Knowledge Base is a **single JSONB document per user** that aggregates structured profile data from OAuth providers, resume parsing, and manual input. The upsert is a **deep partial merge**, not a blind replace.

**Profile graph TypeScript type:**

```typescript
interface ProfileGraph {
  skills:              Array<{ name: string; level: SkillLevel; yearsOfExperience?: number }>;
  jobTitles:           string[];
  industries:          string[];
  education:           Array<{ degree: string; field: string; institution?: string; year?: number }>;
  certifications:      string[];
  preferredLocations:  string[];
  salaryExpectations:  { currency: string; min: number; max: number } | null;
  rawProviderData:     Record<string, unknown>;  // opaque blobs per provider
}

type SkillLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";
```

**Upsert flow:**

1. **Fetch** the current `KnowledgeBase` row for `userId` (may be null for a fresh user).
2. **Deep-merge** the incoming partial `ProfileGraph` with the existing graph:
   - **Arrays of objects** (skills, education): matched by a key (`name` for skills, `degree+field` for education). New entries are appended; existing entries are replaced if the incoming data has the same key.
   - **String arrays** (jobTitles, industries, locations): union set, preserving order — new items are prepended.
   - **Scalar objects** (salaryExpectations): overwritten if the incoming value is non-null.
   - **`rawProviderData`**: top-level keys are merged (e.g., `{ github: {...}, linkedin: {...} }`), each provider's blob is overwritten with the latest payload.
3. **Increment `version`** (optimistic locking — if the version changed since read, re-read and re-merge).
4. **Set `lastEnrichedAt`** to now.
5. **Write** back to the `knowledge_bases` table via `prisma.knowledgeBase.upsert`.

```typescript
// src/modules/knowledge-base/kb.service.ts

export class KnowledgeBaseService {
  constructor(
    private readonly kbRepo: KnowledgeBaseRepository,
  ) {}

  async upsertProfileGraph(
    userId: string,
    incoming: DeepPartial<ProfileGraph>,
    expectedVersion: number,
  ): Promise<Result<KnowledgeBase, DomainError>> {
    const current = await this.kbRepo.findByUserId(userId);

    if (current && current.version !== expectedVersion) {
      return Result.err(new ConcurrencyConflictError(
        `Version mismatch: expected ${expectedVersion}, got ${current.version}`
      ));
    }

    const merged = current
      ? deepMergeProfileGraph(current.profileGraph as ProfileGraph, incoming)
      : (incoming as ProfileGraph); // first write — no merge needed

    const updated = await this.kbRepo.upsert(userId, {
      profileGraph: merged,
      version: (current?.version ?? 0) + 1,
      lastEnrichedAt: new Date(),
    });

    return Result.ok(updated);
  }
}
```

**`deepMergeProfileGraph` rules summary:**

| Field                  | Strategy                        |
|------------------------|---------------------------------|
| `skills`               | Merge by `name`, replace match  |
| `jobTitles`            | Union, new items prepended      |
| `education`            | Merge by `degree`+`field`       |
| `certifications`       | Union, deduped by case-insensitive match |
| `preferredLocations`   | Union                           |
| `salaryExpectations`   | Full replace if non-null        |
| `rawProviderData.*`    | Top-level key merge, value replace |

---

## 5. Kafka Event Publishing

### 5.1 Trigger Point

The `ProfileEnrichmentTriggered` event fires **exactly once** — at the end of a **successful OAuth callback for a newly created user** (see §4.1, step 8). It is the signal for the Profile Enrichment Worker (a separate service) to scrape the provider's API, normalize the data, and write back to the Knowledge Base.

**Fire-and-forget semantics:** The AuthService publishes the event and does not wait for a response. If the Kafka produce fails, the event is lost — but the user can manually trigger re-enrichment via `POST /api/v1/users/me/enrich` (a compensating action).

### 5.2 Event JSON Schema

```json
{
  "$schema": "[https://json-schema.org/draft/2020-12/schema](https://json-schema.org/draft/2020-12/schema)",
  "title": "ProfileEnrichmentTriggered",
  "type": "object",
  "properties": {
    "eventId": {
      "type": "string",
      "format": "uuid",
      "description": "Unique idempotency key"
    },
    "eventType": {
      "const": "ProfileEnrichmentTriggered"
    },
    "version": {
      "const": "1.0"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "payload": {
      "type": "object",
      "properties": {
        "userId": {
          "type": "string",
          "format": "uuid"
        },
        "provider": {
          "type": "string",
          "enum": ["GITHUB", "LINKEDIN"]
        },
        "providerAccessToken": {
          "type": "string",
          "description": "Ephemeral — consumed once by the enrichment worker and discarded"
        }
      },
      "required": ["userId", "provider", "providerAccessToken"]
    }
  },
  "required": ["eventId", "eventType", "version", "timestamp", "payload"]
}
```

### 5.3 Kafka Producer Implementation

```typescript
// src/infrastructure/messaging/kafka.ts

import { Kafka, Producer, Partitioners } from "kafkajs";
import { randomUUID } from "node:crypto";

// ── Event type registry ─────────────────────────────────────────────────────

export const EventName = {
  ProfileEnrichmentTriggered: "ProfileEnrichmentTriggered",
  UserDeleted:                "UserDeleted",
  PreferencesUpdated:         "PreferencesUpdated",
} as const;

interface EventPayloads {
  [EventName.ProfileEnrichmentTriggered]: {
    userId: string;
    provider: string;
    providerAccessToken: string;
  };
  [EventName.UserDeleted]:                { userId: string };
  [EventName.PreferencesUpdated]:         { userId: string };
}

interface Envelope<E EventPayloads extends keyof> {
  eventId:   string;
  eventType: E;
  version:   string;
  timestamp: string;
  payload:   EventPayloads[E];
}

// ── Producer wrapper ────────────────────────────────────────────────────────

export class KafkaProducer {
  private producer: Producer;

  constructor(brokers: string[], clientId: string) {
    const kafka = new Kafka({ clientId, brokers });
    this.producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner, // sticky by key = userId
      allowAutoTopicCreation: false,
      retry: { retries: 3 },
    });
  }

  async start(): Promise<void> {
    await this.producer.connect();
  }

  async publish<E EventPayloads extends keyof>(
    eventType: E,
    payload: EventPayloads[E],
  ): Promise<void> {
    const message: Envelope<E> = {
      eventId:   randomUUID(),
      eventType,
      version:   "1.0",
      timestamp: new Date().toISOString(),
      payload,
    };

    await this.producer.send({
      topic: `user-kb.${eventType}`,
      messages: [
        {
          key:   (payload as any).userId,  // partition by user for ordering
          value: JSON.stringify(message),
          headers: {
            "content-type": "application/json",
            "event-version": "1.0",
          },
        },
      ],
    });
  }

  async shutdown(): Promise<void> {
    await this.producer.disconnect();
  }
}
```

**Topic naming convention:** `{service-domain}.{EventName}` — e.g., `user-kb.ProfileEnrichmentTriggered`.

---

## 6. Authentication & Middleware

### 6.1 JWT Structure

| Claim    | Access Token                  | Refresh Token         |
|----------|-------------------------------|-----------------------|
| `sub`    | User ID (UUID)                | User ID (UUID)        |
| `roles`  | `UserRole[]`                  | —                     |
| `iat`    | Issued at                     | Issued at             |
| `exp`    | 15 minutes from `iat`         | 7 days from `iat`     |
| `jti`    | Unique token ID               | Unique token ID       |
| Algorithm| **EdDSA (Ed25519)**           | EdDSA (Ed25519)       |

Refresh tokens are single-use and stored in Redis as a whitelist with the `jti` as the key. On refresh, the old `jti` is atomically deleted and a new one inserted (prevents replay).

### 6.2 `authenticate` Middleware

```typescript
// src/middleware/authenticate.ts

import { FastifyRequest, FastifyReply } from "fastify";
import { JwtService } from "../infrastructure/security/jwt.js";
import { UserRepository } from "../modules/user/user.repository.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: {
      id: string;
      email: string;
      roles: UserRole[];
    };
  }
}

export function authenticate(jwt: JwtService, userRepo: UserRepository) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Extract the Authorization header
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({
        error: "MISSING_TOKEN",
        message: "Authorization header must be: Bearer <token>",
      });
    }

    const token = header.slice(7);

    // 2. Verify the JWT signature + expiry
    const payload = await jwt.verifyAccess(token);
    if (payload.isErr()) {
      return reply.status(401).send({
        error: "INVALID_TOKEN",
        message: payload.error.message,
      });
    }

    // 3. Check if the token has been revoked (logout blocklist)
    const isRevoked = await jwt.isRevoked(payload.value.jti!);
    if (isRevoked) {
      return reply.status(401).send({
        error: "TOKEN_REVOKED",
        message: "This token has been revoked",
      });
    }

    // 4. Hydrate the user from the database (ensures user still exists)
    const user = await userRepo.findById(payload.value.sub!);
    if (!user) {
      return reply.status(401).send({
        error: "USER_NOT_FOUND",
        message: "The user associated with this token no longer exists",
      });
    }

    // 5. Attach to request context for downstream handlers
    request.currentUser = {
      id:    user.id,
      email: user.email,
      roles: user.roles,
    };
  };
}
```

### 6.3 `authorize` Middleware (Role Guard)

```typescript
// src/middleware/authorize.ts

import { FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "@prisma/client";

export function requireRole(...allowed: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Must run AFTER authenticate
    const hasRole = request.currentUser.roles.some((r) => allowed.includes(r));
    if (!hasRole) {
      return reply.status(403).send({
        error: "FORBIDDEN",
        message: `Requires one of: ${allowed.join(", ")}`,
      });
    }
  };
}

// Usage in routes:
// fastify.get("/admin/users", { preHandler: [authenticate(...), requireRole("ADMIN")] }, ...)
```

### 6.4 Token Refresh Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as AuthRoutes
    participant JWT as JwtService
    participant Redis as Redis (Cache)
    participant DB as Prisma (DB)

    Client->>API: POST /auth/refresh { refreshToken }
    
    API->>JWT: verifyRefresh(token)
    JWT-->>API: payload (sub, jti, exp)
    
    API->>Redis: GET jti
    alt jti not found (Replay Attack)
        Redis-->>API: null
        API-->>Client: 401 Unauthorized (Token Revoked/Used)
    else jti found
        Redis-->>API: valid
        API->>Redis: DEL old jti (Enforce single-use)
        
        API->>DB: findById(sub)
        DB-->>API: User details
        
        API->>JWT: signAccess() & signRefresh()
        JWT-->>API: New Tokens (new jti)
        
        API->>Redis: SET new jti (TTL: 7 days)
        API-->>Client: 200 OK (New Tokens)
    end
```

---

## Appendix A — Environment Variables

```bash
# ── Server ───────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# ── Database ─────────────────────────────────────────────────
DATABASE_URL=postgresql://user:pass@localhost:5432/user_kb

# ── JWT ──────────────────────────────────────────────────────
JWT_ED25519_PRIVATE_KEY_BASE64=<base64-encoded-raw-32-byte-seed>
JWT_ED25519_PUBLIC_KEY_BASE64=<base64-encoded-raw-32-byte-public-key>
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=604800

# ── Encryption ───────────────────────────────────────────────
ENCRYPTION_KEK_URI=vault://transit/keys/user-kb-oauth

# ── OAuth ────────────────────────────────────────────────────
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_REDIRECT_URI=[https://app.example.com/oauth/callback](https://app.example.com/oauth/callback)

LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=[https://app.example.com/oauth/callback](https://app.example.com/oauth/callback)

# ── Kafka ────────────────────────────────────────────────────
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=user-kb-service

# ── Redis ────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379/0
```

## Appendix B — Prisma Migrations & Indexing

Additional indexes (beyond those auto-generated by Prisma from `@unique` and relations):

```sql
-- Full-text search on JSONB skills array (for recruiter search)
CREATE INDEX idx_kb_skills_gin ON knowledge_bases
  USING GIN ((profile_graph -> 'skills') jsonb_path_ops);

-- Partial index: only index users with the CANDIDATE role (hot path for job matching)
CREATE INDEX idx_users_candidates ON users (email)
  WHERE roles @> '["CANDIDATE"]'::jsonb;

-- Index for refresh-token lookup in Redis (handled by Redis TTL, no DB index needed)
```

---

This LLD is ready for review. The next steps would be scaffolding the project from this structure and implementing the modules in the order: Auth → User → KnowledgeBase → Notifications.
````</E></E></E></Result<KnowledgeBase,></ProfileGraph></Result<AuthResult,></OAuthProvider,></T,E>
