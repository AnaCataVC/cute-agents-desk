// @ts-check
/**
 * "Tareas programadas": a read-only view of what Claude Desktop and Antigravity have scheduled
 * on this machine, entirely outside this app. Two sections, one per engine — a section with
 * nothing found renders nothing, rather than an empty "0 tareas" for a scheduler never used.
 */

import { esc } from './esc.js';

const DOW = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/** @param {string} field */
function parseList(field) {
  return /^\d+(,\d+)*$/.test(field) ? field.split(',').map(Number) : null;
}

/** @param {string} field */
function humanizeDow(field) {
  if (field === '*') return null;
  const range = field.match(/^(\d)-(\d)$/);
  if (range) return `${DOW[+range[1] % 7]}-${DOW[+range[2] % 7]}`;
  if (/^\d(,\d)*$/.test(field)) return field.split(',').map((d) => DOW[+d % 7]).join(', ');
  return null;
}

/**
 * Covers exactly the cron shapes seen on this machine (single/comma-separated minute or hour,
 * `*` day-of-month and month, single/list/range day-of-week). Anything outside that falls back
 * to `null` so the caller shows the raw cron instead — no attempt to generalize further.
 * @param {string} expr
 */
function humanizeCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') return null;
  const minutes = parseList(min);
  const hours = parseList(hour);
  if (!minutes || !hours || (minutes.length > 1 && hours.length > 1)) return null;
  const times = minutes.length > 1
    ? minutes.map((m) => `${hours[0]}:${String(m).padStart(2, '0')}`)
    : hours.map((h) => `${h}:${String(minutes[0]).padStart(2, '0')}`);
  const dayPart = humanizeDow(dow);
  return dayPart ? `${dayPart} ${times.join(' y ')}` : times.join(' y ');
}

/** @param {string|null} iso */
function relativeTime(iso) {
  if (!iso) return 'nunca';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'nunca';
  const min = Math.round(ms / 60000);
  if (min < 60) return `hace ${min || 1} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/**
 * Estimates the next run time for a cron expression or fireAt timestamp.
 * @param {{fireAt: number|null, cronExpression: string|null}} task
 * @returns {string|null}
 */
export function calculateNextRun(task) {
  if (task.fireAt) {
    const diff = task.fireAt - Date.now();
    if (diff <= 0) return 'vencida';
    const min = Math.round(diff / 60000);
    if (min < 60) return `en ${min || 1} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `en ${h} h`;
    return `en ${Math.round(h / 24)} d`;
  }
  if (!task.cronExpression) return null;
  const parts = String(task.cronExpression).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') return null;
  const minutes = parseList(min);
  const hours = parseList(hour);
  if (!minutes || !hours) return null;

  // Day of week set (0-6, Sunday=0)
  let dowSet = null;
  if (dow !== '*') {
    const range = dow.match(/^(\d)-(\d)$/);
    if (range) {
      dowSet = new Set();
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let i = start; i <= end; i++) dowSet.add(i % 7);
    } else if (/^\d(,\d)*$/.test(dow)) {
      dowSet = new Set(dow.split(',').map((d) => Number(d) % 7));
    }
  }

  const now = new Date();
  // Search the next 14 days for the soonest matching slot
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const testDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
    const dayOfWeek = testDate.getDay();
    if (dowSet && !dowSet.has(dayOfWeek)) continue;

    for (const h of hours) {
      for (const m of minutes) {
        const candidate = new Date(testDate.getFullYear(), testDate.getMonth(), testDate.getDate(), h, m, 0, 0);
        const diff = candidate.getTime() - now.getTime();
        if (diff > 0) {
          const diffMin = Math.round(diff / 60000);
          if (diffMin < 60) return `en ${diffMin || 1} min (${candidate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
          const diffH = Math.round(diffMin / 60);
          if (diffH < 24 && candidate.getDate() === now.getDate()) {
            return `hoy a las ${candidate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          }
          if (diffH < 48 && candidate.getDate() === (now.getDate() + 1)) {
            return `mañana a las ${candidate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
          }
          return `${DOW[dayOfWeek]} ${candidate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }
      }
    }
  }
  return null;
}

/** @param {{fireAt: number|null, cronExpression: string|null}} task */
function schedulePill(task) {
  if (task.fireAt) {
    return `<span class="value-pill mono">una vez · ${esc(new Date(task.fireAt).toLocaleString())}</span>`;
  }
  if (!task.cronExpression) return `<span class="value-pill mono">sin horario</span>`;
  const human = humanizeCron(task.cronExpression);
  return `<span class="value-pill mono" title="${esc(task.cronExpression)}">${esc(human || task.cronExpression)}</span>`;
}

/** @param {{enabled: boolean|null}} task */
function statusPill(task) {
  if (task.enabled === null) return `<span class="value-pill mono" style="color:var(--color-dark-text-3)">sin dato</span>`;
  return task.enabled
    ? `<span class="value-pill mono" style="background:var(--color-mint);color:var(--app-on-accent)">activa</span>`
    : `<span class="value-pill mono" style="color:var(--color-dark-text-3)">pausada</span>`;
}

const MODE_LABEL = { local: 'sesión local', 'cloud-vm': 'VM en la nube' };

function taskCard(task) {
  const desc = task.description && task.engine === 'agy' && task.description.length > 140
    ? `${task.description.slice(0, 140)}…`
    : task.description;
  const nextRun = calculateNextRun(task);

  return `
  <div class="panel" style="padding:14px">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <span style="font:600 12.5px var(--font-display)">${esc(task.name)}</span>
      ${task.mode ? `<span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(MODE_LABEL[task.mode] || task.mode)}</span>` : ''}
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        ${statusPill(task)}
      </span>
    </div>
    ${desc ? `<div style="font:400 11.5px/1.55 var(--font-body);color:var(--color-dark-text-2);margin-top:8px">${esc(desc)}</div>` : ''}
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px">
      ${schedulePill(task)}
      ${nextRun ? `<span class="value-pill mono" style="color:var(--color-lilac)" title="Próxima corrida estimada">próxima · ${esc(nextRun)}</span>` : ''}
      <span class="mono" style="margin-left:auto;font-size:10.5px;color:var(--color-dark-text-3)">
        última corrida · ${esc(relativeTime(task.lastRunAt))}</span>
      <button class="btn-ghost" data-act="inspectTask"
              data-id="${esc(task.id || '')}" data-name="${esc(task.name || '')}"
              data-engine="${esc(task.engine || '')}" data-source="${esc(task.sourcePath || '')}"
              style="padding:3px 10px;font-size:10px;border-style:dashed">
        Ver logs
      </button>
    </div>
  </div>`;
}

function engineSection(title, tasks) {
  if (!tasks.length) return '';
  return `
  <div style="margin-bottom:22px">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">
      <span style="font:500 10px var(--font-body);color:var(--app-on-accent);background:var(--color-lilac);
            padding:2px 8px;border-radius:var(--radius-full)">${esc(title)}</span>
      <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-3)">${tasks.length} tarea${tasks.length === 1 ? '' : 's'}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${tasks.map(taskCard).join('')}</div>
  </div>`;
}

/**
 * @param {object} state  unused today — no tab-local UI state yet, kept for signature parity
 *   with every other `render<Tab>(state, data)` component
 * @param {typeof import('./data.js')} data
 * @returns {string}
 */
export function renderScheduledTasks(state, data) {
  const tasks = data.getScheduledTasks();
  if (!tasks.length) {
    return `<div class="panel" style="padding:24px;text-align:center;color:var(--color-dark-text-3);font-size:12.5px">
      No se encontró ninguna tarea programada de Claude Desktop ni de Antigravity en esta máquina.</div>`;
  }
  const claude = tasks.filter((t) => t.engine === 'claude');
  const agy = tasks.filter((t) => t.engine === 'agy');
  return `
  <div>
    ${engineSection('Claude Desktop', claude)}
    ${engineSection('Antigravity', agy)}
  </div>`;
}
