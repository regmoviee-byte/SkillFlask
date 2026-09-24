import { describe, expect, it, vi } from 'vitest';
import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('produces RFC 4122 v4 ids', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it('generates 1000 unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });

  it('falls back to getRandomValues when randomUUID is unavailable (http dev server)', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(undefined as never);
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 200 }, newId));
      expect(ids.size).toBe(200);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    } finally {
      spy.mockRestore();
    }
  });
});
