import {
  LOOKUP_CHUNK,
  LOOKUP_DONE,
  LOOKUP_ERROR,
  LOOKUP_REQUEST,
  CONSENT_REQUIRED
} from './constants.js';

/**
 * @typedef {import('./types.js').LookupRequest} LookupRequest
 * @typedef {import('./types.js').LookupRequestMessage} LookupRequestMessage
 * @typedef {import('./types.js').LookupChunkMessage} LookupChunkMessage
 * @typedef {import('./types.js').LookupDoneMessage} LookupDoneMessage
 * @typedef {import('./types.js').LookupErrorMessage} LookupErrorMessage
 */

/**
 * @param {string} requestId
 * @param {LookupRequest} request
 * @returns {Promise<unknown>}
 */
export function sendLookupRequest(requestId, request) {
  return chrome.runtime.sendMessage({
    type: LOOKUP_REQUEST,
    requestId,
    ...request
  });
}

/**
 * @param {number} tabId
 * @param {LookupChunkMessage|LookupDoneMessage|LookupErrorMessage} message
 * @returns {Promise<unknown>}
 */
export function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * @param {string} requestId
 * @param {string} text
 * @param {boolean} [reset]
 * @returns {LookupChunkMessage}
 */
export function createLookupChunk(requestId, text, reset = false) {
  return { type: LOOKUP_CHUNK, requestId, text, ...(reset ? { reset: true } : {}) };
}

/**
 * @param {string} requestId
 * @param {import('./types.js').LookupResult} result
 * @returns {LookupDoneMessage}
 */
export function createLookupDone(requestId, result) {
  return { type: LOOKUP_DONE, requestId, result };
}

/**
 * @param {string} requestId
 * @param {'ABORTED'|'FAILED'|'RETRYABLE'|'TIMEOUT'|'RATE_LIMITED'|'INVALID_REQUEST'|'OFFLINE'} code
 * @param {string} message
 * @returns {LookupErrorMessage}
 */
export function createLookupError(requestId, code, message) {
  return { type: LOOKUP_ERROR, requestId, code, message };
}

/**
 * @param {string} requestId
 * @returns {import('./types.js').ConsentRequiredMessage}
 */
export function createConsentRequired(requestId) {
  return { type: CONSENT_REQUIRED, requestId };
}

/**
 * @param {unknown} message
 * @returns {message is LookupRequestMessage}
 */
export function isLookupRequestMessage(message) {
  if (!isObject(message) || message.type !== LOOKUP_REQUEST || !isRequestId(message.requestId)) {
    return false;
  }

  return isLookupRequest(message);
}

/**
 * @param {unknown} message
 * @returns {message is LookupChunkMessage}
 */
export function isLookupChunkMessage(message) {
  return isObject(message)
    && message.type === LOOKUP_CHUNK
    && isRequestId(message.requestId)
    && typeof message.text === 'string'
    && (message.reset === undefined || typeof message.reset === 'boolean');
}

/**
 * @param {unknown} message
 * @returns {message is LookupDoneMessage}
 */
export function isLookupDoneMessage(message) {
  return isObject(message)
    && message.type === LOOKUP_DONE
    && isRequestId(message.requestId)
    && isResult(message.result);
}

/**
 * @param {unknown} message
 * @returns {message is LookupErrorMessage}
 */
export function isLookupErrorMessage(message) {
  return isObject(message)
    && message.type === LOOKUP_ERROR
    && isRequestId(message.requestId)
    && [
      'ABORTED',
      'FAILED',
      'RETRYABLE',
      'TIMEOUT',
      'RATE_LIMITED',
      'INVALID_REQUEST',
      'OFFLINE'
    ].includes(message.code)
    && typeof message.message === 'string';
}

/**
 * @param {unknown} message
 * @returns {message is import('./types.js').ConsentRequiredMessage}
 */
export function isConsentRequiredMessage(message) {
  return isObject(message)
    && message.type === CONSENT_REQUIRED
    && isRequestId(message.requestId);
}

/**
 * Future result cards should call this before applying any response.
 *
 * @param {unknown} message
 * @param {string} currentRequestId
 * @returns {boolean}
 */
export function isCurrentRequest(message, currentRequestId) {
  return isObject(message)
    && isRequestId(message.requestId)
    && message.requestId === currentRequestId;
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
function isLookupRequest(message) {
  const page = message.page;
  return typeof message.selection === 'string'
    && typeof message.context === 'string'
    && typeof message.lang === 'string'
    && isObject(page)
    && typeof page.title === 'string'
    && typeof page.domain === 'string';
}

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function isResult(result) {
  return isObject(result)
    && typeof result.word === 'string'
    && typeof result.sense === 'string'
    && typeof result.meaning === 'string'
    && typeof result.confidence === 'number'
    && Array.isArray(result.other_senses)
    && result.other_senses.every((sense) => typeof sense === 'string');
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return !!value && typeof value === 'object';
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isRequestId(value) {
  return typeof value === 'string' && value.length > 0;
}
