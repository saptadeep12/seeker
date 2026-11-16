/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { getValidSelection } from '../src/content/selection.js';

function loadFixture(name) {
  document.body.innerHTML = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', name),
    'utf8'
  );
}

function selectText(node, start = 0, end = node.textContent.length) {
  const range = document.createRange();
  range.setStart(node.firstChild, start);
  range.setEnd(node.lastChild ?? node.firstChild, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

describe('getValidSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection().removeAllRanges();
  });

  it('normalizes whitespace in a plain paragraph', () => {
    loadFixture('plain-paragraph.html');
    const paragraph = document.querySelector('#plain');
    paragraph.firstChild.textContent = '  A   little   context  ';
    selectText(paragraph);

    expect(getValidSelection()).toMatchObject({
      ok: true,
      selection: 'A little context'
    });
  });

  it('supports a selection across inline elements', () => {
    loadFixture('inline-elements.html');
    const paragraph = document.querySelector('#inline');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    expect(getValidSelection()).toMatchObject({
      ok: true,
      selection: 'Read bold selected word.'
    });
  });

  it('rejects selections in inputs and textareas', () => {
    loadFixture('form-fields.html');
    const outside = document.querySelector('#outside');
    const input = document.querySelector('#input');
    input.focus();
    selectText(outside);
    expect(getValidSelection()).toMatchObject({ ok: false, error: { code: 'IN_INPUT' } });

    const textarea = document.querySelector('#textarea');
    textarea.focus();
    selectText(outside);
    expect(getValidSelection()).toMatchObject({ ok: false, error: { code: 'IN_INPUT' } });
  });

  it('rejects selections longer than five words', () => {
    loadFixture('six-words.html');
    const paragraph = document.querySelector('#long');
    selectText(paragraph);

    expect(getValidSelection()).toMatchObject({
      ok: false,
      error: { code: 'TOO_LONG', message: 'Select up to 5 words' }
    });
  });

  it('rejects an empty selection', () => {
    loadFixture('empty.html');

    expect(getValidSelection()).toMatchObject({ ok: false, error: { code: 'EMPTY' } });
  });
});
