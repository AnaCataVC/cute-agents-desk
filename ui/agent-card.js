// @ts-check
/**
 * The agents column: header, one card per live agent, the delivered row, and the terminal.
 *
 * A card encodes its state twice — colour and motion — because they answer different
 * questions: colour says which state, motion says whether anything is advancing.
 */

import { ring, shortTokens } from './ring.js';
import { renderTerminal } from './terminal.js';
import { esc } from './esc.js';

/**
 * Card frame per state. `blocked` is deliberately still and dashed: a stopped agent must not
 * look like a working one, and dashes read as "interrupted" even in a screenshot.
 */
function cardFrame(agent) {
  const base = 'padding:14px;border-radius:15px;background:var(--color-dark-surface);'
    + 'border:1px solid var(--color-dark-border);min-width:0';
  switch (agent.state) {
    case 'thinking':
      return `${base};animation:breathe 2.6s var(--ease-soft) infinite`;
    case 'tool':
      return `${base};border-color:var(--state-tool)`;
    case 'approval':
      return `${base};border-color:var(--state-approval);box-shadow:var(--shadow-md)`;
    case 'blocked':
      return `${base};border:1px dashed var(--state-blocked)`;
    default:
      return `${base};opacity:.72`;
  }
}

function mismatchBanner(agent) {
  if (!agent.mismatch) return '';
  return `
  <div style="margin:-14px -14px 11px;padding:8px 12px;background:var(--who-system-bg);
       border-bottom:1px solid var(--state-approval);border-radius:15px 15px 0 0">
    <div style="font:600 10.5px var(--font-body);color:var(--state-approval)">
      Cuenta que no coincide con la ruta</div>
    <div class="mono" style="font-size:10px;line-height:1.45;color:var(--app-on-warning);margin-top:3px">
      git config → ${esc(agent.mismatch.configEmail)} · la ruta ${esc(agent.mismatch.folder)}
      es de ${esc(agent.mismatch.shouldBe)}</div>
  </div>`;
}

function actionRow(agent, isDelivered = false) {
  // A live agent is a real process: what you need is its screen and a way to end it.
  if (agent.live) {
    const ended = agent.state === 'done' || agent.state === 'failed';
    const deliverButton = agent.state === 'done'
      ? (isDelivered
        ? '<span style="font:600 11px var(--font-body);color:var(--color-emerald-400);margin-left:4px">✓ Entregado</span>'
        : `<button class="btn-primary" data-act="deliverAgent" data-arg="${esc(agent.id)}"
             style="border-radius:var(--radius-sm);font-size:11.5px;padding:3px 9px">Entregar PR</button>`)
      : '';

    return `
    <div style="display:flex;gap:8px;align-items:center;margin-top:11px">
      <button class="btn-ghost" data-act="openTerminal" data-arg="${esc(agent.id)}"
        style="border-radius:var(--radius-sm);font-size:11.5px">Ver terminal</button>
      ${ended ? '' : `<button class="btn-ghost" data-act="stopAgent" data-arg="${esc(agent.id)}"
        style="border-radius:var(--radius-sm);font-size:11.5px;border-color:var(--state-blocked);
               color:var(--state-blocked)">Detener</button>`}
      ${deliverButton}
      <span class="mono" style="margin-left:auto;font-size:10px;color:var(--color-dark-text-3)">
        $${(agent.costUsd || 0).toFixed(4)}</span>
    </div>
    ${agent.task ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--color-dark-border);
      font:400 10.5px/1.5 var(--font-body);color:var(--color-dark-text-3)">${esc(agent.task)}</div>` : ''}`;
  }
  if (agent.state === 'approval') {
    return `
    <div style="display:flex;gap:8px;margin-top:11px">
      <button class="btn-primary" style="flex:1;justify-content:center;padding:8px 10px;
        border-radius:var(--radius-sm);font-size:11.5px">Empujar así</button>
      <button class="btn-ghost" style="border-radius:var(--radius-sm);font-size:11.5px">Cambiar cuenta</button>
      <button class="btn-ghost" style="border-radius:var(--radius-sm);font-size:11.5px">Ver diff</button>
    </div>`;
  }
  if (agent.state === 'blocked') {
    return `
    <div style="display:flex;gap:8px;margin-top:11px">
      <button class="btn-ghost" data-act="openTerminal" data-arg="${esc(agent.id)}"
        style="border-radius:var(--radius-sm);font-size:11.5px">Abrir terminal</button>
      <button class="btn-ghost" style="border-radius:var(--radius-sm);font-size:11.5px">Reencolar</button>
    </div>`;
  }
  return '';
}

function card(agent, account, states, isDelivered = false) {
  const st = states[agent.state] || states.idle;
  const pill = 'padding:1px 8px;border-radius:var(--radius-full);font:500 9.5px var(--font-body)';

  const meter = agent.ring ? `
    <div style="flex:none;text-align:center">
      ${ring({ used: agent.tokens, cap: agent.tokenCap, color: st.color })}
      <div class="mono" style="font-size:10px;font-weight:600;color:var(--color-dark-text-2);margin-top:3px">
        ${shortTokens(agent.tokens)}</div>
      <div class="mono" style="font-size:9px;color:var(--color-dark-text-3)">/${shortTokens(agent.tokenCap)}</div>
    </div>` : '';

  return `
  <div style="${cardFrame(agent)}">
    ${mismatchBanner(agent)}
    <div style="display:flex;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;padding-bottom:6px;
             border-bottom:1px solid var(--color-dark-border)">
          <span class="mono" style="font-size:10px;font-weight:600;color:${account.color}">${esc(account.name)}</span>
          <span class="mono" style="font-size:10px;color:var(--color-dark-text-3);overflow:hidden;
                text-overflow:ellipsis;white-space:nowrap">${esc(account.email)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px;flex-wrap:wrap">
          <span class="mono" style="font-size:12.5px;font-weight:600">${esc(agent.id)}</span>
          <span class="mono" style="font-size:11.5px;color:var(--color-dark-text-2)">${esc(agent.repo)}</span>
          <span style="${pill};background:${st.color};color:var(--app-on-accent)">${esc(st.label)}</span>
          <span style="${pill};background:var(--who-boss-bg);color:var(--who-boss);
                border:1px solid var(--color-dark-border)">${esc(agent.boss)}</span>
        </div>
        <div class="mono" style="font-size:10.5px;color:var(--color-dark-text-3);margin-top:7px;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(agent.tool)}</div>
        <button class="btn-ghost" data-act="openChat" data-arg="${esc(agent.id)}" style="margin-top:9px">
          Ver conversación · ${agent.messages}</button>
      </div>
      ${meter}
    </div>
    ${actionRow(agent, isDelivered)}
  </div>`;
}

function deliveredRow(task) {
  const prDisplay = task.prUrl
    ? `<a href="${esc(task.prUrl)}" target="_blank" rel="noopener" style="font:600 11px var(--font-body);color:var(--color-blue)">${esc(task.pr || 'PR borrador')}</a>`
    : `<span style="font:400 11px var(--font-body);color:var(--color-dark-text-3)">${esc(task.pr || 'borrador')}</span>`;
  const reportDisplay = task.reportUrl
    ? `<a href="${esc(task.reportUrl)}" target="_blank" rel="noopener" style="font:600 11px var(--font-body)">ver reporte →</a>`
    : '';

  return `
  <div style="display:flex;align-items:center;gap:12px;padding:9px 14px;background:var(--app-surface-done);
       border:1px solid var(--color-dark-border);border-radius:var(--radius-md);flex-wrap:wrap">
    <span class="mono" style="font-size:11px;font-weight:600;color:var(--color-dark-text-3)">${esc(task.agentId || task.id)}</span>
    <span style="width:7px;height:7px;border-radius:50%;background:var(--color-emerald-400)"></span>
    <span class="mono" style="font-size:11.5px;font-weight:500;color:var(--color-dark-text-2)">${esc(task.repo)}</span>
    <span class="mono" style="font-size:11px;color:var(--color-dark-text-3)">↳ ${esc(task.branch)}</span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:12px">
      ${prDisplay}
      ${reportDisplay}
    </div>
  </div>`;
}

/** @returns {string} */
export function renderAgentPanel(state, data) {
  const accounts = data.getAccounts();
  const noAccount = { color: 'var(--color-dark-text-3)', name: '—', email: '' };
  const byId = (id) => accounts.find((a) => a.id === id) || accounts[0] || noAccount;

  const agents = data.getAgents();
  const deliveredList = data.getDelivered();
  const deliveredSet = new Set(deliveredList.map((d) => d.agentId || d.id));
  const cards = agents.map((a) => card(a, byId(a.accountId), data.STATES, deliveredSet.has(a.id))).join('');
  const delivered = deliveredList.map(deliveredRow).join('');

  return `
  <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;min-width:0">
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
      <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
           text-transform:uppercase">Agentes</div>
      <div style="font:400 10.5px var(--font-body);color:var(--color-dark-text-3)">
        movimiento = progreso · quieto = detenido</div>
      ${window.desk?.isDesk
    ? '<button class="btn-ghost" data-act="spawnTest" style="margin-left:auto">Lanzar agente de prueba</button>'
    : ''}
      <button class="btn-primary" data-act="openQueue" data-arg=""
        style="${window.desk?.isDesk ? '' : 'margin-left:auto;'}padding:9px 16px;font-size:12px">
        <span style="font-size:15px;line-height:1">+</span>Nueva petición</button>
    </div>
    ${agents.length ? '' : `
    <div style="padding:8px 11px;border:1px dashed var(--color-dark-border);
         border-radius:var(--radius-md);font:400 10px var(--font-body);color:var(--color-dark-text-3)">
      Sin agentes corriendo.
    </div>`}
    <div style="display:grid;grid-template-columns:minmax(0,1fr);gap:10px">${cards}</div>
    ${delivered}
    <div style="font:400 10px/1.5 var(--font-body);color:var(--color-dark-text-3)">
      Un motor sin hooks completos se dibuja con borde punteado y sin anillo, para que se vea que ahí
      hay menos información.
    </div>
    <div style="margin-top:auto">${renderTerminal(state, data)}</div>
  </div>`;
}
