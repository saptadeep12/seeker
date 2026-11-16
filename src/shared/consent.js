import { CONSENT_VERSION } from './constants.js';

const CONSENT_STORAGE_KEY = 'seeker-consent';

/**
 * @typedef {{ granted: boolean, version: number, timestamp: number }} Consent
 */

/**
 * @returns {Promise<Consent|null>}
 */
export async function getConsent() {
  const stored = await chrome.storage.local.get(CONSENT_STORAGE_KEY);
  const consent = stored[CONSENT_STORAGE_KEY];
  if (!isConsent(consent)) {
    return null;
  }
  if (consent.version < CONSENT_VERSION) {
    return { ...consent, granted: false };
  }
  return consent;
}

/**
 * @returns {Promise<Consent>}
 */
export async function setConsent() {
  const consent = {
    granted: true,
    version: CONSENT_VERSION,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ [CONSENT_STORAGE_KEY]: consent });
  return consent;
}

export async function clearConsent() {
  await chrome.storage.local.remove(CONSENT_STORAGE_KEY);
}

/**
 * @param {unknown} value
 * @returns {value is Consent}
 */
function isConsent(value) {
  return !!value
    && typeof value === 'object'
    && value.granted === true
    && typeof value.version === 'number'
    && typeof value.timestamp === 'number';
}
