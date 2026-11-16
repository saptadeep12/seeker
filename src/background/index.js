import {
  COMMAND_LOOKUP_SELECTION,
  DEBUG,
  MAX_CONTEXT_LENGTH,
  MAX_WORDS,
  LOOKUP_REQUEST
} from '../shared/constants.js';
import { isLookupRequestMessage } from '../shared/messages.js';
import { handleLookup } from './orchestrator.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab) {
    console.warn('[Seeker] Rejected a message without a tab sender.');
    return false;
  }

  if (message?.type !== LOOKUP_REQUEST) {
    return false;
  }

  if (!isLookupRequestMessage(message) || !isSaneRequest(message)) {
    console.warn('[Seeker] Rejected a malformed lookup request.');
    sendResponse({ ok: false, error: 'Invalid lookup request' });
    return false;
  }

  if (DEBUG) {
    console.log('[Seeker] lookup request', message);
  }
  void handleLookup(message, sender.tab.id).catch(() => undefined);
  sendResponse({ ok: true, requestId: message.requestId });
  return false;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== COMMAND_LOOKUP_SELECTION || !tab?.id) {
    return;
  }

  if (isRestrictedPage(tab.url)) {
    console.warn('[Seeker] Cannot run on this page:', tab.url);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ['content.js']
    });
  } catch (error) {
    console.warn('[Seeker] Could not inject the content script.', error);
  }
});

/**
 * @param {string|undefined} url
 * @returns {boolean}
 */
function isRestrictedPage(url) {
  if (!url) {
    return false;
  }

  if (/^(chrome|chrome-extension|about|edge|view-source):/i.test(url)) {
    return true;
  }

  return /^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

/**
 * @param {{ selection: string, context: string }} request
 * @returns {boolean}
 */
function isSaneRequest(request) {
  const selection = request.selection.trim();
  const wordCount = selection ? selection.split(/\s+/u).length : 0;

  return wordCount > 0
    && wordCount <= MAX_WORDS
    && request.context.length <= MAX_CONTEXT_LENGTH;
}
