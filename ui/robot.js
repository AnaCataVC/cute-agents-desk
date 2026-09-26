// @ts-check
/**
 * The one robot glyph, ported from the artboard where it was pasted ~40 times.
 *
 * Colors arrive as CSS custom-property references (`var(--state-tool)`) and are applied
 * through `style` attributes, never as SVG presentation attributes: `stroke="var(--x)"`
 * is silently ignored by the renderer, `style="stroke:var(--x)"` is not.
 *
 * Motion is meaning: bob, antenna, blink and wave run only for a variant that is
 * actually working. A still robot is a stopped agent.
 */

import { esc } from './esc.js';

/** @typedef {'working'|'coordinator'|'idle'|'done'} RobotVariant */

/**
 * @param {object} o
 * @param {number} o.x
 * @param {number} o.y
 * @param {number} o.scale
 * @param {string} o.color          CSS color or `var(--token)`
 * @param {RobotVariant} [o.variant]
 * @param {number} [o.opacity]
 * @param {boolean} [o.simple]      drop mouth and feet — they turn to mud below ~0.5 scale
 * @returns {string} SVG markup
 */
export function robot({ x, y, scale, color, variant = 'working', opacity = 1, simple = false }) {
  const animated = variant === 'working' || variant === 'coordinator';
  const safeColor = esc(color);
  const stroke = (w) => `style="stroke:${safeColor};fill:none" stroke-width="${w}" stroke-linecap="round"`;
  const shell = `style="fill:var(--color-dark-bg);stroke:${safeColor}"`;
  const visor = `style="fill:var(--app-surface-tree);stroke:${safeColor}"`;
  const solid = `style="fill:${safeColor}"`;

  const crest = variant === 'coordinator'
    // A crown instead of an antenna: the coordinator reads as the one in charge.
    ? `<path d="M-7,-15.5 L-7,-21 L-3.5,-17.5 L0,-22 L3.5,-17.5 L7,-21 L7,-15.5" ${stroke(1.6)}></path>`
    : `<line x1="0" y1="-15" x2="0" y2="-20" ${stroke(1.6)}></line>`
      + `<circle cx="0" cy="-22" r="2.4" ${solid}${animated ? ' class="r-antenna"' : ''}></circle>`;

  const eyes = variant === 'idle'
    // Closed eyes: no light on, nobody working.
    ? `<g ${stroke(1.6)}><line x1="-6.4" y1="-4.6" x2="-2.4" y2="-4.6"></line>`
      + `<line x1="2.4" y1="-4.6" x2="6.4" y2="-4.6"></line></g>`
    : `<g class="${animated ? 'r-blink' : ''}"><circle cx="-4.4" cy="-4.6" r="2.3" ${solid}></circle>`
      + `<circle cx="4.4" cy="-4.6" r="2.3" ${solid}></circle></g>`;

  const belly = variant === 'done'
    ? `<path d="M-3,13.8 L-0.6,16.2 L3.4,11.8" ${stroke(1.7)}></path>`
    : `<circle cx="0" cy="14" r="2" ${solid} opacity="0.7"></circle>`;

  const rightArm = animated
    ? `<line x1="9" y1="12" x2="14.5" y2="6.5" ${stroke(1.7)} class="r-wave"></line>`
    : `<line x1="9" y1="12" x2="14" y2="16" ${stroke(1.7)}></line>`;

  const mouth = simple ? ''
    : `<line x1="-2.6" y1="2.4" x2="2.6" y2="2.4" ${stroke(1.3)} opacity="0.75"></line>`;
  const feet = simple ? ''
    : `<rect x="-7" y="20" width="5" height="3.4" rx="1.6" ${solid} opacity="0.8"></rect>`
      + `<rect x="2" y="20" width="5" height="3.4" rx="1.6" ${solid} opacity="0.8"></rect>`;

  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${opacity}">`
    + `<g class="${animated ? 'r-bob' : ''}">`
    + crest
    + `<rect x="-13.5" y="-8" width="3.5" height="7" rx="1.6" ${shell} stroke-width="1.4"></rect>`
    + `<rect x="10" y="-8" width="3.5" height="7" rx="1.6" ${shell} stroke-width="1.4"></rect>`
    + `<rect x="-11.5" y="-14.5" width="23" height="20" rx="8" ${shell} stroke-width="1.7"></rect>`
    + `<rect x="-8" y="-9.5" width="16" height="10" rx="5" ${visor} stroke-width="1.1" opacity="0.9"></rect>`
    + eyes + mouth
    + `<rect x="-8.5" y="8" width="17" height="12" rx="4.5" ${shell} stroke-width="1.7"></rect>`
    + belly
    + `<line x1="-9" y1="12" x2="-14" y2="16" ${stroke(1.7)}></line>`
    + rightArm + feet
    + `</g></g>`;
}

/** Agent state -> robot variant and the token that colors it. */
export const STATE_ROBOT = {
  thinking: { variant: 'working', color: 'var(--state-thinking)' },
  tool: { variant: 'working', color: 'var(--state-tool)' },
  approval: { variant: 'working', color: 'var(--state-approval)' },
  blocked: { variant: 'idle', color: 'var(--state-blocked)' },
  idle: { variant: 'idle', color: 'var(--color-dark-text-3)' },
  done: { variant: 'done', color: 'var(--color-emerald-400)' },
};
