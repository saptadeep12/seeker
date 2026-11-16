import { CONTEXT_CHARS } from '../shared/constants.js';

const BLOCK_TAGS = new Set([
  'P', 'LI', 'DIV', 'BLOCKQUOTE', 'TD', 'TH', 'ARTICLE', 'SECTION', 'MAIN',
  'HEADER', 'FOOTER', 'ASIDE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
]);
const MAX_BLOCK_TEXT_LENGTH = 100_000;

/**
 * @typedef {{ context: string, page: { title: string, domain: string }, lang: string }} ContextCapture
 */

/**
 * Builds a bounded context snapshot without retaining page DOM references.
 *
 * @param {Range} range
 * @param {string} selection
 * @returns {ContextCapture}
 */
export function buildContext(range, selection) {
  const normalizedSelection = normalizeWhitespace(selection);
  const metadata = getPageMetadata(range);

  try {
    const block = findBlock(range);
    const blockText = block?.textContent ?? '';
    if (blockText.length > MAX_BLOCK_TEXT_LENGTH) {
      return { ...metadata, context: normalizedSelection };
    }
    const offsets = getRangeOffsets(block, range);

    if (!blockText || !offsets || !normalizedSelection) {
      return { ...metadata, context: normalizedSelection };
    }

    return {
      ...metadata,
      context: trimContext(blockText, offsets.start, offsets.end, normalizedSelection)
    };
  } catch {
    return { ...metadata, context: normalizedSelection };
  }
}

/**
 * @param {Range} range
 * @returns {Element}
 */
function findBlock(range) {
  let element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? /** @type {Element} */ (range.commonAncestorContainer)
    : range.commonAncestorContainer.parentElement;

  while (element && !BLOCK_TAGS.has(element.tagName)) {
    element = element.parentElement;
  }

  return element ?? document.body;
}

/**
 * Converts DOM range boundaries to offsets in the block's unnormalized textContent.
 *
 * @param {Element} block
 * @param {Range} range
 * @returns {{ start: number, end: number }|null}
 */
function getRangeOffsets(block, range) {
  const startRange = document.createRange();
  startRange.selectNodeContents(block);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(block);
  endRange.setEnd(range.endContainer, range.endOffset);

  const start = startRange.toString().length;
  const end = endRange.toString().length;
  return end >= start ? { start, end } : null;
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
 * @param {number} selectionStart
 * @param {number} selectionEnd
 * @param {string} selection
 * @returns {string}
 */
function trimContext(text, selectionStart, selectionEnd, selection) {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const beforeCut = start > CONTEXT_CHARS;
  const afterCut = text.length - end > CONTEXT_CHARS;
  let contextStart = beforeCut ? moveToWordStart(text, start - CONTEXT_CHARS) : 0;
  let contextEnd = afterCut
    ? moveToWordEnd(text, end + CONTEXT_CHARS)
    : text.length;

  if (contextStart > start) {
    contextStart = start;
  }
  if (contextEnd < end) {
    contextEnd = end;
  }

  const body = normalizeWhitespace(text.slice(contextStart, contextEnd));
  if (!body) {
    return selection;
  }

  return `${beforeCut ? '... ' : ''}${body}${afterCut ? ' ...' : ''}`.trim();
}

/**
 * Moves a context start inward to avoid beginning in the middle of a word.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function moveToWordStart(text, offset) {
  if (offset <= 0 || /\s/u.test(text[offset - 1] ?? '')) {
    return offset;
  }
  let boundary = offset;
  while (boundary < text.length && !/\s/u.test(text[boundary])) {
    boundary += 1;
  }
  return boundary < text.length ? boundary + 1 : text.length;
}

/**
 * Moves a context end inward to avoid ending in the middle of a word.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function moveToWordEnd(text, offset) {
  if (offset >= text.length || /\s/u.test(text[offset] ?? '')) {
    return offset;
  }
  let boundary = offset;
  while (boundary > 0 && !/\s/u.test(text[boundary - 1])) {
    boundary -= 1;
  }
  return boundary;
}

/**
 * @param {Range} range
 * @returns {{ page: { title: string, domain: string }, lang: string }}
 */
function getPageMetadata(range) {
  const source = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? /** @type {Element} */ (range.commonAncestorContainer)
    : range.commonAncestorContainer.parentElement;
  const language = source?.closest('[lang]')?.getAttribute('lang')
    || document.documentElement.getAttribute('lang')
    || 'und';

  return {
    page: { title: document.title, domain: window.location.hostname },
    lang: language
  };
}
