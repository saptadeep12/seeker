import { resolve } from '../lookup/provider.js';
import {
  createConsentRequired,
  createLookupChunk,
  createLookupDone,
  createLookupError,
  sendToTab
} from '../shared/messages.js';
import { getConsent } from '../shared/consent.js';
import { USE_STUB } from '../shared/constants.js';
import { getCached, setCached } from './cache.js';

/**
 * @typedef {import('../shared/types.js').LookupRequest} LookupRequest
 * @typedef {import('../shared/types.js').LookupResult} LookupResult
 * @typedef {{ requestId: string, tabId: number, request: LookupRequest, controller: AbortController, subscribers: Map<number, string>, promise: Promise<void> }} InFlight
 */

/** @type {Map<string, InFlight>} */
const inFlight = new Map();
/** @type {Map<number, { key: string, requestId: string, controller: AbortController }>} */
const activeByTab = new Map();

/**
 * Handles a lookup request, including cache, deduplication, and cancellation.
 *
 * @param {LookupRequest & { requestId: string }} request
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function handleLookup(request, tabId) {
  const { requestId, ...lookupRequest } = request;
  const key = createCacheKey(lookupRequest.selection, lookupRequest.context);
  cancelTab(tabId);

  const consent = USE_STUB ? { granted: true } : await getConsent();
  if (needsConsent(consent)) {
    await sendToTab(tabId, createConsentRequired(requestId));
    return;
  }

  const cached = await getCached(key);
  if (cached) {
    await sendToTab(tabId, createLookupDone(requestId, cached));
    return;
  }

  let entry = inFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      requestId,
      tabId,
      request: lookupRequest,
      controller,
      subscribers: new Map(),
      promise: undefined
    };
    inFlight.set(key, entry);
  }

  entry.subscribers.set(tabId, requestId);
  activeByTab.set(tabId, { key, requestId, controller: entry.controller });
  if (!entry.promise) {
    entry.promise = runLookup(key, entry);
  }
  await entry.promise;
}

/**
 * @param {{ granted?: boolean }|null} consent
 * @param {boolean} [useStub]
 * @returns {boolean}
 */
export function needsConsent(consent, useStub = USE_STUB) {
  return !useStub && !consent?.granted;
}

/**
 * @param {string} key
 * @param {InFlight} entry
 * @returns {Promise<void>}
 */
async function runLookup(key, entry) {
  try {
    let finalResult;
    for await (const chunk of resolve(entry.request, entry.controller.signal)) {
      if (entry.controller.signal.aborted) {
        return;
      }

      if ('meaning' in chunk && !('word' in chunk)) {
        await sendToSubscribers(entry, (requestId) => createLookupChunk(
          requestId,
          chunk.meaning,
          chunk.reset === true
        ));
      } else {
        finalResult = /** @type {LookupResult} */ (chunk);
      }
    }

    if (entry.controller.signal.aborted || !finalResult) {
      return;
    }

    await setCached(key, finalResult);
    await sendToSubscribers(entry, (requestId) => createLookupDone(requestId, finalResult));
  } catch (error) {
    if (entry.controller.signal.aborted || error?.name === 'AbortError') {
      return;
    }
    await sendToSubscribers(entry, (requestId) => createLookupError(
      requestId,
      error?.code || 'FAILED',
      error?.message || 'Lookup failed.'
    ));
  } finally {
    if (inFlight.get(key) === entry) {
      inFlight.delete(key);
    }
    for (const [tabId, active] of activeByTab) {
      if (active.key === key && active.controller === entry.controller) {
        activeByTab.delete(tabId);
      }
    }
  }
}

/**
 * @param {InFlight} entry
 * @param {(requestId: string) => object} createMessage
 * @returns {Promise<void>}
 */
async function sendToSubscribers(entry, createMessage) {
  const sends = [];
  for (const [tabId, requestId] of entry.subscribers) {
    if (entry.controller.signal.aborted) {
      return;
    }
    sends.push(sendToTab(tabId, createMessage(requestId)).catch(() => undefined));
  }
  await Promise.all(sends);
}

/**
 * @param {number} tabId
 */
function cancelTab(tabId) {
  const active = activeByTab.get(tabId);
  if (!active) {
    return;
  }
  activeByTab.delete(tabId);
  const entry = inFlight.get(active.key);
  if (!entry) {
    active.controller.abort();
    return;
  }
  entry.subscribers.delete(tabId);
  if (entry.subscribers.size === 0) {
    active.controller.abort();
    if (inFlight.get(active.key) === entry) {
      inFlight.delete(active.key);
    }
  }
}

/**
 * @param {string} selection
 * @param {string} context
 * @returns {string}
 */
export function createCacheKey(selection, context) {
  const word = selection.trim().replace(/\s+/gu, ' ').toLowerCase();
  return `${word}:${shortHash(context.trim().replace(/\s+/gu, ' '))}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
