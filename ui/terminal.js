// @ts-check
/**
 * The terminal panel. Unmounted by default and never more than one at a time — this is the
 * single biggest performance lever on the page, so the closed state says so out loud.
 */

import { esc } from './esc.js';

/** @returns {string} */
export function renderTerminal(state, data) {
  if (!state.terminal) {
    const liveAgents = data.getAgents().filter((a) => a.live);
    const openBtn = liveAgents.length
      ? `<button class="chip" data-act="openTerminal" data-arg="${esc(liveAgents[0].id)}"
          style="margin-left:auto">Abrir terminal (${esc(liveAgents[0].id)})</button>`
      : '';
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:11px 14px;
         background:var(--app-surface-sunken);border:1px dashed var(--color-dark-border);
         border-radius:var(--radius-md)">
      <span class="mono" style="font-size:11px;font-weight:600;color:var(--color-dark-text-3)">TERMINAL</span>
      <span style="font:400 10.5px var(--font-body);color:var(--color-dark-text-3)">
        No montada. Una sola a la vez, sólo al abrirla.</span>
      ${openBtn}
    </div>`;
  }

  const agent = data.getAgents().find((a) => a.id === state.terminal);

  // A real agent's screen is its own output; the mock lines exist only for the design review.
  const live = data.getOutput(state.terminal);
  if (live.length) {
    return `
    <div style="background:var(--app-surface-terminal);border:1px solid var(--color-dark-border);
         border-radius:var(--radius-md);overflow:hidden">
      <div style="display:flex;align-items:center;gap:12px;padding:9px 14px;
           border-bottom:1px solid var(--color-dark-border)">
        <span class="mono" style="font-size:11px;font-weight:600">${esc(state.terminal)}${agent ? ` · ${esc(agent.repo)}` : ''}</span>
        <span style="font:400 10px var(--font-body);color:var(--color-dark-text-3)">
          salida del proceso · ${live.length} líneas</span>
        <button class="chip" data-act="closeTerminal" style="margin-left:auto">Cerrar</button>
      </div>
      <div class="mono" style="padding:12px 14px;font-size:11px;line-height:1.6;max-height:300px;
           overflow:auto;color:var(--color-dark-text-2);white-space:pre-wrap">${
  // Only the tail is on screen; the whole session is in the agent's pty.log.
  esc(live.slice(-60).join('\n'))}</div>
    </div>`;
  }

  const rawLines = data.getTerminalLines();
  const lines = rawLines.length ? rawLines.map((l) => {
    if (l.kind === 'cmd') {
      return `<div><span style="color:var(--color-mint)">$</span> ${esc(l.text)}</div>`;
    }
    if (l.kind === 'err') {
      return `<div style="color:var(--state-blocked)">${esc(l.text)}</div>`;
    }
    return `<div><span style="color:var(--color-mint)">$</span>
      <span class="term-caret" style="display:inline-block;width:7px;height:13px;
            background:var(--color-dark-text-2);vertical-align:-2px"></span></div>`;
  }).join('') : `
    <div style="padding:24px 14px;text-align:center;font:400 11px var(--font-body);color:var(--color-dark-text-3)">
      Sin salida de terminal todavía para este proceso.
    </div>`;

  return `
  <div style="background:var(--app-surface-sunken);border:1px solid var(--color-dark-border);
       border-radius:var(--radius-md);overflow:hidden">
    <div style="display:flex;align-items:center;gap:12px;padding:9px 14px;
         border-bottom:1px solid var(--color-dark-border)">
      <span class="mono" style="font-size:11px;font-weight:600">${esc(state.terminal)}${agent ? ` · ${esc(agent.repo)}` : ''}</span>
      <span style="font:400 10px var(--font-body);color:var(--color-dark-text-3)">
        xterm.js montado a pedido · 1 instancia</span>
      <button class="chip" data-act="closeTerminal" style="margin-left:auto">Cerrar y desmontar</button>
    </div>
    <div class="mono" style="padding:12px 14px;font-size:11.5px;line-height:1.7;
         color:var(--color-dark-text-2)">${lines}</div>
  </div>`;
}
