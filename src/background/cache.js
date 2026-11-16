import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from '../shared/constants.js';

const STORAGE_KEY = 'lookup-cache';

/**
 * @typedef {import('../shared/types.js').LookupResult} LookupResult
 * @typedef {{ result: LookupResult, expiresAt: number, createdAt: number }} CacheEntry
 * @typedef {Record<string, CacheEntry>} CacheStore
 */

/**
 * @param {string} key
 * @returns {Promise<LookupResult|null>}
 */
export async function getCached(key) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const store = isStore(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : {};
    const entry = store[key];

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      delete store[key];
      await writeStore(store);
      return null;
    }

    return entry.result;
  } catch (error) {
    console.warn('[Seeker] Cache read failed.', error);
    return null;
  }
}

/**
 * @param {string} key
 * @param {LookupResult} result
 * @returns {Promise<void>}
 */
export async function setCached(key, result) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const store = isStore(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : {};
    store[key] = {
      result,
      createdAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS
    };

    const keys = Object.keys(store);
    keys.sort((a, b) => store[a].createdAt - store[b].createdAt);
    while (keys.length > CACHE_MAX_ENTRIES) {
      delete store[keys.shift()];
    }

    await writeStore(store);
  } catch (error) {
    console.warn('[Seeker] Cache write failed.', error);
  }
}

/**
 * @param {CacheStore} store
 * @returns {Promise<void>}
 */
async function writeStore(store) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: store });
  } catch (error) {
    console.warn('[Seeker] Cache storage unavailable.', error);
  }
}

/**
 * @param {unknown} value
 * @returns {value is CacheStore}
 */
function isStore(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
