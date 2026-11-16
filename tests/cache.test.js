import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from '../src/shared/constants.js';
import { getCached, setCached } from '../src/background/cache.js';

const result = {
  word: 'word',
  sense: 'stub',
  meaning: 'meaning',
  confidence: 1,
  other_senses: []
};

describe('cache', () => {
  let stored;

  beforeEach(() => {
    stored = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: stored[key] })),
          set: vi.fn(async (value) => Object.assign(stored, value))
        }
      }
    };
  });

  it('evicts the oldest entry over the cap', async () => {
    for (let index = 0; index <= CACHE_MAX_ENTRIES; index += 1) {
      await setCached(`key-${index}`, result);
    }

    expect(Object.keys(stored['lookup-cache'])).toHaveLength(CACHE_MAX_ENTRIES);
    expect(stored['lookup-cache']['key-0']).toBeUndefined();
  });

  it('treats expired entries as misses', async () => {
    stored['lookup-cache'] = {
      expired: {
        result,
        createdAt: Date.now() - CACHE_TTL_MS - 1,
        expiresAt: Date.now() - 1
      }
    };

    await expect(getCached('expired')).resolves.toBeNull();
    expect(stored['lookup-cache'].expired).toBeUndefined();
  });
});
