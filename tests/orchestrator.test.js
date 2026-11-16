import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveMock = vi.fn();
const sentMessages = [];
const storage = {};

vi.mock('../src/lookup/provider.js', () => ({
  resolve: (...args) => resolveMock(...args)
}));

vi.mock('../src/shared/messages.js', async () => {
  const actual = await vi.importActual('../src/shared/messages.js');
  return {
    ...actual,
    sendToTab: vi.fn((tabId, message) => {
      sentMessages.push({ tabId, message });
      return Promise.resolve();
    })
  };
});

const { handleLookup, createCacheKey, needsConsent } = await import('../src/background/orchestrator.js');

const request = (requestId, selection = 'honey', context = 'Thanks, honey.') => ({
  requestId,
  selection,
  context,
  page: { title: 'Example', domain: 'example.com' },
  lang: 'en'
});

const result = {
  word: 'honey',
  sense: 'stub',
  meaning: 'A loved one',
  confidence: 1,
  other_senses: []
};

function stream(...items) {
  return (async function* () {
    for (const item of items) {
      yield item;
    }
  })();
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('orchestrator', () => {
  beforeEach(() => {
    resolveMock.mockReset();
    sentMessages.length = 0;
    Object.keys(storage).forEach((key) => delete storage[key]);
    storage['seeker-consent'] = {
      granted: true,
      version: 1,
      timestamp: Date.now()
    };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async (key) => ({ [key]: storage[key] })),
          set: vi.fn(async (value) => Object.assign(storage, value))
        }
      }
    };
  });

  it('uses a cache hit without calling resolve', async () => {
    storage['lookup-cache'] = {
      [createCacheKey('honey', 'Thanks, honey.')]: {
        result,
        createdAt: Date.now(),
        expiresAt: Date.now() + 10000
      }
    };

    await handleLookup(request('cached'), 1);

    expect(resolveMock).not.toHaveBeenCalled();
    expect(sentMessages).toEqual([{ tabId: 1, message: expect.objectContaining({
      type: 'LOOKUP_DONE',
      requestId: 'cached',
      result
    }) }]);
  });

  it('shows consent without calling the backend', async () => {
    delete storage['seeker-consent'];

    await handleLookup(request('consent'), 1);

    expect(resolveMock).not.toHaveBeenCalled();
    expect(sentMessages).toEqual([{
      tabId: 1,
      message: { type: 'CONSENT_REQUIRED', requestId: 'consent' }
    }]);
  });

  it('re-asks when consent is from an older version', async () => {
    storage['seeker-consent'].version = 0;

    await handleLookup(request('old-consent'), 1);

    expect(resolveMock).not.toHaveBeenCalled();
    expect(sentMessages[0].message.type).toBe('CONSENT_REQUIRED');
  });

  it('bypasses the gate when the stub is enabled', () => {
    expect(needsConsent(null, true)).toBe(false);
  });

  it('deduplicates identical simultaneous requests', async () => {
    let release;
    resolveMock.mockImplementation(() => (async function* () {
      await new Promise((resolve) => {
        release = resolve;
      });
      yield { meaning: 'A loved one' };
      yield result;
    })());

    const first = handleLookup(request('one'), 1);
    const second = handleLookup(request('two'), 2);
    await flush();
    expect(resolveMock).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(sentMessages.filter(({ message }) => message.type === 'LOOKUP_DONE')).toHaveLength(2);
  });

  it('aborts a previous lookup from the same tab', async () => {
    const signals = [];
    const releases = [];
    resolveMock.mockImplementation((_request, signal) => {
      signals.push(signal);
      return (async function* () {
        await new Promise((resolve) => releases.push(resolve));
        if (signal.aborted) {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }
        yield result;
      })();
    });

    const first = handleLookup(request('old'), 1);
    await flush();
    const second = handleLookup(request('new', 'bank', 'river bank'), 1);
    await flush();

    expect(signals[0].aborted).toBe(true);
    expect(sentMessages.some(({ message }) => message.requestId === 'old')).toBe(false);
    releases.forEach((release) => release());
    await Promise.all([first, second]);
  });

  it('does not send stale chunks after a tab starts a newer lookup', async () => {
    let releaseOld;
    let releaseNew;
    resolveMock.mockImplementation((lookupRequest) => (async function* () {
      await new Promise((resolve) => {
        if (lookupRequest.selection === 'honey') {
          releaseOld = resolve;
        } else {
          releaseNew = resolve;
        }
      });
      yield lookupRequest.selection === 'honey'
        ? { meaning: 'stale chunk' }
        : result;
    })());

    const oldLookup = handleLookup(request('old'), 1);
    await flush();
    const newLookup = handleLookup(request('new', 'bank', 'river bank'), 1);
    await flush();

    releaseOld();
    await flush();
    expect(sentMessages.some(({ message }) => message.requestId === 'old')).toBe(false);

    releaseNew();
    await Promise.all([oldLookup, newLookup]);
  });

  it('does not cache provider errors', async () => {
    resolveMock.mockImplementation(async function* () {
      throw new Error('failed');
    });

    await handleLookup(request('failed'), 1);

    expect(sentMessages).toEqual([{
      tabId: 1,
      message: expect.objectContaining({ type: 'LOOKUP_ERROR', code: 'FAILED' })
    }]);
    expect(storage['lookup-cache']).toBeUndefined();
  });
});
