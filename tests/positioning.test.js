/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { getCardPosition } from '../src/content/card/positioning.js';

describe('getCardPosition', () => {
  it('places below and clamps horizontally', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 10 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 20 });

    expect(getCardPosition(
      { top: 40, left: 390, width: 10, height: 20 },
      { width: 320, height: 100 }
    )).toEqual({ top: 88, left: 82 });
  });

  it('flips above when there is not enough room below', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });

    expect(getCardPosition(
      { top: 170, left: 20, width: 10, height: 10 },
      { width: 200, height: 100 }
    ).top).toBe(82);
  });
});
