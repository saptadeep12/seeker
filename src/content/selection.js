import { MAX_WORDS } from '../shared/constants.js';

/**
 * @typedef {import('../shared/types.js').CaptureError} CaptureError
 * @typedef {{ ok: true, selection: string, range: Range } | { ok: false, error: CaptureError }} SelectionResult
 */

/**
 * Reads and validates the current page selection.
 *
 * @returns {SelectionResult}
 */
export function getValidSelection() {
  const currentSelection = window.getSelection();

  if (!currentSelection || currentSelection.rangeCount === 0) {
    return emptyError();
  }

  const range = currentSelection.getRangeAt(0);
  const selection = normalizeWhitespace(currentSelection.toString());

  if (range.collapsed || !selection) {
    return emptyError();
  }

  if (isExcludedSelection(range, currentSelection)) {
    return {
      ok: false,
      error: { code: 'IN_INPUT', message: 'Select text outside form fields' }
    };
  }

  // Whitespace splitting is sufficient for v1, but does not identify words correctly
  // in languages that do not use spaces between words.
  if (countWords(selection) > MAX_WORDS) {
    return {
      ok: false,
      error: { code: 'TOO_LONG', message: 'Select up to 5 words' }
    };
  }

  return { ok: true, selection, range };
}

/**
 * @returns {{ ok: false, error: CaptureError }}
 */
function emptyError() {
  return {
    ok: false,
    error: { code: 'EMPTY', message: 'Select some text' }
  };
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  return text.split(' ').filter(Boolean).length;
}

/**
 * @param {Range} range
 * @param {Selection} currentSelection
 * @returns {boolean}
 */
function isExcludedSelection(range, currentSelection) {
  return [range.commonAncestorContainer, currentSelection.anchorNode, currentSelection.focusNode]
    .some((node) => isInsideExcludedElement(node))
    || isInsideExcludedElement(document.activeElement);
}

/**
 * @param {Node|Element|null} node
 * @returns {boolean}
 */
function isInsideExcludedElement(node) {
  const element = node instanceof Element ? node : node?.parentElement;

  if (!element) {
    return false;
  }

  const excluded = element.closest('input, textarea, select, [contenteditable]');
  if (!excluded) {
    return false;
  }

  if (excluded.matches('[contenteditable="false"]')) {
    return false;
  }

  return excluded.tagName === 'INPUT'
    || excluded.tagName === 'TEXTAREA'
    || excluded.tagName === 'SELECT'
    || excluded.hasAttribute('contenteditable');
}
