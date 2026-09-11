// @ts-check
/**
 * The timeline: one lane per agent, a bar per state run, read from the event log.
 *
 * Bars are positioned in percent of the window, so the same data renders at any width
 * without recomputing anything.
 */

import { esc } from './esc.js';

/** @returns {string} */
export function renderTimeline(state, data) {
  const tl = data.getTimeline();
  const states = data.STATES;

  const lanes = tl.lanes.map((lane) => {
    const bars = lane.bars.map(([st, from, len]) => {
      const color = (states[st] || states.idle).color;
      return `<div title="${esc((states[st] || states.idle).label)}"
        style="position:absolute;left:${from}%;width:${len}%;top:4px;bottom:4px;
               background:${color};border-radius:3px;opacity:${st === 'idle' ? '.45' : '.9'}"></div>`;
    }).join('');

    return `
    <div style="display:grid;grid-template-columns:132px minmax(0,1fr);align-items:center;gap:10px">
      <div class="mono" style="font-size:10px;color:var(--color-dark-text-3);overflow:hidden;
           text-overflow:ellipsis;white-space:nowrap">${esc(lane.agent)}</div>
      <div style="position:relative;height:18px;background:var(--color-dark-bg);
           border-radius:var(--radius-sm)">${bars}</div>
    </div>`;
  }).join('');

  const ticks = tl.ticks.map((t) => `<span>${esc(t)}</span>`).join('');

  const legend = Object.entries(states)
    // 'done' is not a run on the timeline: a delivered agent leaves the lanes entirely.
    .filter(([key]) => key !== 'done')
    .map(([, v]) => `
      <span style="display:flex;align-items:center;gap:6px;font:400 10px var(--font-body);
            color:var(--color-dark-text-3)">
        <span style="width:9px;height:9px;border-radius:3px;background:${v.color}"></span>${v.label}
      </span>`).join('');

  return `
  <div class="panel" style="padding:14px">
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:11px">
      <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
           text-transform:uppercase">Timeline</div>
      <div style="font:400 10px var(--font-body);color:var(--color-dark-text-3)">
        Registro de eventos · ${esc(tl.window)}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:5px">${lanes}</div>
    <div class="mono" style="display:flex;justify-content:space-between;margin:7px 0 0 142px;
         font-size:9px;color:var(--color-dark-text-3)">${ticks}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;padding-top:11px;
         border-top:1px solid var(--color-dark-border)">${legend}</div>
  </div>`;
}
