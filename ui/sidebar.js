// @ts-check
/**
 * The conversation rail: persistent across all five tabs, because a coordinator needs global
 * visibility regardless of which tab happens to be open. Lists conversations from
 * `data.getConversations()` and lets you start a new one or open its coordinator.
 */

import { esc } from './esc.js';

/** "hace 3m" / "hace 2h" / a plain date once it's more than a day old. */
function relTime(iso) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return new Date(then).toLocaleDateString();
}

function newConversationForm(state, data) {
  if (!state.newConvOpen) {
    return `
    <button class="btn-ghost" data-act="toggleNewConversation"
      style="width:100%;border-radius:var(--radius-sm);font-size:11px;padding:8px 10px">
      + nueva conversación
    </button>`;
  }

  const INPUT = 'width:100%;padding:6px 8px;border-radius:var(--radius-sm);'
    + 'border:1px solid var(--color-dark-border);background:var(--color-dark-bg);'
    + 'color:var(--color-dark-text-1);font:400 11px var(--font-body)';

  const engineId = state.newConvEngine || 'claude';
  const models = (data?.ENGINE_MODELS && data.ENGINE_MODELS[engineId]) || [];
  const efforts = (data?.ENGINE_EFFORTS && data.ENGINE_EFFORTS[engineId]) || [];
  const repos = data?.getRepos?.() || [];
  const accounts = data?.getAccounts?.() || [];

  return `
  <div style="display:flex;flex-direction:column;gap:7px;padding:10px;background:var(--color-dark-surface);
       border:1px solid var(--color-dark-border);border-radius:var(--radius-sm)">
    <div style="font:600 10px var(--font-body);text-transform:uppercase;letter-spacing:.05em;color:var(--color-dark-text-3)">
      Nuevo Coordinador
    </div>
    <input data-act="newConvTitle" value="${esc(state.newConvTitle || '')}" placeholder="título (ej. Refactor Auth)…"
      style="${INPUT}">
    <input data-act="newConvTopic" value="${esc(state.newConvTopic || '')}" placeholder="tema u objetivo (opcional)"
      style="${INPUT}">

    <div style="display:flex;flex-direction:column;gap:3px">
      <span style="font:600 9px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3)">Motor</span>
      <select data-act="newConvEngine" style="${INPUT}">
        <option value="claude" ${engineId === 'claude' ? 'selected' : ''}>Claude Code</option>
        <option value="agy" ${engineId === 'agy' ? 'selected' : ''}>Antigravity CLI</option>
      </select>
    </div>

    <div style="display:flex;flex-direction:column;gap:3px">
      <span style="font:600 9px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3)">Modelo</span>
      <input list="newconv-models" data-act="newConvModel" style="${INPUT}"
        value="${esc(state.newConvModel || 'default')}" placeholder="default (ambient)">
      <datalist id="newconv-models">
        <option value="default">Predeterminado (ambient)</option>
        ${models.map((/** @type {any} */ m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
      </datalist>
    </div>

    <div style="display:flex;flex-direction:column;gap:3px">
      <span style="font:600 9px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3)">Nivel de esfuerzo</span>
      <select data-act="newConvEffort" style="${INPUT}">
        <option value="default" ${(!state.newConvEffort || state.newConvEffort === 'default') ? 'selected' : ''}>default (ambient)</option>
        ${efforts.map((/** @type {any} */ ef) => `<option value="${esc(ef)}" ${state.newConvEffort === ef ? 'selected' : ''}>${esc(ef)}</option>`).join('')}
      </select>
    </div>

    <div style="display:flex;flex-direction:column;gap:3px">
      <span style="font:600 9px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3)">Directorio de trabajo</span>
      <div style="display:flex;gap:6px;align-items:center">
        <input data-act="newConvCwd" value="${esc(state.newConvCwd || '')}" placeholder="Buzón por defecto (~/.cute-agents-desk)…"
          style="${INPUT};flex:1;font-size:10px">
        <button class="btn-ghost" data-act="browseNewConvFolder" type="button" style="flex:none;padding:5px 8px;font-size:10px" title="Elegir carpeta existente">Elegir…</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:3px;cursor:pointer" title="Permite al coordinador operar sobre una carpeta que agrupa varios repositorios y delegar tareas en sus sub-repos">
        <input type="checkbox" data-act="newConvMultiRepo" ${state.newConvMultiRepo ? 'checked' : ''} style="cursor:pointer">
        <span style="font:400 9.5px var(--font-body);color:var(--color-dark-text-2)">Habilitar como carpeta paraguas / workspace multi-repo</span>
      </label>
    </div>

    <div style="display:flex;flex-direction:column;gap:3px">
      <span style="font:600 9px var(--font-body);text-transform:uppercase;color:var(--color-dark-text-3)">Modo</span>
      <select data-act="newConvMode" style="${INPUT}">
        <option value="write" ${(!state.newConvMode || state.newConvMode === 'write') ? 'selected' : ''}>Escritura (habilita delegar write)</option>
        <option value="plan" ${state.newConvMode === 'plan' ? 'selected' : ''}>Planificación (solo delega plan/read)</option>
        <option value="read" ${state.newConvMode === 'read' ? 'selected' : ''}>Solo lectura (solo delega read)</option>
      </select>
    </div>

    <div style="font:400 9px/1.35 var(--font-body);color:var(--color-dark-text-3);padding:4px 0;border-top:1px dashed var(--color-dark-border)">
      Alcance: orquestará sobre <strong>${repos.length} repos</strong> de <strong>${accounts.length} cuentas</strong> configuradas.
    </div>

    <div style="display:flex;gap:7px;margin-top:2px">
      <button class="btn-primary" data-act="newConversation" style="flex:1;padding:7px 10px;font-size:11px">
        Crear
      </button>
      <button class="btn-ghost" data-act="toggleNewConversation" style="padding:7px 10px;font-size:11px">
        Cancelar
      </button>
    </div>
  </div>`;
}

function conversationRow(conv, data, isArchived = false) {
  const coord = (data?.getAgents() || []).find((a) => a.conversationId === conv.id && a.role === 'coordinator' && a.state !== 'done' && a.state !== 'failed');
  
  let actionButton = '';
  if (isArchived) {
    actionButton = `
      <div style="display:flex;align-items:center;gap:4px">
        <span class="chip" style="font-size:8.5px;padding:2px 6px;color:var(--color-dark-text-3)">archivado</span>
        <button class="btn-ghost" data-act="deleteConversation" data-arg="${esc(conv.id)}"
          title="Eliminar permanentemente de disco"
          style="font-size:9.5px;padding:2px 6px;color:var(--state-blocked);border-color:var(--state-blocked)">
          Eliminar
        </button>
      </div>`;
  } else if (coord) {
    actionButton = `<button class="chip" data-act="openChat" data-arg="${esc(coord.id)}"
      title="Ver hilo del coordinador" style="font-size:9.5px;padding:3px 8px;border-color:var(--color-lilac);color:var(--color-lilac)">
      coordinando · ver hilo
    </button>`;
  } else {
    actionButton = `<button class="chip" data-act="openCoordinator" data-arg="${esc(conv.id)}"
      title="Abrir coordinador" style="font-size:9.5px;padding:3px 8px">
      abrir coordinador
    </button>`;
  }

  return `
  <div style="display:flex;flex-direction:column;gap:3px;padding:8px 9px;border-radius:var(--radius-sm);
       background:var(--app-surface-tree);${isArchived ? 'opacity:.72' : ''}">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="mono" style="font-size:10.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(conv.title)}</span>
      <span class="mono" style="font-size:9px;color:var(--color-dark-text-3)">cap ${esc(String(conv.cap ?? '—'))}</span>
    </div>
    ${conv.topic ? `<div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3);overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap">${esc(conv.topic)}</div>` : ''}
    ${conv.cwd ? `<div class="mono" style="font-size:8.5px;color:var(--color-dark-text-3);overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap" title="${esc(conv.cwd)}">📁 ${esc(conv.cwd)}</div>` : ''}
    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:2px">
      ${conv.engine ? `<span class="chip" style="font-size:8.5px;padding:1px 5px;background:var(--color-dark-surface)">${esc(conv.engine)}</span>` : ''}
      ${conv.mode && conv.mode !== 'write' ? `<span class="chip" style="font-size:8.5px;padding:1px 5px;background:var(--color-dark-surface)">${esc(conv.mode)}</span>` : ''}
      <span class="mono" style="font-size:9px;color:var(--color-dark-text-3);flex:1">${esc(relTime(conv.createdAt))}</span>
      ${actionButton}
    </div>
  </div>`;
}

/** @returns {string} */
export function renderSidebar(state, data) {
  const conversations = data.getConversations();
  const active = conversations.filter((c) => c.status !== 'archived' && c.status !== 'archivado');
  const archived = conversations.filter((c) => c.status === 'archived' || c.status === 'archivado');

  const activeList = active.length
    ? `<div style="display:flex;flex-direction:column;gap:7px">${active.map((c) => conversationRow(c, data, false)).join('')}</div>`
    : `<div class="mono" style="font-size:10px;line-height:1.5;color:var(--color-dark-text-3);
         padding:9px;background:var(--color-dark-bg);border:1px dashed var(--color-dark-border);
         border-radius:var(--radius-sm)">
         Sin conversaciones activas. Creá una para abrir un coordinador.
       </div>`;

  const archivedSection = archived.length
    ? `<div style="margin-top:auto;padding-top:10px;border-top:1px solid var(--color-dark-border);display:flex;flex-direction:column;gap:8px">
         <button class="chip" data-act="toggleSidebarArchived" style="font-size:9.5px;justify-content:space-between;width:100%">
           <span>Archivadas (${archived.length})</span>
           <span>${state.sidebarArchivedOpen ? '▲' : '▼'}</span>
         </button>
         ${state.sidebarArchivedOpen
           ? `<div style="display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto">
                ${archived.map((c) => conversationRow(c, data, true)).join('')}
              </div>`
           : ''}
       </div>`
    : '';

  return `
  <div style="width:220px;flex:none;padding:16px 12px;border-right:1px solid var(--color-dark-border);
       background:var(--app-surface-sunken);min-width:0;display:flex;flex-direction:column;gap:12px;
       align-self:stretch">
    <div class="font-display" style="font:600 11px var(--font-display);letter-spacing:.05em;
         text-transform:uppercase">Conversaciones</div>
    ${newConversationForm(state, data)}
    ${activeList}
    ${archivedSection}
  </div>`;
}
