// @ts-check
/** The token meter: an SVG arc, no library. Used on the agent card and the compact coordinator. */

/**
 * @param {object} o
 * @param {number} o.used
 * @param {number} o.cap
 * @param {string} o.color      CSS color or `var(--token)`
 * @param {number} [o.size]
 * @param {number} [o.stroke]
 * @returns {string} SVG markup, sized `size` x `size`
 */
export function ring({ used, cap, color, size = 56, stroke = 4 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = cap > 0 ? Math.min(1, used / cap) : 0;
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      style="stroke:var(--state-idle)" stroke-width="${stroke}"></circle>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      style="stroke:${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(c * pct).toFixed(2)} ${c.toFixed(2)}"></circle>
  </svg>`;
}

/** 124000 -> "124k". Tokens are read at a glance, so the exact digits are noise. */
export function shortTokens(n) {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** 252 -> "4m 12s", matching the artboard's elapsed format. */
export function elapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

/**
 * Ring split by state for the compact coordinator card: each state gets an arc
 * proportional to how many of its agents are in it.
 * @param {{state:string}[]} agents
 * @param {Record<string,{color:string}>} states
 */
export function ringByState({ agents, states, size = 66, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = agents.length || 1;
  let offset = 0;
  const arcs = agents.map((a) => {
    const len = c / total;
    const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      style="stroke:${(states[a.state] || states.idle).color}" stroke-width="${stroke}"
      stroke-dasharray="${(len - 1.5).toFixed(2)} ${(c - len + 1.5).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
    offset += len;
    return seg;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
    style="display:block;transform:rotate(-90deg)">${arcs}</svg>`;
}
