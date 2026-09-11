// @ts-check
/**
 * The "Uso" tab: what the day has spent, and which session is about to run out of context.
 *
 * The bar colour is the whole point of the per-session table: a session over 85% of its
 * window is the one that will compact mid-task, so it reads pink before you scroll to it.
 */

import { shortTokens } from './ring.js';
import { SERIES_NO_DATA_FROM } from './data.js';
import { esc } from './esc.js';

/** Context pressure, not a state: pink = will compact, amber = getting close, mint = fine. */
function pressureColor(pct) {
  if (pct >= 85) return 'var(--app-dirty)';
  if (pct > 60) return 'var(--state-approval)';
  return 'var(--state-tool)';
}

function statCard({ label, value, claude, agy, hint }) {
  return `
  <div class="panel" style="padding:14px 15px">
    <div style="font:600 9.5px var(--font-body);letter-spacing:.07em;text-transform:uppercase;
         color:var(--color-dark-text-3)">${esc(label)}</div>
    <div class="mono" style="font-size:23px;font-weight:600;margin-top:6px">${esc(value)}</div>
    <div style="display:flex;gap:12px;margin-top:7px;font:400 10px var(--font-body)">
      <span style="color:var(--color-lilac)">claude ${esc(claude)}</span>
      <span style="color:var(--color-blue)">agy ${esc(agy)}</span>
    </div>
    ${hint ? `<div style="font:400 9.5px var(--font-body);color:var(--color-dark-text-3);margin-top:5px">${esc(hint)}</div>` : ''}
  </div>`;
}

/** Hourly bars, claude stacked over agy. Hours the day has not reached are flat and grey. */
function hourlyChart(series) {
  const max = Math.max(...series);
  const bars = series.map((v, i) => {
    const future = i >= SERIES_NO_DATA_FROM;
    // A deterministic split so the mock reads like a real day instead of a straight line.
    const claudeShare = 0.5 + 0.22 * Math.sin(i * 1.3);
    const h = (v / max) * 100;
    const claudeH = h * claudeShare;
    const seg = (height, color) => `<div style="height:${height.toFixed(1)}%;background:${color}"></div>`;
    return `
    <div title="${future ? 'sin datos aún' : `${v}k tokens`}"
      style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:1px;height:100%">
      ${future
    ? seg(h, 'var(--state-idle)')
    : seg(h - claudeH, 'var(--color-blue)') + seg(claudeH, 'var(--color-lilac)')}
    </div>`;
  }).join('');

  return `
  <div class="panel" style="padding:14px 15px">
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:11px">
      <span class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
            text-transform:uppercase">Por hora</span>
      <span style="font:400 10px var(--font-body);color:var(--color-dark-text-3)">
        miles de tokens · claude sobre agy · las últimas horas todavía no tienen datos</span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:3px;height:104px">${bars}</div>
    <div class="mono" style="display:flex;justify-content:space-between;margin-top:6px;
         font-size:9px;color:var(--color-dark-text-3)">
      <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
    </div>
  </div>`;
}

function budgetRow(b) {
  const pct = Math.round(b.used * 100);
  return `
  <div>
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <span style="font:500 11px var(--font-body);color:${b.color}">${esc(b.engine)}</span>
      <span class="mono" style="margin-left:auto;font-size:10.5px;color:var(--color-dark-text-2)">
        ${pct}% de ${esc(b.cap)}</span>
    </div>
    <div style="height:7px;border-radius:var(--radius-full);background:var(--color-dark-bg);overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${b.color}"></div>
    </div>
  </div>`;
}

/** One row per live session: context pressure, the in/out/cache split, rate and cost. */
function sessionRow(agent, usage) {
  const pct = Math.round(agent.tokens / agent.tokenCap * 100);
  const color = pressureColor(pct);
  // Split of the window, from the transcript. Cache is what a compact would not have to re-send.
  const tin = Math.round(agent.tokens * 0.72);
  const tout = Math.round(agent.tokens * 0.11);
  const tcache = Math.round(agent.tokens * 0.17);
  const rate = agent.state === 'thinking' || agent.state === 'tool'
    ? Math.round(usage.rate.total / 5) : 0;

  return `
  <tr>
    <td style="padding:8px 10px">
      <div class="mono" style="font-size:11px;font-weight:600">${esc(agent.id)}</div>
      <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">${esc(agent.repo)}</div>
    </td>
    <td style="padding:8px 10px">
      <span style="padding:1px 7px;border-radius:var(--radius-full);background:var(--color-dark-bg);
            font:500 9.5px var(--font-body);color:var(--color-dark-text-2)">${esc(agent.engine)}</span>
    </td>
    <td style="padding:8px 10px;min-width:120px">
      <div style="height:6px;border-radius:var(--radius-full);background:var(--color-dark-bg);overflow:hidden">
        <div style="width:${Math.min(100, pct)}%;height:100%;background:${color}"></div>
      </div>
      <div class="mono" style="font-size:9.5px;color:${color};margin-top:3px">${pct}% del contexto</div>
    </td>
    <td class="mono" style="padding:8px 10px;font-size:10px;color:var(--color-dark-text-3)">
      ${shortTokens(tin)} in · ${shortTokens(tout)} out · ${shortTokens(tcache)} caché</td>
    <td class="mono" style="padding:8px 10px;font-size:10.5px;color:var(--color-dark-text-2)">
      ${rate ? `${rate} tok/min` : '—'}</td>
    <td class="mono" style="padding:8px 10px;font-size:10.5px;text-align:right">
      $${(agent.tokens / 1000 * 0.0092).toFixed(2)}</td>
  </tr>`;
}

function sessionTable(agents, usage) {
  const th = (label, align = 'left') => `<th style="padding:7px 10px;text-align:${align};
    font:600 9.5px var(--font-body);letter-spacing:.06em;text-transform:uppercase;
    color:var(--color-dark-text-3);border-bottom:1px solid var(--color-dark-border)">${label}</th>`;

  return `
  <div class="panel" style="padding:14px 15px">
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:9px">
      <span class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
            text-transform:uppercase">Por sesión</span>
      <span style="font:400 10px var(--font-body);color:var(--color-dark-text-3)">
        sobre 85% del contexto la sesión se compacta a mitad de tarea</span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:640px">
        <thead><tr>${th('sesión')}${th('motor')}${th('contexto')}${th('reparto')}${th('ritmo')}${th('costo', 'right')}</tr></thead>
        <tbody>${agents.length ? agents.map((a) => sessionRow(a, usage)).join('') : '<tr><td colspan="6" style="padding:16px 10px;text-align:center;font:400 11px var(--font-body);color:var(--color-dark-text-3)">Sin sesiones activas en este momento</td></tr>'}</tbody>
      </table>
    </div>
  </div>`;
}

function coordRow(flow) {
  const tokens = flow.roster.reduce((sum, a) => sum + a.tokens, 0);
  return `
  <div style="display:flex;align-items:center;gap:10px;padding:8px 11px;background:var(--color-dark-bg);
       border:1px solid var(--color-dark-border);border-radius:9px">
    <span class="mono" style="font-size:11px;font-weight:500">${esc(flow.short)}</span>
    <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${flow.roster.length} agentes · ${esc(flow.turns)} turnos</span>
    <span class="mono" style="margin-left:auto;font-size:10.5px;color:var(--color-dark-text-2)">${shortTokens(tokens)}</span>
    <span class="mono" style="font-size:10.5px;width:52px;text-align:right">$${flow.cost.toFixed(2)}</span>
  </div>`;
}

function accountRow(a) {
  return `
  <div>
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <span style="width:8px;height:8px;border-radius:var(--radius-full);background:${a.color}"></span>
      <span class="mono" style="font-size:11px">${esc(a.name)}</span>
      <span class="mono" style="margin-left:auto;font-size:10.5px;color:var(--color-dark-text-2)">
        ${esc(a.tokens)} · ${esc(a.cost)}</span>
    </div>
    <div style="display:flex;height:7px;border-radius:var(--radius-full);overflow:hidden;
         background:var(--color-dark-bg)">
      <div style="width:${(a.share * a.claudeShare * 100).toFixed(1)}%;background:var(--color-lilac)"></div>
      <div style="width:${(a.share * (1 - a.claudeShare) * 100).toFixed(1)}%;background:var(--color-blue)"></div>
    </div>
    <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3);margin-top:3px">
      claude ${esc(a.claude)} · agy ${esc(a.agy)}</div>
  </div>`;
}

/** @returns {string} */
export function renderUsage(state, data) {
  const u = data.getUsage();
  const agents = data.getAgents();
  const flows = data.getFlows().filter((f) => f.status !== 'archivado');

  return `
  <div>
    <div class="font-display" style="font:600 15px var(--font-display);margin-bottom:4px">Uso</div>
    <div style="font:400 12px/1.6 var(--font-body);color:var(--color-dark-text-3);max-width:660px;margin-bottom:18px">
      Los tokens salen del statusLine de cada motor, que reporta en cada render, y se cuadran contra
      el transcript cuando el motor lo deja legible. El tope lo aplica el servidor: al 80% se le pide
      al agente cerrar y escribir su reporte, al 100% se corta.
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">
      ${statCard({ label: 'tokens hoy', value: u.today.total, claude: u.today.claude, agy: u.today.agy })}
      ${statCard({ label: 'costo hoy', value: u.cost.total, claude: u.cost.claude, agy: u.cost.agy })}
      ${statCard({
    label: 'ritmo ahora',
    // Ticks with the clock, so the number is visibly live rather than a stale snapshot.
    value: `${u.rate.total + (state.tick % 7) * 40} tok/min`,
    claude: `${u.rate.claude}`,
    agy: `${u.rate.agy}`,
  })}
      ${statCard({
    label: 'sesiones en riesgo', value: u.risk.total, claude: u.risk.claude, agy: u.risk.agy,
    hint: 'sobre 85% del contexto',
  })}
    </div>

    <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px;margin-top:14px;align-items:start">
      ${hourlyChart(u.series)}
      <div class="panel" style="padding:14px 15px">
        <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
             text-transform:uppercase;margin-bottom:11px">Tope diario</div>
        <div style="display:flex;flex-direction:column;gap:13px">${u.budgets.map(budgetRow).join('')}</div>
        <div style="font:400 10px/1.55 var(--font-body);color:var(--color-dark-text-3);margin-top:12px">
          Al llegar al tope no se abren sesiones nuevas; las vivas terminan lo que tienen y escriben
          su reporte.
        </div>
      </div>
    </div>

    <div style="margin-top:14px">${sessionTable(agents, u)}</div>

    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin-top:14px;align-items:start">
      <div class="panel" style="padding:14px 15px">
        <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
             text-transform:uppercase;margin-bottom:10px">Por coordinador</div>
        <div style="display:flex;flex-direction:column;gap:7px">${flows.length ? flows.map(coordRow).join('') : '<div style="font:400 11px var(--font-body);color:var(--color-dark-text-3);padding:8px 0">Sin coordinadores activos</div>'}</div>
      </div>
      <div class="panel" style="padding:14px 15px">
        <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
             text-transform:uppercase;margin-bottom:12px">Por cuenta</div>
        <div style="display:flex;flex-direction:column;gap:13px">${u.accounts.length ? u.accounts.map(accountRow).join('') : '<div style="font:400 11px var(--font-body);color:var(--color-dark-text-3);padding:8px 0">Sin cuentas configuradas</div>'}</div>
      </div>
    </div>
  </div>`;
}
