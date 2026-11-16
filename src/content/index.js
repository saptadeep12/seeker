import { buildContext } from './context.js';
import * as card from './card/card.js';
import { getValidSelection } from './selection.js';
import {
  isConsentRequiredMessage,
  isCurrentRequest,
  isLookupChunkMessage,
  isLookupDoneMessage,
  isLookupErrorMessage,
  sendLookupRequest
} from '../shared/messages.js';
import { setConsent } from '../shared/consent.js';

/**
 * @typedef {import('../shared/types.js').LookupRequest} LookupRequest
 * @typedef {import('../shared/types.js').CaptureError} CaptureError
 * @typedef {{ top: number, left: number, width: number, height: number }} AnchorRect
 * @typedef {{ ok: true, request: LookupRequest, anchorRect: AnchorRect } | { ok: false, error: CaptureError }} CaptureOutcome
 */

/**
 * @param {string} text
 */
function showMessage(text) {
  card.open('Selection');
  card.showError(text);
}

async function runCapture() {
  clearResponseListener();
  card.setRetryHandler(() => {
    void runCapture();
  });
  try {
    const captured = captureRequest();
    if (!captured.ok) {
      showMessage(captured.error.message);
      return;
    }

    card.open(captured.request.selection, captured.anchorRect);
    const requestId = crypto.randomUUID();
    listenForResponse(requestId, captured.request, captured.anchorRect);
    await sendLookupRequest(requestId, captured.request);
  } catch (error) {
    console.warn('[Seeker] Unable to capture the selection.', error);
    card.open('Selection');
    card.showError('Unable to capture the selection.');
  }
}

/**
 * Captures all needed values synchronously and returns no page DOM references.
 *
 * @returns {CaptureOutcome}
 */
function captureRequest() {
  const result = getValidSelection();
  if (!result.ok) {
    return result;
  }

  const rect = result.range.getBoundingClientRect();
  const anchorRect = {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  };
  const context = buildContext(result.range, result.selection);

  return {
    ok: true,
    anchorRect,
    request: {
      selection: result.selection,
      context: context.context,
      page: context.page,
      lang: context.lang
    }
  };
}

/**
 * Replaces the previous response listener so repeated injections cannot
 * accumulate listeners or allow an older request to update the card.
 *
 * @param {string} requestId
 * @param {LookupRequest} pendingRequest
 * @param {AnchorRect} anchorRect
 */
function listenForResponse(requestId, pendingRequest, anchorRect) {
  const listener = (message) => {
    if (!isCurrentRequest(message, requestId)) {
      return false;
    }

    if (isConsentRequiredMessage(message)) {
      card.showConsent({
        onAgree: async () => {
          try {
            await setConsent();
            card.open(pendingRequest.selection, anchorRect);
            await sendLookupRequest(requestId, pendingRequest);
          } catch (error) {
            console.warn('[Seeker] Unable to save consent.', error);
            card.showError('Unable to save your privacy choice.');
          }
        },
        onNotNow: () => {
          cleanup();
          card.close();
        }
      });
    } else if (isLookupChunkMessage(message)) {
      if (message.reset) {
        card.resetMeaning();
      } else {
        card.showChunk(message.text);
      }
    } else if (isLookupDoneMessage(message)) {
      card.showResult(message.result);
      cleanup();
    } else if (isLookupErrorMessage(message)) {
      const errorMessages = {
        RATE_LIMITED: 'too many lookups, wait a moment',
        OFFLINE: "You're offline. Check your connection.",
        RETRYABLE: "couldn't resolve, try again",
        TIMEOUT: "couldn't resolve, try again"
      };
      card.showError(errorMessages[message.code] || message.message);
      cleanup();
    }
    return false;
  };
  const cleanup = () => {
    chrome.runtime.onMessage.removeListener(listener);
    if (window.__seekerResponseState?.requestId === requestId) {
      delete window.__seekerResponseState;
    }
  };

  window.__seekerResponseState = { listener, cleanup, requestId };
  chrome.runtime.onMessage.addListener(listener);
  card.setCloseHandler(cleanup);
  card.setTimeoutHandler(cleanup);
}

function clearResponseListener() {
  const active = window.__seekerResponseState;
  if (active) {
    active.cleanup();
  }
}

void runCapture();
