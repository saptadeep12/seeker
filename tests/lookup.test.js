import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetInstallTokenForTests, resolve } from '../src/lookup/provider.js';
import { resolveStub } from '../src/lookup/stub.js';

const request = {
  selection: 'honey',
  context: 'Thanks, honey.',
  page: { title: 'Example', domain: 'example.com' },
  lang: 'en'
};

const result = {
  meaning: 'A loved one',
  word: 'honey',
  category: 'general',
  sense: 'term of endearment',
  confidence: 0.93,
  other_senses: []
};

function responseFrom(chunks, status = 200) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader() {
        return {
          read: async () => {
            if (index >= chunks.length) {
              return { done: true, value: undefined };
            }
            return { done: false, value: encoder.encode(chunks[index++]) };
          },
          releaseLock: vi.fn()
        };
      }
    }
  };
}

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('backend lookup provider', () => {
  beforeEach(() => {
    resetInstallTokenForTests();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined)
        }
      }
    };
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'token-uuid')
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('parses SSE events split in the middle of an event', async () => {
    fetch.mockResolvedValue(responseFrom([
      'event: meaning\ndata: "A lo',
      'ved one"\n\nevent: result\ndata: ',
      `${JSON.stringify(result)}\n\n`
    ]));

    await expect(collect(resolve(request, new AbortController().signal))).resolves.toEqual([
      { meaning: 'A loved one' },
      result
    ]);
  });

  it('forwards reset events so partial meaning can be cleared', async () => {
    fetch.mockResolvedValue(responseFrom([
      sse('meaning', 'wrong'),
      sse('reset', {}),
      sse('meaning', 'right'),
      sse('result', result)
    ]));

    await expect(collect(resolve(request, new AbortController().signal))).resolves.toEqual([
      { meaning: 'wrong' },
      { meaning: '', reset: true },
      { meaning: 'right' },
      result
    ]);
  });

  it('maps HTTP and SSE errors to typed errors', async () => {
    fetch.mockResolvedValueOnce(responseFrom([], 429));
    await expect(collect(resolve(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });

    fetch.mockResolvedValueOnce(responseFrom([], 400));
    await expect(collect(resolve(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false });

    fetch.mockResolvedValueOnce(responseFrom([
      sse('error', { code: 'timeout', message: 'slow', retryable: true })
    ]));
    await expect(collect(resolve(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });

    fetch.mockResolvedValueOnce(responseFrom([
      sse('error', { code: 'malformed_output', message: 'bad', retryable: false })
    ]));
    await expect(collect(resolve(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'FAILED', retryable: false });

    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(collect(resolve(request, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'OFFLINE', retryable: true });
  });

  it('honors abort and stops a pending fetch', async () => {
    fetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    const controller = new AbortController();
    const pending = collect(resolve(request, controller.signal));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('creates the install token once and reuses it', async () => {
    fetch
      .mockResolvedValueOnce(responseFrom([sse('result', result)]))
      .mockResolvedValueOnce(responseFrom([sse('result', result)]));

    await collect(resolve(request, new AbortController().signal));
    await collect(resolve(request, new AbortController().signal));

    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers['X-Install-Token']).toBe('token-uuid');
    expect(fetch.mock.calls[1][1].headers['X-Install-Token']).toBe('token-uuid');
  });
});

describe('lookup stub', () => {
  it('remains available for offline development', async () => {
    const chunks = await collect(resolveStub(request, new AbortController().signal));

    expect(chunks.at(-1)).toMatchObject({
      word: 'honey',
      category: 'general'
    });
  });
});
