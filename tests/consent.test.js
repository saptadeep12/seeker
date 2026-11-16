import { beforeEach, describe, expect, it } from 'vitest';
import { clearConsent, getConsent, setConsent } from '../src/shared/consent.js';

const storage = {};

describe('consent storage', () => {
  beforeEach(() => {
    Object.keys(storage).forEach((key) => delete storage[key]);
    globalThis.chrome = {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (value) => Object.assign(storage, value),
          remove: async (key) => delete storage[key]
        }
      }
    };
  });

  it('stores, reads, and clears consent', async () => {
    expect(await getConsent()).toBeNull();
    const saved = await setConsent();

    expect(saved.granted).toBe(true);
    expect((await getConsent()).granted).toBe(true);
    await clearConsent();
    expect(await getConsent()).toBeNull();
  });

  it('treats an older version as not granted', async () => {
    storage['seeker-consent'] = {
      granted: true,
      version: 0,
      timestamp: Date.now()
    };

    expect((await getConsent()).granted).toBe(false);
  });
});
