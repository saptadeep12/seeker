/**
 * @typedef {import('../shared/types.js').LookupRequest} LookupRequest
 * @typedef {import('../shared/types.js').LookupChunk} LookupChunk
 * @typedef {import('../shared/types.js').LookupResult} LookupResult
 */

const DELAY_MS = 150;
const MEANING = 'Lookup not connected yet';

/**
 * Streams a local placeholder result without making network calls.
 *
 * @param {LookupRequest} request
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<LookupChunk|LookupResult>}
 */
export async function* resolveStub(request, signal) {
  const partials = ['Lookup ', 'Lookup not connected ', MEANING];

  for (const meaning of partials) {
    await delay(signal, DELAY_MS);
    throwIfAborted(signal);
    yield { meaning };
  }

  throwIfAborted(signal);
  yield {
    word: request.selection,
    sense: 'stub',
    meaning: MEANING,
    confidence: 1,
    other_senses: ['example alternative sense'],
    category: 'general'
  };
}

/**
 * @param {AbortSignal} signal
 * @param {number} duration
 * @returns {Promise<void>}
 */
function delay(signal, duration) {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const abort = () => {
      cleanup();
      reject(createAbortError());
    };

    timer = setTimeout(finish, duration);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * @param {AbortSignal} signal
 */
function throwIfAborted(signal) {
  if (signal.aborted) {
    throw createAbortError();
  }
}

/**
 * @returns {Error}
 */
function createAbortError() {
  const error = new Error('The lookup was aborted.');
  error.name = 'AbortError';
  return error;
}
