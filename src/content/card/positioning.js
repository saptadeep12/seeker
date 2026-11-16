/**
 * @typedef {{ top: number, left: number }} CardPosition
 * @typedef {{ top: number, left: number, width: number, height: number }} AnchorRect
 */

const GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Positions an absolutely-positioned card near a viewport selection rectangle.
 *
 * @param {AnchorRect} anchorRect
 * @param {{ width: number, height: number }} cardSize
 * @returns {CardPosition}
 */
export function getCardPosition(anchorRect, cardSize) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const minLeft = scrollX + VIEWPORT_MARGIN;
  const maxLeft = Math.max(minLeft, scrollX + window.innerWidth - cardSize.width - VIEWPORT_MARGIN);
  const left = clamp(scrollX + anchorRect.left, minLeft, maxLeft);
  const below = scrollY + anchorRect.top + anchorRect.height + GAP;
  const above = scrollY + anchorRect.top - cardSize.height - GAP;
  const maxTop = scrollY + window.innerHeight - cardSize.height - VIEWPORT_MARGIN;
  const top = below + cardSize.height <= scrollY + window.innerHeight - VIEWPORT_MARGIN
    ? below
    : Math.max(scrollY + VIEWPORT_MARGIN, above);

  return { top: Math.min(top, maxTop), left };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
