import styles from './card.css?inline';
import { getCardPosition } from './positioning.js';
import {
  PRIVACY_POLICY_URL,
  LOOKUP_TIMEOUT_MS,
  LOW_CONFIDENCE_THRESHOLD
} from '../../shared/constants.js';

const MAX_MEANING_LENGTH = 2000;
const DEFAULT_ANCHOR = { top: 16, left: 16, width: 0, height: 0 };

let host;
let shadow;
let elements;
let state = 'idle';
let meaning = '';
let listenersAttached = false;
let timeoutId;
let retryHandler = () => {};
let closeHandler = () => {};
let timeoutHandler = () => {};
let consentAgreeHandler = async () => {};
let consentNotNowHandler = () => {};

/**
 * Opens or replaces the single result card. The open shadow root keeps the
 * card inspectable while isolating its styles from the host page.
 *
 * @param {string} wordPreview
 * @param {{ top: number, left: number, width: number, height: number }} anchorRect
 */
export function open(wordPreview, anchorRect = DEFAULT_ANCHOR) {
  ensureCard();
  state = 'loading';
  meaning = '';
  elements.word.textContent = wordPreview || 'Selection';
  elements.resultContent.hidden = false;
  elements.consent.hidden = true;
  elements.meaning.textContent = 'Looking up…';
  elements.meaning.classList.remove('error');
  elements.also.hidden = true;
  elements.also.setAttribute('aria-expanded', 'false');
  elements.senses.replaceChildren();
  elements.senses.hidden = true;
  elements.technical.hidden = true;
  elements.domain.hidden = true;
  elements.example.hidden = true;
  elements.retry.hidden = true;
  host.hidden = false;
  positionCard(anchorRect);
  attachListeners();
  clearTimeout(timeoutId);
  timeoutId = setTimeout(() => {
    timeoutHandler();
    showError("couldn't resolve, try again");
  }, LOOKUP_TIMEOUT_MS);
}

/**
 * @param {string} text
 */
export function showChunk(text) {
  if (!host) {
    return;
  }
  state = 'streaming';
  const next = text.slice(0, MAX_MEANING_LENGTH);
  meaning = next.startsWith(meaning) ? next : `${meaning}${next}`;
  elements.meaning.textContent = meaning;
  elements.meaning.classList.remove('error');
}

export function resetMeaning() {
  if (!host) {
    return;
  }
  meaning = '';
  elements.meaning.textContent = '';
}

/**
 * @param {{ word: string, meaning: string, other_senses: string[], confidence: number, category?: string, domain?: string|null, example?: string|null }} result
 */
export function showResult(result) {
  if (!host) {
    return;
  }
  state = 'done';
  clearTimeout(timeoutId);
  elements.word.textContent = result.word;
  meaning = result.meaning.slice(0, MAX_MEANING_LENGTH);
  elements.meaning.textContent = meaning;
  elements.meaning.classList.remove('error');
  renderTechnicalDetails(result);

  const senses = result.other_senses.slice(0, 1);
  if (result.confidence < LOW_CONFIDENCE_THRESHOLD && senses.length > 0) {
    renderSenseOptions([result.meaning, ...senses]);
    elements.also.hidden = true;
    elements.senses.hidden = false;
  } else {
    renderSenseOptions(result.other_senses);
    elements.also.hidden = result.other_senses.length === 0;
    elements.senses.hidden = true;
  }
  elements.also.setAttribute('aria-expanded', 'false');
}

/**
 * @param {string} message
 */
export function showError(message) {
  ensureCard();
  state = 'error';
  clearTimeout(timeoutId);
  elements.resultContent.hidden = false;
  elements.consent.hidden = true;
  elements.meaning.textContent = message.slice(0, MAX_MEANING_LENGTH);
  elements.meaning.classList.add('error');
  elements.also.hidden = true;
  elements.senses.hidden = true;
  elements.technical.hidden = true;
  elements.retry.hidden = false;
  host.hidden = false;
  positionCard(DEFAULT_ANCHOR);
  attachListeners();
}

/**
 * @param {{ onAgree: () => void|Promise<void>, onNotNow: () => void }} handlers
 */
export function showConsent(handlers) {
  ensureCard();
  state = 'consent';
  clearTimeout(timeoutId);
  elements.resultContent.hidden = true;
  elements.consent.hidden = false;
  consentAgreeHandler = handlers.onAgree;
  consentNotNowHandler = handlers.onNotNow;
  host.hidden = false;
  positionCard(DEFAULT_ANCHOR);
  attachListeners();
  elements.agree.focus();
}

export function close() {
  if (!host) {
    return;
  }
  closeHandler();
  detachListeners();
  clearTimeout(timeoutId);
  delete host.__seekerCardClose;
  delete host.__seekerCardDetach;
  host.remove();
  host = undefined;
  shadow = undefined;
  elements = undefined;
  state = 'idle';
  meaning = '';
  closeHandler = () => {};
  timeoutHandler = () => {};
  consentAgreeHandler = async () => {};
  consentNotNowHandler = () => {};
}

/**
 * @param {() => void} handler
 */
export function setRetryHandler(handler) {
  retryHandler = handler;
}

/**
 * @param {() => void} handler
 */
export function setCloseHandler(handler) {
  closeHandler = handler;
}

/**
 * @param {() => void} handler
 */
export function setTimeoutHandler(handler) {
  timeoutHandler = handler;
}

/**
 * @returns {string}
 */
export function getState() {
  return state;
}

function ensureCard() {
  if (host?.isConnected && elements) {
    return;
  }

  host = document.documentElement.querySelector('seeker-result-card');
  if (host?.shadowRoot) {
    host.__seekerCardDetach?.();
    host.__seekerCardClose = close;
    shadow = host.shadowRoot;
    elements = getElements(shadow);
    return;
  }

  host = document.createElement('seeker-result-card');
  shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${styles}</style>
    <section class="card" role="dialog" aria-label="Seeker result">
      <div class="header">
        <div class="word"></div>
        <button class="close" type="button" aria-label="Close">×</button>
      </div>
      <div class="result-content">
        <div class="meaning" aria-live="polite"></div>
        <div class="technical" hidden>
          <div class="domain" hidden><span class="detail-label">Domain:</span> <span class="domain-value"></span></div>
          <div class="example" hidden><span class="detail-label">Example:</span> <span class="example-value"></span></div>
        </div>
        <button class="also" type="button" aria-controls="also-senses" aria-expanded="false" hidden>also means…</button>
        <button class="retry" type="button" hidden>Try again</button>
        <ul id="also-senses" class="also-senses" hidden></ul>
      </div>
      <div class="consent" hidden>
        <p>Seeker needs to send some text to find the right meaning.</p>
        <p>When you press the hotkey on a selection, Seeker sends: the word or phrase you selected, about 100 characters of text around it, the page title and website address, and the page language. It also sends a random anonymous install ID that is not linked to who you are.</p>
        <p>Seeker never sends: the rest of the page, form fields, your browsing history, or your identity.</p>
        <p>The text is processed by an AI model provider to work out the meaning. Seeker does not store it. Nothing is sent until you agree.</p>
        <a class="privacy-policy" hidden target="_blank" rel="noopener noreferrer">Privacy policy</a>
        <div class="consent-actions">
          <button class="agree" type="button">Agree</button>
          <button class="not-now" type="button">Not now</button>
        </div>
      </div>
    </section>`;
  elements = getElements(shadow);
  host.hidden = true;
  document.documentElement.append(host);
  host.__seekerCardClose = close;
  if (PRIVACY_POLICY_URL) {
    elements.privacyPolicy.href = PRIVACY_POLICY_URL;
    elements.privacyPolicy.hidden = false;
  }
  elements.close.addEventListener('click', () => host.__seekerCardClose?.());
  elements.also.addEventListener('click', () => {
    elements.senses.hidden = !elements.senses.hidden;
    elements.also.setAttribute('aria-expanded', String(!elements.senses.hidden));
  });
  elements.retry.addEventListener('click', () => retryHandler());
  elements.agree.addEventListener('click', () => void consentAgreeHandler());
  elements.notNow.addEventListener('click', () => consentNotNowHandler());
}

/**
 * @param {ShadowRoot} root
 * @returns {Record<string, Element>}
 */
function getElements(root) {
  return {
    card: root.querySelector('.card'),
    word: root.querySelector('.word'),
    resultContent: root.querySelector('.result-content'),
    meaning: root.querySelector('.meaning'),
    technical: root.querySelector('.technical'),
    domain: root.querySelector('.domain'),
    domainValue: root.querySelector('.domain-value'),
    example: root.querySelector('.example'),
    exampleValue: root.querySelector('.example-value'),
    close: root.querySelector('.close'),
    also: root.querySelector('.also'),
    retry: root.querySelector('.retry'),
    senses: root.querySelector('.also-senses'),
    consent: root.querySelector('.consent'),
    privacyPolicy: root.querySelector('.privacy-policy'),
    agree: root.querySelector('.agree'),
    notNow: root.querySelector('.not-now')
  };
}

/**
 * @param {string[]} senses
 */
function renderSenseOptions(senses) {
  elements.senses.replaceChildren(
    ...senses.map((sense) => {
      const item = document.createElement('li');
      item.textContent = sense.slice(0, MAX_MEANING_LENGTH);
      return item;
    })
  );
}

/**
 * @param {{ category?: string, domain?: string|null, example?: string|null }} result
 */
function renderTechnicalDetails(result) {
  const technical = result.category === 'technical';
  const hasDomain = technical && typeof result.domain === 'string' && result.domain.length > 0;
  const hasExample = technical && typeof result.example === 'string' && result.example.length > 0;
  elements.domain.hidden = !hasDomain;
  elements.example.hidden = !hasExample;
  elements.technical.hidden = !hasDomain && !hasExample;
  elements.domainValue.textContent = hasDomain
    ? result.domain.slice(0, MAX_MEANING_LENGTH)
    : '';
  elements.exampleValue.textContent = hasExample
    ? result.example.slice(0, MAX_MEANING_LENGTH)
    : '';
}

function positionCard(anchorRect) {
  const position = getCardPosition(anchorRect, {
    width: 320,
    height: 180
  });
  host.style.top = `${position.top}px`;
  host.style.left = `${position.left}px`;
}

function attachListeners() {
  if (listenersAttached) {
    return;
  }
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  host.__seekerCardDetach = detachListeners;
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) {
    return;
  }
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('pointerdown', onPointerDown, true);
  if (host) {
    delete host.__seekerCardDetach;
  }
  listenersAttached = false;
}

function onKeyDown(event) {
  if (event.key === 'Escape') {
    host?.__seekerCardClose?.();
  }
}

function onPointerDown(event) {
  if (!event.composedPath().includes(host)) {
    host?.__seekerCardClose?.();
  }
}
