/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContext } from '../src/content/context.js';

function loadFixture(name) {
  document.body.innerHTML = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', name),
    'utf8'
  );
}

function rangeFor(node, start, end) {
  const range = document.createRange();
  range.setStart(node.firstChild, start);
  range.setEnd(node.firstChild, end);
  return range;
}

function selectNodeContents(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range;
}

describe('buildContext', () => {
  beforeEach(() => {
    document.title = 'Seeker test page';
    document.documentElement.lang = '';
  });

  it('uses the full block across inline elements and nearest chat message', () => {
    loadFixture('chat.html');
    const message = document.querySelector('.message');
    const range = selectNodeContents(message.querySelector('div'));

    expect(buildContext(range, 'Streaming chat text arrives in pieces.')).toEqual({
      context: 'Streaming chat text arrives in pieces.',
      page: { title: 'Seeker test page', domain: 'localhost' },
      lang: 'en'
    });
  });

  it('uses the occurrence represented by the range when text repeats', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'the bank by the river bank';
    document.body.append(paragraph);
    const range = rangeFor(paragraph, 22, 26);

    expect(buildContext(range, 'bank').context).toBe('the bank by the river bank');
  });

  it('adds markers only when context is cut', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = `${'before '.repeat(30)}target ${'after '.repeat(30)}`;
    document.body.append(paragraph);
    const targetStart = paragraph.textContent.indexOf('target');
    const range = rangeFor(paragraph, targetStart, targetStart + 6);
    const result = buildContext(range, 'target');

    expect(result.context.startsWith('... ')).toBe(true);
    expect(result.context.endsWith(' ...')).toBe(true);
    expect(result.context).not.toMatch(/\bbefor\b/u);
    expect(result.context).not.toMatch(/\bafte\b/u);
  });

  it('handles short blocks and language fallback', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'short text';
    document.body.append(paragraph);
    const range = selectNodeContents(paragraph);

    expect(buildContext(range, 'short text')).toMatchObject({
      context: 'short text',
      lang: 'und'
    });
  });

  it('falls back to the selection when a range cannot be located', () => {
    const detached = document.createElement('p');
    detached.textContent = 'detached';
    const range = selectNodeContents(detached);

    expect(buildContext(range, 'detached')).toMatchObject({ context: 'detached' });
  });

  it('falls back to the selection for an oversized block', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'x'.repeat(100_001);
    document.body.append(paragraph);
    const range = rangeFor(paragraph, 0, 1);

    expect(buildContext(range, 'x').context).toBe('x');
  });
});
