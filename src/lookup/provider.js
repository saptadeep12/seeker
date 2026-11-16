import { resolveStub } from './stub.js';
import {
  BACKEND_URL,
  INSTALL_TOKEN_STORAGE_KEY,
  LOOKUP_TIMEOUT_MS,
  USE_STUB
} from '../shared/constants.js';

/**
 * @typedef {import('../shared/types.js').LookupRequest} LookupRequest
 * @typedef {import('../shared/types.js').LookupChunk} LookupChunk
 * @typedef {import('../shared/types.js').LookupResult} LookupResult
 */

let installTokenPromise;

export function resetInstallTokenForTests() {
  installTokenPromise = undefined;
}

export class LookupProviderError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {boolean} retryable
   */
  constructor(code, message, retryable) {
    super(message);
    this.name = 'LookupProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * @param {LookupRequest} request
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<LookupChunk|LookupResult>}
 */
export async function* resolve(request, signal) {
  if (USE_STUB) {
    yield* resolveStub(request, signal);
    return;
  }

  const token = await getInstallToken();
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOOKUP_TIMEOUT_MS);
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${BACKEND_URL}/v1/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Install-Token': token
      },
      body: JSON.stringify({
        selection: request.selection,
        context: request.context,
        page: request.page,
        lang: request.lang
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw createHttpError(response.status);
    }
    if (!response.body) {
      throw new LookupProviderError(
        'RETRYABLE',
        'The lookup response had no body.',
        true
      );
    }

    for await (const event of readSseEvents(response.body)) {
      throwIfAborted(signal);
      if (event.event === 'meaning') {
        if (typeof event.data !== 'string') {
          throw malformedError();
        }
        yield { meaning: event.data };
      } else if (event.event === 'reset') {
        yield { meaning: '', reset: true };
      } else if (event.event === 'result') {
        yield /** @type {LookupResult} */ (event.data);
      } else if (event.event === 'error') {
        throw mapServerError(event.data);
      }
    }
  } catch (error) {
    if (signal.aborted) {
      throw createAbortError();
    }
    if (timedOut) {
      throw new LookupProviderError(
        'TIMEOUT',
        "couldn't resolve, try again",
        true
      );
    }
    if (error instanceof LookupProviderError || error?.name === 'AbortError') {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new LookupProviderError(
        'OFFLINE',
        "You're offline. Check your connection.",
        true
      );
    }
    throw new LookupProviderError(
      'RETRYABLE',
      "Couldn't resolve, try again.",
      true
    );
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * @returns {Promise<string>}
 */
async function getInstallToken() {
  if (!installTokenPromise) {
    installTokenPromise = (async () => {
      const stored = await chrome.storage.local.get(INSTALL_TOKEN_STORAGE_KEY);
      if (typeof stored[INSTALL_TOKEN_STORAGE_KEY] === 'string') {
        return stored[INSTALL_TOKEN_STORAGE_KEY];
      }
      const token = crypto.randomUUID();
      await chrome.storage.local.set({ [INSTALL_TOKEN_STORAGE_KEY]: token });
      return token;
    })().catch((error) => {
      installTokenPromise = undefined;
      throw error;
    });
  }
  return installTokenPromise;
}

/**
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<{ event: string, data: unknown }>}
 */
export async function* readSseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/gu, '\n');
      let separator;
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const event = parseSseBlock(block);
        if (event) {
          yield event;
        }
      }
      if (done) {
        if (buffer.trim()) {
          const event = parseSseBlock(buffer);
          if (event) {
            yield event;
          }
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * @param {string} block
 * @returns {{ event: string, data: unknown }|undefined}
 */
export function parseSseBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (data.length === 0) {
    return undefined;
  }
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    throw malformedError();
  }
}

/**
 * @param {number} status
 * @returns {LookupProviderError}
 */
function createHttpError(status) {
  if (status === 429) {
    return new LookupProviderError(
      'RATE_LIMITED',
      'too many lookups, wait a moment',
      true
    );
  }
  if (status === 400) {
    return new LookupProviderError(
      'INVALID_REQUEST',
      'Invalid lookup request.',
      false
    );
  }
  return new LookupProviderError('RETRYABLE', "couldn't resolve, try again", true);
}

/**
 * @param {unknown} data
 * @returns {LookupProviderError}
 */
function mapServerError(data) {
  if (!data || typeof data !== 'object') {
    return malformedError();
  }
  const error = /** @type {{ code?: unknown, message?: unknown, retryable?: unknown }} */ (data);
  const message = typeof error.message === 'string'
    ? error.message
    : "couldn't resolve, try again";
  if (error.code === 'rate_limit' || error.code === 'provider_rate_limit') {
    return new LookupProviderError('RATE_LIMITED', 'too many lookups, wait a moment', true);
  }
  if (error.code === 'invalid_request') {
    return new LookupProviderError('INVALID_REQUEST', message, false);
  }
  if (error.code === 'malformed_output') {
    return malformedError();
  }
  if (error.code === 'timeout') {
    return new LookupProviderError('TIMEOUT', "couldn't resolve, try again", true);
  }
  if (error.retryable === true) {
    return new LookupProviderError('RETRYABLE', "couldn't resolve, try again", true);
  }
  return new LookupProviderError('FAILED', message, false);
}

/**
 * @returns {LookupProviderError}
 */
function malformedError() {
  return new LookupProviderError('FAILED', "couldn't resolve, try again", false);
}

/**
 * @param {AbortSignal} signal
 */
function throwIfAborted(signal) {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError() {
  return Object.assign(new Error('The lookup was aborted.'), { name: 'AbortError' });
}
