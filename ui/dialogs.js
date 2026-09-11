// @ts-check
/**
 * The modals: queue a task, add a folder to an account, and the agent thread.
 *
 * All three share one shell so Escape, the backdrop click and the stacking order are defined
 * once. Only one is ever open — the shell renders the innermost, which is the same order
 * Escape closes them in.
 */

import { renderChat } from './chat.js';
import { esc } from './esc.js';

function shell(body, width, closeAct) {
  return `
  <div role="dialog" aria-modal="true" data-act="${closeAct}" data-backdrop
    style="position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;
           padding:24px;background:rgba(10,8,18,.72)">
    <div style="width:100%;max-width:${width}px;background:var(--color-dark-surface);
         border:1px solid var(--color-dark-border);border-radius:var(--radius-lg);
         box-shadow:var(--shadow-lg);overflow:hidden">${body}</div>
  </div>`;
}

function field(label, control, hint) {
  return `
  <div style="display:flex;flex-direction:column;gap:5px">
    <span style="font:600 9.5px var(--font-body);letter-spacing:.06em;text-transform:uppercase;
          color:var(--color-dark-text-3)">${esc(label)}</span>
    ${control}
    ${hint ? `<span style="font:400 9.5px var(--font-body);color:var(--color-dark-text-3)">${esc(hint)}</span>` : ''}
  </div>`;
}

const INPUT = 'width:100%;padding:9px 12px;border-radius:var(--radius-sm);'
  + 'border:1px solid var(--color-dark-border);background:var(--color-dark-bg);'
  + 'color:var(--color-dark-text-1);font:400 11.5px var(--font-body)';

/** Queue a task. The account line is the point of this dialog: it says who will sign the push. */
function queueDialog(state, data) {
  const repos = data.getRepos();
  const repo = state.queue ? repos.find((r) => r.name === state.queue) : null;
  const account = repo ? data.getAccounts().find((a) => a.id === repo.accountId) : null;
  const flows = data.getFlows().filter((f) => f.status !== 'archivado');

  const engineId = state.queueEngine || 'claude';
  const models = (data.ENGINE_MODELS && data.ENGINE_MODELS[engineId]) || [];
  const efforts = (data.ENGINE_EFFORTS && data.ENGINE_EFFORTS[engineId]) || [];
  const modes = (data.ENGINE_MODES && data.ENGINE_MODES[engineId]) || [];
  const activeMode = state.queueMode || 'write';

  const repoField = repo
    ? `<div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:var(--color-dark-bg);
         border:1px solid var(--color-dark-border);border-radius:var(--radius-sm)">
        <span class="mono" style="font-size:11.5px;font-weight:600">${esc(repo.name)}</span>
        <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(repo.folder)}</span>
       </div>`
    : `<select style="${INPUT}" data-act="queueRepo">${repos.slice(0, 20).map((r) => `<option value="${esc(r.name)}" ${state.queueRepo === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;

  const modeHint = activeMode === 'read' ? 'En modo lectura los hooks niegan Edit y Write'
    : activeMode === 'plan' ? 'En modo planificación el agente diagnostica y diseña sin modificar código'
    : activeMode === 'auto' ? 'En modo autónomo Claude evalúa permisos automáticamente'
    : 'En modo escritura se aíslan los cambios en un git worktree aparte';

  return shell(`
    <div style="padding:16px 18px;border-bottom:1px solid var(--color-dark-border)">
      <div class="font-display" style="font:600 14px var(--font-display)">Nueva petición</div>
      <div style="font:400 11px/1.55 var(--font-body);color:var(--color-dark-text-3);margin-top:3px">
        Despacha un agente con modelo, esfuerzo y modo de ejecución configurables.
      </div>
    </div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:13px">
      ${field('Repo', repoField)}
      ${field('Qué hay que hacer', `<textarea rows="3" data-act="queueTask" style="${INPUT};resize:vertical"
        placeholder="Cachear las rutas resueltas sin cambiar el contrato del endpoint…">${esc(state.queueTask || '')}</textarea>`)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${field('Motor', `<select style="${INPUT}" data-act="queueEngine">
          <option value="claude" ${engineId === 'claude' ? 'selected' : ''}>claude cli</option>
          <option value="agy" ${engineId === 'agy' ? 'selected' : ''}>agy cli</option>
        </select>`)}
        ${field('Coordinador', `<select style="${INPUT}" data-act="queueCoord">
          <option value="">Despacho directo (sin coordinador)</option>
          ${flows.map((f) => `<option value="${esc(f.id)}" ${state.queueCoord === f.id ? 'selected' : ''}>Reutilizar · ${esc(f.short)}</option>`).join('')}
        </select>`, 'Reutilizar mantiene el contexto')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${field('Modelo', `<input list="queue-models" data-act="queueModel" style="${INPUT}"
          value="${esc(state.queueModel || 'default')}" placeholder="default (ambient)">
          <datalist id="queue-models">
            <option value="default">Predeterminado (ambient)</option>
            ${models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </datalist>`, 'Alias o ID del modelo')}
        ${field('Nivel de esfuerzo / razonamiento', `<select style="${INPUT}" data-act="queueEffort">
          <option value="default" ${(!state.queueEffort || state.queueEffort === 'default') ? 'selected' : ''}>default (ambient)</option>
          ${efforts.map((ef) => `<option value="${esc(ef)}" ${state.queueEffort === ef ? 'selected' : ''}>${esc(ef)}</option>`).join('')}
        </select>`, 'Presupuesto de tokens de pensamiento')}
      </div>
      ${field('Modo', `<div style="display:flex;gap:7px;flex-wrap:wrap">
        ${modes.map((m) => `<button class="chip" data-act="queueMode" data-arg="${esc(m.id)}" aria-pressed="${activeMode === m.id}">${esc(m.label)}</button>`).join('')}
      </div>`, modeHint)}
      ${account ? `
      <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--color-dark-bg);
           border-left:3px solid ${account.color};border-radius:var(--radius-sm)">
        <span style="font:400 10.5px var(--font-body);color:var(--color-dark-text-3)">firmará</span>
        <span class="mono" style="font-size:11px;font-weight:600;color:${account.color}">${esc(account.name)}</span>
        <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(account.email)}</span>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:9px;justify-content:flex-end;padding:13px 18px;
         border-top:1px solid var(--color-dark-border);background:var(--app-surface-sunken)">
      <button class="btn-ghost" data-act="closeQueue">Cancelar</button>
      <button class="btn-primary" data-act="submitQueue" style="padding:9px 18px">Encolar</button>
    </div>`, 560, 'closeQueue');
}

/** Add a folder: scan it, then pick which of the repos found actually get managed. */
function scanDialog(state, data) {
  const account = data.getAccounts().find((a) => a.id === state.scan);
  if (!account) return '';
  const s = data.getScanSummary();

  const rows = data.getScanCandidates().map((c) => {
    const tagColor = c.tag === 'ok' ? 'var(--color-dark-text-3)'
      : c.tag === 'sin remoto' ? 'var(--app-dirty)' : 'var(--state-approval)';
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 11px;background:var(--color-dark-bg);
         border:1px solid var(--color-dark-border);border-radius:8px">
      <span class="toggle-track" data-on="${c.picked}"><span class="toggle-knob" data-on="${c.picked}"></span></span>
      <span class="mono" style="font-size:11px;font-weight:500">${esc(c.name)}</span>
      <span class="mono" style="font-size:9.5px;color:var(--color-dark-text-3);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(c.remote)}</span>
      <span style="margin-left:auto;font:500 9px var(--font-body);color:${tagColor};flex:none">${esc(c.tag)}</span>
    </div>`;
  }).join('');

  const depthChip = (d) => `<button class="chip" aria-pressed="${state.scanDepth === d}"
    data-act="scanDepth" data-arg="${d}">${d} niveles</button>`;

  return shell(`
    <div style="padding:16px 18px;border-bottom:1px solid var(--color-dark-border)">
      <div class="font-display" style="font:600 14px var(--font-display)">Añadir carpeta</div>
      <div style="font:400 11px var(--font-body);color:var(--color-dark-text-3);margin-top:3px">
        Todo repo bajo esta carpeta heredará
        <span class="mono" style="color:${account.color}">${esc(account.name)}</span>.
      </div>
    </div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:14px">
      ${field('Ruta', `<input type="text" placeholder="~/ruta/a/repositorios" value="" style="${INPUT}">`)}
      ${field('Profundidad', `<div style="display:flex;gap:7px">${[1, 2, 3].map(depthChip).join('')}</div>`,
    'Más profundidad encuentra más repos y tarda más; los node_modules y .git anidados se saltan siempre')}
      ${field(`Repos encontrados · ${data.getScanCandidates().filter((c) => c.picked).length} de ${data.getScanCandidates().length}`,
    `<div style="display:flex;flex-direction:column;gap:6px;max-height:230px;overflow-y:auto">${rows || '<div style="font:400 11px var(--font-body);color:var(--color-dark-text-3);padding:8px 0;text-align:center">Sin repositorios escaneados todavía.</div>'}</div>`,
    `último escaneo ${s.when} · ${s.took}`)}
    </div>
    <div style="display:flex;gap:9px;justify-content:flex-end;padding:13px 18px;
         border-top:1px solid var(--color-dark-border);background:var(--app-surface-sunken)">
      <button class="btn-ghost" data-act="closeScan">Cancelar</button>
      <button class="btn-primary" style="padding:9px 18px">Añadir carpeta</button>
    </div>`, 520, 'closeScan');
}

/** @returns {string} */
export function renderDialogs(state, data) {
  if (state.chat) return shell(renderChat(state, data), 900, 'closeChat');
  if (state.queue !== null) return queueDialog(state, data);
  if (state.scan) return scanDialog(state, data);
  return '';
}
