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

/**
 * @param {string} body - HTML content of the modal body
 * @param {number} width - Maximum width of the modal in pixels
 * @param {string} closeAct - Action identifier dispatched to close the dialog
 * @returns {string}
 */
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

/**
 * @param {string} label
 * @param {string} control
 * @param {string} [hint]
 * @returns {string}
 */
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

/**
 * Queue a task. The account line is the point of this dialog: it says who will sign the push.
 * @param {any} state
 * @param {any} data
 * @returns {string}
 */
function queueDialog(state, data) {
  const repos = data.getRepos();
  const repo = state.queue ? (repos.find((/** @type {any} */ r) => r.path === state.queue) || repos.find((/** @type {any} */ r) => r.name === state.queue)) : null;
  const account = repo ? data.getAccounts().find((/** @type {any} */ a) => a.id === repo.accountId) : null;
  const flows = data.getFlows().filter((/** @type {any} */ f) => f.status !== 'archivado');

  const engineId = state.queueEngine || 'claude';
  const models = (data.ENGINE_MODELS && data.ENGINE_MODELS[engineId]) || [];
  const efforts = (data.ENGINE_EFFORTS && data.ENGINE_EFFORTS[engineId]) || [];
  const modes = (data.ENGINE_MODES && data.ENGINE_MODES[engineId]) || [];
  const activeMode = state.queueMode || 'write';

  const repoField = repo
    ? `<div style="display:flex;align-items:center;gap:9px;padding:9px 12px;background:var(--color-dark-bg);
         border:1px solid var(--color-dark-border);border-radius:var(--radius-sm)"
         title="${esc(repo.path || `${repo.folder}/${repo.name}`)}">
        <span class="mono" style="font-size:11.5px;font-weight:600">${esc(repo.name)}</span>
        <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(repo.relPath || repo.folder)}</span>
       </div>`
    : `<select style="${INPUT}" data-act="queueRepo">${repos.slice(0, 20).map((/** @type {any} */ r) => `<option value="${esc(r.path || r.name)}" ${(state.queueRepo === r.path || state.queueRepo === r.name) ? 'selected' : ''}>${esc(r.relPath || r.name)}</option>`).join('')}</select>`;

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
          ${flows.map((/** @type {any} */ f) => `<option value="${esc(f.id)}" ${state.queueCoord === f.id ? 'selected' : ''}>Reutilizar · ${esc(f.short)}</option>`).join('')}
        </select>`, 'Reutilizar mantiene el contexto')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${field('Modelo', `<input list="queue-models" data-act="queueModel" style="${INPUT}"
          value="${esc(state.queueModel || 'default')}" placeholder="default (ambient)">
          <datalist id="queue-models">
            <option value="default">Predeterminado (ambient)</option>
            ${models.map((/** @type {any} */ m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </datalist>`, 'Alias o ID del modelo')}
        ${field('Nivel de esfuerzo / razonamiento', `<select style="${INPUT}" data-act="queueEffort">
          <option value="default" ${(!state.queueEffort || state.queueEffort === 'default') ? 'selected' : ''}>default (ambient)</option>
          ${efforts.map((/** @type {any} */ ef) => `<option value="${esc(ef)}" ${state.queueEffort === ef ? 'selected' : ''}>${esc(ef)}</option>`).join('')}
        </select>`, 'Presupuesto de tokens de pensamiento')}
      </div>
      ${field('Modo', `<div style="display:flex;gap:7px;flex-wrap:wrap">
        ${modes.map((/** @type {any} */ m) => `<button class="chip" data-act="queueMode" data-arg="${esc(m.id)}" aria-pressed="${activeMode === m.id}">${esc(m.label)}</button>`).join('')}
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

/**
 * Add a folder: scan it, then pick which of the repos found actually get managed.
 * @param {any} state
 * @param {any} data
 * @returns {string}
 */
function scanDialog(state, data) {
  const account = data.getAccounts().find((/** @type {any} */ a) => a.id === state.scan);
  if (!account) return '';
  const s = data.getScanSummary();

  const rows = data.getScanCandidates().map((/** @type {any} */ c) => {
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

  /** @param {number} d */
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
      ${field('Ruta', `
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" data-act="scanPath" placeholder="~/ruta/a/repositorios" value="${esc(state.scanPath || '')}" style="${INPUT};flex:1">
          <button class="btn-ghost" data-act="browseScanFolder" type="button" style="flex:none;padding:7px 12px;font-size:11px">Elegir carpeta…</button>
        </div>`)}
      ${field('Profundidad', `<div style="display:flex;gap:7px">${[1, 2, 3].map(depthChip).join('')}</div>`,
    'Más profundidad encuentra más repos y tarda más; los node_modules y .git anidados se saltan siempre')}
      ${state.scanError ? `
        <div style="padding:8px 12px;background:var(--who-system-bg);border:1px solid var(--state-blocked);border-radius:var(--radius-sm);font:500 11px var(--font-body);color:var(--state-blocked)">
          ${esc(state.scanError)}
        </div>` : ''}
    </div>
    <div style="display:flex;gap:9px;justify-content:flex-end;padding:13px 18px;
         border-top:1px solid var(--color-dark-border);background:var(--app-surface-sunken)">
      <button class="btn-ghost" data-act="closeScan">Cancelar</button>
      <button class="btn-primary" data-act="submitScanFolder" style="padding:9px 18px">Añadir carpeta</button>
    </div>`, 520, 'closeScan');
}

/**
 * @param {any} state
 * @param {any} _data
 * @returns {string}
 */
function skillDialog(state, _data) {
  const sk = state.inspectedSkill;
  if (!sk) return '';
  const tokensDesc = sk.tokens && Number(sk.tokens) > 0
    ? `~${sk.tokens} tokens estimados (${Math.round(sk.tokens * 4 / 1024)} KB)`
    : 'No medible (sin archivo o vacío)';

  const contentDisplay = sk.loading
    ? `<div style="padding:24px;text-align:center;color:var(--color-dark-text-3);font:400 12px var(--font-body)">Cargando SKILL.md…</div>`
    : sk.error
      ? `<div style="padding:16px;color:var(--app-on-warning);background:var(--who-system-bg);border-radius:8px;font:400 11px var(--font-body)">${esc(sk.error)}</div>`
      : `<pre class="mono" style="margin:0;padding:12px;max-height:360px;overflow-y:auto;background:var(--color-dark-bg);border:1px solid var(--color-dark-border);border-radius:8px;font-size:11px;line-height:1.6;color:var(--color-dark-text-1);white-space:pre-wrap;word-break:break-word">${esc(sk.content || '(Archivo vacío)')}</pre>`;

  return shell(`
    <div style="padding:16px 18px;border-bottom:1px solid var(--color-dark-border);display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font:600 14px var(--font-mono);color:var(--color-dark-text-1)">${esc(sk.name)}</span>
          <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(sk.version || '—')}</span>
          <span style="padding:1px 7px;border-radius:var(--radius-full);font:600 9px var(--font-body);
                background:${sk.load === 'siempre' ? 'var(--app-on-accent)' : 'var(--color-dark-surface)'};
                color:${sk.load === 'siempre' ? 'var(--color-lilac)' : 'var(--color-dark-text-3)'}">${esc(sk.load)}</span>
        </div>
        <div style="font:400 11.5px var(--font-body);color:var(--color-dark-text-2);margin-top:4px;max-width:540px">
          ${esc(sk.desc)}
        </div>
      </div>
      <button class="btn-ghost" data-act="closeSkillInspector" style="padding:4px 8px;font-size:11px">✕</button>
    </div>

    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:16px;flex-wrap:wrap;background:var(--color-dark-bg);padding:10px 14px;border-radius:8px;border:1px solid var(--color-dark-border)">
        <div>
          <span style="font:600 9.5px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3);display:block">Motor</span>
          <span class="mono" style="font-size:11px;color:var(--color-lilac)">${esc(sk.engine)}</span>
        </div>
        <div>
          <span style="font:600 9.5px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3);display:block">Impacto en Contexto</span>
          <span class="mono" style="font-size:11px;color:var(--color-mint)">${esc(tokensDesc)}</span>
        </div>
      </div>

      <div>
        <span style="font:600 9.5px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3);margin-bottom:6px;display:block">
          Contenido de SKILL.md
        </span>
        ${contentDisplay}
      </div>
    </div>

    <div style="display:flex;gap:9px;justify-content:space-between;align-items:center;padding:12px 18px;
         border-top:1px solid var(--color-dark-border);background:var(--app-surface-sunken)">
      ${sk.folder ? `
        <button class="btn-ghost" data-act="openFolderInExplorer" data-target="${esc(sk.folder)}"
                style="display:flex;align-items:center;gap:6px;font-size:11px"
                title="Abrir directorio en el Explorador de Windows">
          <span>Abrir carpeta en Explorador</span>
        </button>
      ` : '<div></div>'}
      <button class="btn-ghost" data-act="closeSkillInspector">Cerrar</button>
    </div>
  `, 640, 'closeSkillInspector');
}

/**
 * @param {any} state
 * @param {any} _data
 * @returns {string}
 */
function taskLogDialog(state, _data) {
  const tk = state.inspectedTask;
  if (!tk) return '';

  const contentDisplay = tk.loading
    ? `<div style="padding:24px;text-align:center;color:var(--color-dark-text-3);font:400 12px var(--font-body)">Leyendo logs…</div>`
    : tk.error
      ? `<div style="padding:16px;color:var(--app-on-warning);background:var(--who-system-bg);border-radius:8px;font:400 11px var(--font-body)">${esc(tk.error)}</div>`
      : `<pre class="mono" style="margin:0;padding:12px;max-height:360px;overflow-y:auto;background:var(--color-dark-bg);border:1px solid var(--color-dark-border);border-radius:8px;font-size:10.5px;line-height:1.55;color:var(--color-dark-text-1);white-space:pre-wrap;word-break:break-all">${esc(tk.logs || '(Sin líneas de log)')}</pre>`;

  return shell(`
    <div style="padding:16px 18px;border-bottom:1px solid var(--color-dark-border);display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font:600 14px var(--font-mono);color:var(--color-dark-text-1)">${esc(tk.name)}</span>
          <span style="font:500 9.5px var(--font-body);color:var(--app-on-accent);background:var(--color-lilac);
                padding:2px 8px;border-radius:var(--radius-full)">${esc(tk.engine)}</span>
        </div>
        <div style="font:400 11px var(--font-body);color:var(--color-dark-text-3);margin-top:3px">
          Registro de ejecución reciente y estado en disco
        </div>
      </div>
      <button class="btn-ghost" data-act="closeTaskInspector" style="padding:4px 8px;font-size:11px">✕</button>
    </div>

    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
      ${contentDisplay}
    </div>

    <div style="display:flex;gap:9px;justify-content:space-between;align-items:center;padding:12px 18px;
         border-top:1px solid var(--color-dark-border);background:var(--app-surface-sunken)">
      ${tk.source ? `
        <button class="btn-ghost" data-act="openFolderInExplorer" data-target="${esc(tk.source)}"
                style="display:flex;align-items:center;gap:6px;font-size:11px"
                title="Abrir ubicación de la tarea en el Explorador de Windows">
          <span>Abrir ubicación en Explorador</span>
        </button>
      ` : '<div></div>'}
      <button class="btn-ghost" data-act="closeTaskInspector">Cerrar</button>
    </div>
  `, 680, 'closeTaskInspector');
}

/** 
 * @param {any} state
 * @param {any} data
 * @returns {string}
 */
export function renderDialogs(state, data) {
  if (state.chat) return shell(renderChat(state, data), 900, 'closeChat');
  if (state.inspectedSkill) return skillDialog(state, data);
  if (state.inspectedTask) return taskLogDialog(state, data);
  if (state.queue !== null) return queueDialog(state, data);
  if (state.scan) return scanDialog(state, data);
  return '';
}

