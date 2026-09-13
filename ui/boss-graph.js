// @ts-check
/**
 * The "Flujos" tab: one radial graph per coordinator, in a detailed and a compact view.
 *
 * The edge is the encoding that matters. A coordinator edge whose agent is working has crawling
 * dashes and a travelling dot; a stopped agent's edge is a thin, still, faded line. An
 * agent-to-agent link is a curve, so a handoff never looks like a delegation.
 *
 * Only working agents go on the ring. Delivered and idle ones are "parked": they would crowd
 * the circle with nodes that never move, so they collapse into a row under the graph.
 */

import { robot, STATE_ROBOT } from './robot.js';
import { ringByState, shortTokens } from './ring.js';
import { renderTimeline } from './timeline.js';
import { LIVE } from './data.js';
import { esc } from './esc.js';

/**
 * Node positions: evenly spaced on a circle starting at 12 o'clock.
 * With hub (232,176) and r=132 this reproduces the artboard's five positions
 * (232,44 / 357.5,135.2 / 309.6,282.8 / 154.4,282.8 / 106.5,135.2).
 */
function layout(count, cx, cy, r) {
  return Array.from({ length: count }, (_, i) => {
    const a = (-Math.PI / 2) + (i * 2 * Math.PI / count);
    return { x: +(cx + r * Math.cos(a)).toFixed(1), y: +(cy + r * Math.sin(a)).toFixed(1) };
  });
}

/**
 * One radial graph over the coordinator's live agents.
 * @param {object} o
 * @param {any} o.flow
 * @param {{id:string,state:string}[]} o.agents  the live subset
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} o.scale
 * @param {boolean} [o.labels]
 * @param {boolean} [o.simple]
 */
function graph({ flow, agents, width, height, scale, labels = true, simple = false }) {
  const cx = width / 2;
  const cy = height / 2 - 7;
  const r = Math.min(width, height) * 0.38;
  const pos = layout(agents.length, cx, cy, r);
  const at = (id) => pos[agents.findIndex((a) => a.id === id)];

  const edges = agents.map((agent, i) => {
    const p = pos[i];
    const color = (STATE_ROBOT[agent.state] || STATE_ROBOT.idle).color;
    // Unique per coordinator: <mpath href> resolves document-wide and several graphs share a page.
    const id = `edge-${flow.id}-${i}`;
    if (agent.state === 'blocked') {
      return `<path d="M${cx},${cy} L${p.x},${p.y}" fill="none" style="stroke:${color}"
        stroke-width="1.1" stroke-dasharray="3 5" opacity="0.5"></path>`;
    }
    return `<path id="${id}" d="M${cx},${cy} L${p.x},${p.y}" fill="none" style="stroke:${color}"
        stroke-width="1.5" stroke-dasharray="6 6" opacity="0.95" class="edge-live"></path>
      <circle r="3.2" style="fill:${color}">
        <animateMotion dur="${(2.2 + i * 0.3).toFixed(1)}s" repeatCount="indefinite">
          <mpath href="#${id}"></mpath></animateMotion></circle>`;
  }).join('');

  // Agent-to-agent handoffs: a curve bowed toward the hub, with a slower dot.
  const links = (flow.links || []).map(([from, to], i) => {
    const a = at(from);
    const b = at(to);
    if (!a || !b) return '';
    const id = `link-${flow.id}-${i}`;
    const qx = (a.x + b.x + cx) / 3;
    const qy = (a.y + b.y + cy) / 3;
    const color = (STATE_ROBOT[agents.find((x) => x.id === to)?.state] || STATE_ROBOT.idle).color;
    return `<path id="${id}" d="M${a.x},${a.y} Q${qx.toFixed(1)},${qy.toFixed(1)} ${b.x},${b.y}"
        fill="none" style="stroke:${color}" stroke-width="1" stroke-dasharray="2 4" opacity="0.6"></path>
      <circle r="2.2" style="fill:${color}" opacity="0.9">
        <animateMotion dur="${(3 + i).toFixed(1)}s" repeatCount="indefinite">
          <mpath href="#${id}"></mpath></animateMotion></circle>`;
  }).join('');

  const nodes = agents.map((agent, i) => {
    const p = pos[i];
    const skin = STATE_ROBOT[agent.state] || STATE_ROBOT.idle;
    const dim = agent.state === 'blocked' ? 0.6 : 1;
    const label = labels ? `<text x="${p.x}" y="${(p.y + 38).toFixed(1)}" text-anchor="middle"
      opacity="${dim}" style="fill:var(--color-dark-text-2);font:400 9px var(--font-mono)">${esc(agent.id)}</text>` : '';
    // The hit area is a transparent circle, not the glyph: the robot has holes.
    const hit = `<circle cx="${p.x}" cy="${p.y}" r="26" fill="transparent" style="cursor:pointer"
      data-act="tip" data-arg="${esc(`${flow.id}|${agent.id}`)}"></circle>`;
    return robot({ x: p.x, y: p.y, scale, color: skin.color, variant: skin.variant, opacity: dim, simple })
      + label + hit;
  }).join('');

  const coord = flow.coordinator;
  const coordSkin = coord ? (STATE_ROBOT[coord.state] || STATE_ROBOT.idle) : STATE_ROBOT.idle;
  const coordColor = coord ? coordSkin.color : 'var(--color-dark-accent)';
  const coordDim = coord && coord.state === 'blocked' ? 0.6 : 1;
  const coordHit = coord ? `<circle cx="${cx}" cy="${cy}" r="32" fill="transparent" style="cursor:pointer"
    data-act="tip" data-arg="${esc(`${flow.id}|${coord.id}`)}"></circle>` : '';

  const hub = `
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.36).toFixed(1)}" fill="none"
      style="stroke:${coordColor};transform-origin:${cx}px ${cy}px;animation:ringSpin 16s linear infinite"
      stroke-width="1" stroke-dasharray="4 11" opacity="0.4"></circle>
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.26).toFixed(1)}" style="fill:var(--color-dark-surface)"></circle>
    ${robot({ x: cx, y: cy, scale: scale * 1.9, color: coordColor, variant: 'coordinator', opacity: coordDim, simple })}
    ${coordHit}`;

  return `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}"
    preserveAspectRatio="xMidYMid meet" style="display:block">
    ${edges}${links}${nodes}${hub}</svg>`;
}

function splitPill(split) {
  // 'por repo' and 'por tema' are different strategies, so they get different hues.
  const bg = split === 'por repo' ? 'var(--color-mint)' : 'var(--color-blue)';
  return `<span style="padding:1px 7px;border-radius:var(--radius-full);background:${bg};
    color:var(--color-dark-bg);font:500 9.5px var(--font-body)">${esc(split)}</span>`;
}

/** Tokens and context of the hovered agent, without opening its thread. */
function tooltip(flow, agents, state, states) {
  if (!state.tip) return '';
  const [flowId, agentId] = state.tip.split('|');
  if (flowId !== flow.id) return '';
  let agent = agents.find((a) => a.id === agentId);
  if (!agent && flow.coordinator && flow.coordinator.id === agentId) {
    agent = {
      id: flow.coordinator.id,
      state: flow.coordinator.state,
      repo: flow.repos || 'coordinación',
      branch: 'coordinador',
      tokens: flow.coordinator.tokens,
      ctxPct: flow.coordinator.ctxPct,
    };
  }
  if (!agent) return '';
  const st = states[agent.state] || states.idle;

  return `
  <div style="position:absolute;right:11px;top:11px;padding:9px 11px;background:var(--color-dark-bg);
       border:1px solid ${st.color};border-radius:10px;box-shadow:var(--shadow-md);max-width:210px">
    <div class="mono" style="font-size:10.5px;font-weight:600">${esc(agent.id)}</div>
    <div class="mono" style="font-size:9.5px;color:${st.color}">${st.label}</div>
    <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3);margin-top:4px">
      ${esc(agent.repo)} · ${esc(agent.branch)}</div>
    <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-2);margin-top:3px">
      ${shortTokens(agent.tokens)} tokens · ${agent.ctxPct}% del contexto</div>
    <button class="chip" data-act="openChat" data-arg="${esc(agent.id)}"
      style="margin-top:7px;width:100%">Ver hilo</button>
  </div>`;
}

/** Parked agents: delivered or waiting. One row, so the ring only holds what is moving. */
function parkedRow(flow, agents, states) {
  if (!agents.length) return '';
  const pills = agents.map((a) => {
    const st = states[a.state] || states.idle;
    return `<button class="chip" data-act="openChat" data-arg="${esc(a.id)}"
      style="border-color:var(--color-dark-border);color:${st.color};font-size:9.5px">
      ${esc(a.id)} · ${st.label}</button>`;
  }).join('');

  return `
  <div style="margin-top:9px;padding-top:10px;border-top:1px solid var(--color-dark-border)">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:7px">
      <span style="font:600 9px var(--font-body);letter-spacing:.07em;text-transform:uppercase;
            color:var(--color-dark-text-3)">Fuera del anillo · ${agents.length}</span>
      <span style="font:400 9.5px var(--font-body);color:var(--color-dark-text-3)">entregados y en espera</span>
      <button class="chip" data-act="closeIdle" data-arg="${esc(flow.id)}"
        style="margin-left:auto;font-size:9px">Cerrar los idle</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${pills}</div>
  </div>`;
}

/** The numbers that say whether this coordinator is worth your attention right now. */
function metaRow(flow) {
  const roster = flow.roster || [];
  const item = (label, value) => `
    <div style="min-width:0">
      <div style="font:400 8.5px var(--font-body);color:var(--color-dark-text-3);
           letter-spacing:.05em;text-transform:uppercase">${label}</div>
      <div class="mono" style="font-size:10.5px;color:var(--color-dark-text-2);overflow:hidden;
           text-overflow:ellipsis;white-space:nowrap">${value}</div>
    </div>`;

  return `
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:9px;
       padding:9px 11px;background:var(--color-dark-bg);border-radius:10px;margin-bottom:10px">
    ${item('sesiones', `${roster.length} de ${flow.defined ?? 3}`)}
    ${item('turnos', esc(flow.turns || `${roster.length} turnos`))}
    ${item('costo', `$${(flow.cost || 0).toFixed(2)}`)}
    ${item('ritmo', flow.rate ? `${flow.rate} tok/min` : '—')}
    ${item('hooks', String(flow.hooks || 0))}
    ${item('bucles', (flow.loops || []).length ? esc(flow.loops.join(', ')) : '—')}
  </div>`;
}

function detailCard(flow, state, states, data) {
  const roster = flow.roster || [];
  const live = roster.filter((a) => LIVE.includes(a.state));
  const parked = roster.filter((a) => !LIVE.includes(a.state));
  const acc = (data?.getAccounts() || []).find((a) => a.id === flow.accountId);
  const account = acc ? (acc.name || acc.id) : (flow.accountId || '—');

  return `
  <div class="panel" style="padding:14px;position:relative">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:3px">
      <span class="mono" style="font-size:11.5px;font-weight:600">${esc(flow.name || flow.id)}</span>
      ${splitPill(flow.split || 'por tema')}
      <span style="padding:1px 7px;border-radius:var(--radius-full);background:var(--color-dark-bg);
            color:var(--color-dark-text-2);font:500 9px var(--font-body)">${esc(flow.engine || 'claude cli')}</span>
      <button class="chip" data-act="archive" data-arg="${esc(flow.id)}"
        style="margin-left:auto;font-size:9px">Archivar</button>
    </div>
    <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3);margin-bottom:9px">
      ${esc(account)} · ${esc(flow.repos || '—')}</div>
    ${metaRow(flow)}
    ${(live.length || (flow.coordinator && LIVE.includes(flow.coordinator.state)))
    ? graph({ flow, agents: live, width: 464, height: 330, scale: 0.78 })
    : `<div style="padding:38px 12px;text-align:center;font:400 11px var(--font-body);
         color:var(--color-dark-text-3)">Sin sesiones activas: todo entregado o en espera.</div>`}
    ${tooltip(flow, roster, state, states)}
    ${parkedRow(flow, parked, states)}
  </div>`;
}

function compactCard(flow, states) {
  const roster = flow.roster || [];
  const archived = flow.status === 'archivado';
  const statusColor = flow.status === 'bloqueado' ? 'var(--state-blocked)'
    : archived ? 'var(--color-dark-text-3)' : 'var(--color-lilac)';

  return `
  <div style="padding:11px 11px 8px;background:var(--color-dark-surface);
       border:1px solid var(--color-dark-border);border-radius:14px;${archived ? 'opacity:.55' : ''}">
    <div style="display:flex;align-items:baseline;gap:6px">
      <span class="mono" style="font-size:10.5px;font-weight:600;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(flow.name || flow.id)}</span>
      <span style="margin-left:auto;font:500 9px var(--font-body);color:${statusColor}">${esc(flow.status || 'activo')}</span>
    </div>
    <div style="font:400 9px var(--font-body);color:var(--color-dark-text-3);margin-top:1px">
      ${esc(flow.split || 'por tema')} · ${roster.length} agentes · $${(flow.cost || 0).toFixed(2)}</div>
    <div style="display:flex;justify-content:center;padding:10px 0 4px">
      ${ringByState({
    // An archived coordinator gets a flat grey ring: its states are history, not status.
    agents: archived ? roster.map(() => ({ state: 'idle' })) : roster,
    states,
    size: 66,
  })}
    </div>
  </div>`;
}

function legend() {
  const item = (svg, text) => `
    <span style="display:flex;align-items:center;gap:7px;font:400 10px var(--font-body);
          color:var(--color-dark-text-3)">${svg}${text}</span>`;
  return `
  <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px">
    ${item(`<svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke-width="1.5"
      stroke-dasharray="6 6" class="edge-live" style="stroke:var(--color-lilac)"></line></svg>`,
    'sesión abierta por el coordinador, animada mientras el agente trabaja')}
    ${item(`<svg width="34" height="8"><path d="M0,6 Q17,0 34,6" fill="none" stroke-width="1"
      stroke-dasharray="2 4" style="stroke:var(--color-mint)"></path></svg>`,
    'enlace entre agentes: se pasan contexto sin volver al coordinador')}
    ${item(`<svg width="34" height="8"><line x1="0" y1="4" x2="34" y2="4" stroke-width="1.1"
      stroke-dasharray="3 5" opacity="0.5" style="stroke:var(--state-blocked)"></line></svg>`,
    'quieto = detenido, nadie avanza por esa arista')}
  </div>`;
}

function toolbar(state, flows, total, accounts = []) {
  const compact = state.flowView === 'compact';
  const accChip = (id, label) => `<button class="chip" aria-pressed="${state.accFlow === id}"
    data-act="accFlow" data-arg="${id}">${label}</button>`;

  const accountChips = accounts.map((a) => accChip(a.id, a.name || a.id)).join('');

  return `
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px">
    <div class="font-display" style="font:600 15px var(--font-display)">Flujos de trabajo</div>
    <div role="tablist" style="display:flex;gap:4px;background:var(--color-dark-bg);padding:4px;
         border-radius:var(--radius-full);border:1px solid var(--color-dark-border)">
      <button class="tab" role="tab" aria-selected="${!compact}" data-act="flowView" data-arg="detail">Detalle</button>
      <button class="tab" role="tab" aria-selected="${compact}" data-act="flowView" data-arg="compact">Compacta · ${total}</button>
    </div>
    <input type="text" data-act="flowQuery" value="${esc(state.flowQuery)}"
      placeholder="Buscar coordinador o repo…"
      style="width:212px;padding:6px 12px;border-radius:var(--radius-full);
             border:1px solid var(--color-dark-border);background:var(--color-dark-bg);
             color:var(--color-dark-text-1);font:400 11px var(--font-body)">
    ${accChip('all', 'Todas')}${accountChips}
    <button class="chip" aria-pressed="${state.showArch}" data-act="showArch">Ver archivados</button>
    <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${flows.length} de ${total}</span>
    <button class="btn-primary" data-act="toggleNewConversation" style="margin-left:auto">
      <span style="font-size:15px;line-height:1">+</span>Crear coordinador</button>
  </div>`;
}

/** @returns {string} */
export function renderFlows(state, data) {
  const all = data.getFlows();
  const accounts = data.getAccounts();
  const q = state.flowQuery.trim().toLowerCase();

  const flows = all.filter((f) => {
    if (!state.showArch && f.status === 'archivado') return false;
    if (state.accFlow !== 'all' && f.accountId !== state.accFlow) return false;
    if (q && !`${f.name} ${f.repos}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const body = state.flowView === 'compact'
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(206px,1fr));gap:12px">
        ${flows.map((f) => compactCard(f, data.STATES)).join('')}
       </div>`
    : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
        ${flows.map((f) => detailCard(f, state, data.STATES, data)).join('')}
       </div>
       ${legend()}`;

  const empty = all.length === 0
    ? `<div style="padding:48px 16px;text-align:center;font:400 12px var(--font-body);
         color:var(--color-dark-text-3)">No hay flujos de trabajo ni coordinadores activos.</div>`
    : (flows.length ? '' : `
    <div style="padding:34px;text-align:center;font:400 11.5px var(--font-body);
         color:var(--color-dark-text-3)">Ningún coordinador calza con el filtro.</div>`);

  return `
  <div>
    ${toolbar(state, flows, all.length, accounts)}
    <div style="font:400 12px/1.6 var(--font-body);color:var(--color-dark-text-3);max-width:680px;margin-bottom:20px">
      Cada petición nueva crea un coordinador. Él decide en cuántas sesiones paralelas se divide el
      trabajo y abre una por cada agente, recibe sus reportes y consolida la entrega. Los agentes
      también se enlazan entre ellos cuando se pasan contexto sin pasar por él.
    </div>
    ${empty || body}
    <div style="margin-top:18px">${renderTimeline(state, data)}</div>
  </div>`;
}
