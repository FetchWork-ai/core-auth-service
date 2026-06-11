import { KnowledgeBase } from '@prisma/client';
import { Result } from '../../shared/result.js';
import { NotFoundError, ConcurrencyConflictError } from '../../shared/errors.js';
import { KnowledgeBaseRepository } from './kb.repository.js';

export interface KnowledgeBaseResponse {
  id: string;
  userId: string;
  profileGraph: any;
  version: number;
  lastEnrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class KnowledgeBaseService {
  constructor(private readonly kbRepo: KnowledgeBaseRepository) {}

  // ── Get Knowledge Base ───────────────────────────────────────────────────

  async getKnowledgeBase(userId: string): Promise<Result<KnowledgeBaseResponse, NotFoundError>> {
    const result = await this.kbRepo.findByUserId(userId);
    if (result.isErr()) {
      return Result.err(new NotFoundError('Knowledge base not found'));
    }

    const kb = result.value;
    if (!kb) {
      return Result.err(new NotFoundError('Knowledge base not found'));
    }

    return Result.ok(this.serialize(kb));
  }

  // ── Upsert Profile Graph (with deep merge + optimistic concurrency) ──────

  async upsertProfileGraph(
    userId: string,
    incoming: any,
    expectedVersion: number
  ): Promise<Result<KnowledgeBaseResponse, NotFoundError | ConcurrencyConflictError | Error>> {
    // 1. Fetch existing KB (if any)
    const existingResult = await this.kbRepo.findByUserId(userId);
    if (existingResult.isErr()) {
      return Result.err(existingResult.error);
    }

    const existing = existingResult.value;
    let mergedGraph: any;
    let newVersion: number;

    if (existing) {
      // 2. Optimistic concurrency check
      if (existing.version !== expectedVersion) {
        return Result.err(
          new ConcurrencyConflictError(
            `Version mismatch: expected ${expectedVersion}, but current is ${existing.version}. Please reload and try again.`
          )
        );
      }

      // 3. Deep merge the existing profile graph with the incoming data
      mergedGraph = this.deepMergeProfileGraph(
        existing.profileGraph as Record<string, any>,
        incoming
      );
      newVersion = existing.version + 1;
    } else {
      // First time — no merge needed, just use the incoming graph
      mergedGraph = incoming;
      newVersion = 1;
    }

    // 4. Persist
    const upsertResult = await this.kbRepo.upsert(userId, {
      profileGraph: mergedGraph,
      version: newVersion,
      lastEnrichedAt: new Date(),
    });

    if (upsertResult.isErr()) {
      return Result.err(upsertResult.error);
    }

    return Result.ok(this.serialize(upsertResult.value));
  }

  // ── Delete Knowledge Base ────────────────────────────────────────────────

  async deleteKnowledgeBase(userId: string): Promise<Result<void, NotFoundError>> {
    return this.kbRepo.delete(userId);
  }

  // ── Deep Merge Profile Graph ─────────────────────────────────────────────
  //
  // Merge rules:
  //   - Arrays: concatenate and deduplicate (by value for primitives, by JSON for objects)
  //   - Objects: recursively merge
  //   - Scalars: incoming value overwrites existing
  //

  private deepMergeProfileGraph(existing: any, incoming: any): any {
    // If either side is not a plain object, incoming wins
    if (!this.isPlainObject(existing) || !this.isPlainObject(incoming)) {
      return incoming;
    }

    const merged: Record<string, any> = { ...existing };

    for (const key of Object.keys(incoming)) {
      const existingVal = existing[key];
      const incomingVal = incoming[key];

      if (Array.isArray(existingVal) && Array.isArray(incomingVal)) {
        // Concatenate and deduplicate arrays
        merged[key] = this.deduplicateArray([...existingVal, ...incomingVal]);
      } else if (this.isPlainObject(existingVal) && this.isPlainObject(incomingVal)) {
        // Recursively merge nested objects
        merged[key] = this.deepMergeProfileGraph(existingVal, incomingVal);
      } else {
        // Scalar or type mismatch: incoming wins
        merged[key] = incomingVal;
      }
    }

    return merged;
  }

  private isPlainObject(value: any): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private deduplicateArray(arr: any[]): any[] {
    const seen = new Set<string>();
    const result: any[] = [];

    for (const item of arr) {
      const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }

  // ── Serialization ────────────────────────────────────────────────────────

  private serialize(kb: KnowledgeBase): KnowledgeBaseResponse {
    return {
      id: kb.id,
      userId: kb.userId,
      profileGraph: kb.profileGraph,
      version: kb.version,
      lastEnrichedAt: kb.lastEnriched?.toISOString() ?? null,
      createdAt: kb.createdAt.toISOString(),
      updatedAt: kb.updatedAt.toISOString(),
    };
  }
}