/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  close,
  getState,
  open,
  showConsent,
  setCloseHandler,
  setTimeoutHandler,
  showChunk,
  showError,
  showResult
} from '../src/content/card/card.js';

const anchor = { top: 20, left: 20, width: 40, height: 18 };
const result = (overrides = {}) => ({
  word: 'honey',
  meaning: 'A loved one',
  confidence: 0.9,
  category: 'general',
  other_senses: [],
  ...overrides
});

describe('result card', () => {
  beforeEach(() => {
    close();
    document.body.innerHTML = '';
  });

  it('reuses one host and moves through its states', () => {
    open('honey', anchor);
    expect(getState()).toBe('loading');
    expect(document.querySelectorAll('seeker-result-card')).toHaveLength(1);

    showChunk('Lookup ');
    expect(getState()).toBe('streaming');
    showResult(result({ other_senses: ['Sweet food'] }));
    expect(getState()).toBe('done');
    expect(document.querySelector('seeker-result-card').shadowRoot.textContent).toContain('A loved one');

    open('bank', anchor);
    expect(getState()).toBe('loading');
    expect(document.querySelectorAll('seeker-result-card')).toHaveLength(1);
    close();
    expect(document.querySelector('seeker-result-card')).toBeNull();
  });

  it('expands alternative senses through an accessible button', () => {
    open('honey', anchor);
    showResult(result({ other_senses: ['Sweet food', 'A term of affection'] }));

    const root = document.querySelector('seeker-result-card').shadowRoot;
    const also = root.querySelector('.also');
    const senses = root.querySelector('.also-senses');

    expect(also.tagName).toBe('BUTTON');
    expect(also.getAttribute('aria-expanded')).toBe('false');
    expect(senses.hidden).toBe(true);
    also.click();
    expect(also.getAttribute('aria-expanded')).toBe('true');
    expect(senses.hidden).toBe(false);
    expect(senses.textContent).toContain('Sweet food');
  });

  it.each([
    ['english', result({ category: 'english', other_senses: [] })],
    ['general', result({ category: 'general', other_senses: [] })]
  ])('does not show technical details for %s results', (_category, fixture) => {
    open('honey', anchor);
    showResult(fixture);

    const root = document.querySelector('seeker-result-card').shadowRoot;
    expect(root.querySelector('.technical').hidden).toBe(true);
  });

  it('shows technical domain and example details', () => {
    open('mutex', anchor);
    showResult(result({
      word: 'mutex',
      category: 'technical',
      domain: 'programming',
      example: 'A mutex protects shared state.'
    }));

    const root = document.querySelector('seeker-result-card').shadowRoot;
    expect(root.querySelector('.technical').hidden).toBe(false);
    expect(root.querySelector('.technical').textContent).toContain('programming');
    expect(root.querySelector('.technical').textContent).toContain('A mutex protects shared state.');
  });

  it('shows the main and alternative sense for low confidence', () => {
    open('bank', anchor);
    showResult(result({
      word: 'bank',
      meaning: 'A financial institution',
      confidence: 0.59,
      other_senses: ['The side of a river', 'A row of objects']
    }));

    const root = document.querySelector('seeker-result-card').shadowRoot;
    const senses = root.querySelectorAll('.also-senses li');
    expect(root.querySelector('.also').hidden).toBe(true);
    expect(root.querySelector('.also-senses').hidden).toBe(false);
    expect([...senses].map((item) => item.textContent)).toEqual([
      'A financial institution',
      'The side of a river'
    ]);
  });

  it('truncates long meaning and alternative text', () => {
    open('long', anchor);
    showResult(result({
      meaning: 'm'.repeat(2500),
      other_senses: ['s'.repeat(2500)]
    }));

    const root = document.querySelector('seeker-result-card').shadowRoot;
    expect(root.querySelector('.meaning').textContent).toHaveLength(2000);
    root.querySelector('.also').click();
    expect(root.querySelector('.also-senses li').textContent).toHaveLength(2000);
  });

  it('shows an accessible error state and closes on Escape', () => {
    open('honey', anchor);
    showError('Select up to 5 words');

    const host = document.querySelector('seeker-result-card');
    expect(getState()).toBe('error');
    expect(host.shadowRoot.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.shadowRoot.textContent).toContain('Select up to 5 words');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('seeker-result-card')).toBeNull();
  });

  it('renders keyboard-operable consent actions', () => {
    open('honey', anchor);
    const agree = vi.fn();
    const notNow = vi.fn();
    showConsent({ onAgree: agree, onNotNow: notNow });

    const root = document.querySelector('seeker-result-card').shadowRoot;
    expect(root.querySelector('.consent').hidden).toBe(false);
    expect(root.querySelector('.consent').textContent).toContain(
      'Nothing is sent until you agree.'
    );
    expect(root.activeElement).toBe(root.querySelector('.agree'));

    root.querySelector('.agree').click();
    root.querySelector('.not-now').click();
    expect(agree).toHaveBeenCalledTimes(1);
    expect(notNow).toHaveBeenCalledTimes(1);
  });

  it('cleans up active response work on close and timeout', () => {
    const cleanup = vi.fn();
    setCloseHandler(cleanup);
    open('honey', anchor);
    close();
    expect(cleanup).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      setTimeoutHandler(onTimeout);
      open('honey', anchor);
      vi.advanceTimersByTime(10_000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(getState()).toBe('error');
    } finally {
      vi.useRealTimers();
      close();
    }
  });
});
