import { describe, it, expect } from 'vitest';
import { KnowledgeBaseService } from '../kb.service.js';

// We need to access the private deepMergeProfileGraph method for testing.
// Create a minimal subclass that exposes it, or test through the public API.
// Here we use a trick: instantiate with a mock repo and call the private method via
// bracket notation (acceptable in tests).

describe('KnowledgeBaseService — deepMergeProfileGraph', () => {
  // Create a service instance with a stub repository (we only test the merge logic)
  const service = new KnowledgeBaseService({} as any);

  // Access the private method for testing
  const merge = (existing: any, incoming: any) => {
    return (service as any).deepMergeProfileGraph(existing, incoming);
  };

  // ── Scalar Overwrite ────────────────────────────────────────────────

  it('should overwrite scalar values with incoming values', () => {
    const result = merge(
      { name: 'Alice', yearsOfExperience: 3 },
      { yearsOfExperience: 5 }
    );

    expect(result.yearsOfExperience).toBe(5);
    expect(result.name).toBe('Alice'); // preserved
  });

  it('should overwrite null with incoming value', () => {
    const result = merge(
      { title: null },
      { title: 'Engineer' }
    );

    expect(result.title).toBe('Engineer');
  });

  // ── Array Merge & Deduplication ──────────────────────────────────────

  it('should concatenate and deduplicate primitive arrays', () => {
    const result = merge(
      { skills: ['TypeScript', 'Node.js'] },
      { skills: ['Node.js', 'Python', 'Docker'] }
    );

    expect(result.skills).toEqual(['TypeScript', 'Node.js', 'Python', 'Docker']);
  });

  it('should concatenate and deduplicate object arrays by JSON', () => {
    const result = merge(
      {
        experience: [
          { company: 'A', role: 'SDE' },
        ],
      },
      {
        experience: [
          { company: 'A', role: 'SDE' }, // duplicate
          { company: 'B', role: 'Senior SDE' },
        ],
      }
    );

    expect(result.experience).toHaveLength(2);
    expect(result.experience[0]).toEqual({ company: 'A', role: 'SDE' });
    expect(result.experience[1]).toEqual({ company: 'B', role: 'Senior SDE' });
  });

  // ── Nested Object Merge ──────────────────────────────────────────────

  it('should recursively merge nested objects', () => {
    const result = merge(
      {
        metadata: {
          completeness: 0.6,
          source: 'manual_input',
        },
      },
      {
        metadata: {
          completeness: 0.85,
          verified: true,
        },
      }
    );

    expect(result.metadata).toEqual({
      completeness: 0.85,  // overwritten
      source: 'manual_input', // preserved
      verified: true, // added
    });
  });

  // ── New Keys ──────────────────────────────────────────────────────────

  it('should add keys from incoming that do not exist in existing', () => {
    const result = merge(
      { skills: ['TypeScript'] },
      { education: [{ degree: 'B.S.' }] }
    );

    expect(result.skills).toEqual(['TypeScript']);
    expect(result.education).toEqual([{ degree: 'B.S.' }]);
  });

  // ── Existing Keys Not in Incoming ────────────────────────────────────

  it('should preserve all existing keys not present in incoming', () => {
    const result = merge(
      { a: 1, b: 2, c: 3 },
      { b: 20 }
    );

    expect(result).toEqual({ a: 1, b: 20, c: 3 });
  });

  // ── Edge Cases ──────────────────────────────────────────────────────

  it('should handle empty incoming object', () => {
    const existing = { skills: ['TS'], name: 'Alice' };
    const result = merge(existing, {});

    expect(result).toEqual(existing);
  });

  it('should handle empty existing object', () => {
    const incoming = { skills: ['TS'], name: 'Alice' };
    const result = merge({}, incoming);

    expect(result).toEqual(incoming);
  });

  it('should handle deeply nested structures', () => {
    const result = merge(
      { level1: { level2: { level3: { value: 'old' } } } },
      { level1: { level2: { level3: { value: 'new', extra: true } } } }
    );

    expect(result.level1.level2.level3).toEqual({
      value: 'new',
      extra: true,
    });
  });
});
