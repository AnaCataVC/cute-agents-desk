// @ts-check
/**
 * The "Visualizador" tab: what the agents changed and have not integrated yet,
 * inspecting uncommitted work in isolated worktrees before approval.
 *
 * This is not a code editor; it is a diff inspection gatekeeper. The diff is what you approve,
 * and conflicts with main are surfaced before initiating PR delivery.
 */

import { esc } from './esc.js';
import { highlightLine } from './highlight.js';

/** A tab id pairs the agent with the file: the same path exists in two branches at once. */
const tabId = (agentId, path) => `${agentId}:${path}`;
const splitTab = (id) => {
  const at = id.indexOf(':');
  return { agentId: id.slice(0, at), path: id.slice(at + 1) };
};

function statusColor(status) {
  if (status === 'con conflicto') return 'var(--state-blocked)';
  if (status === 'commit sin empujar') return 'var(--state-approval)';
  return 'var(--state-tool)';
}

function counts(add, del) {
  return `<span class="mono" style="font-size:9.5px">
    <span style="color:var(--app-diff-add-line)">+${add}</span>
    <span style="color:var(--app-diff-del-line);margin-left:4px">−${del}</span></span>`;
}

/** Left column: one group per agent with uncommitted work, its files inside. */
function changeTree(state, diffs) {
  const groups = Object.entries(diffs).map(([agentId, d]) => {
    const closed = state.treeClosed[agentId];
    const files = closed ? '' : d.files.map((f) => {
      const id = tabId(agentId, f.path);
      const active = state.visualizerActive === id;
      return `
      <button data-act="openFile" data-arg="${esc(id)}"
        style="display:flex;align-items:center;gap:7px;width:100%;padding:5px 9px 5px 20px;border:none;
               cursor:pointer;text-align:left;background:${active ? 'var(--color-dark-surface-2)' : 'transparent'};
               color:${active ? 'var(--color-dark-text-1)' : 'var(--color-dark-text-2)'}">
        <span class="mono" style="flex:1;min-width:0;font-size:10.5px;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left">${esc(f.path)}</span>
        ${f.conflict
    ? `<span style="padding:0 6px;border-radius:var(--radius-full);background:var(--state-blocked);
           color:var(--color-dark-text-1);font:600 8.5px var(--font-body)">choca</span>`
    : counts(f.add, f.del)}
      </button>`;
    }).join('');

    return `
    <div style="border-bottom:1px solid var(--color-dark-border)">
      <button data-act="toggleTreeNode" data-arg="${esc(agentId)}"
        style="display:flex;align-items:center;gap:7px;width:100%;padding:8px 9px;border:none;
               background:transparent;cursor:pointer;text-align:left;color:var(--color-dark-text-1)">
        <span class="mono" style="font-size:9px;color:var(--color-dark-text-3);width:8px">${closed ? '▸' : '▾'}</span>
        <div style="flex:1;min-width:0">
          <div class="mono" style="font-size:11px;font-weight:600;overflow:hidden;
               text-overflow:ellipsis;white-space:nowrap">${esc(agentId)}</div>
          <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">${esc(d.repo)} · ${esc(d.branch)}</div>
        </div>
        <span style="font:500 9px var(--font-body);color:${statusColor(d.status)};text-align:right">${esc(d.status)}</span>
      </button>
      ${files}
    </div>`;
  }).join('');

  return `
  <div style="background:var(--app-surface-sunken);border:1px solid var(--color-dark-border);
       border-radius:var(--radius-lg);overflow:hidden;align-self:start">
    <div style="padding:11px 12px;border-bottom:1px solid var(--color-dark-border)">
      <div class="font-display" style="font:600 11px var(--font-display);letter-spacing:.05em;
           text-transform:uppercase">Cambios sin integrar</div>
      <div style="font:400 9.5px var(--font-body);color:var(--color-dark-text-3);margin-top:2px">
        lo que hay en los worktrees y todavía no es un PR</div>
    </div>
    ${groups || `<div style="padding:18px 12px;text-align:center;font:400 11px var(--font-body);
         color:var(--color-dark-text-3)">Sin cambios pendientes en los worktrees.</div>`}
  </div>`;
}

function openTabs(state) {
  const tabsList = state.visualizerOpen || [];
  if (!tabsList.length) return '';
  const tabs = tabsList.map((id) => {
    const { path } = splitTab(id);
    const active = state.visualizerActive === id;
    const name = path.split('/').pop();
    return `
    <div style="display:flex;align-items:center;gap:6px;padding:6px 8px 6px 11px;flex:none;
         border-right:1px solid var(--color-dark-border);
         background:${active ? 'var(--color-dark-surface)' : 'transparent'};
         border-bottom:2px solid ${active ? 'var(--color-lilac)' : 'transparent'}">
      <button data-act="openFile" data-arg="${esc(id)}" class="mono"
        style="border:none;background:none;cursor:pointer;font-size:10.5px;padding:0;
               color:${active ? 'var(--color-dark-text-1)' : 'var(--color-dark-text-3)'}">${esc(name)}</button>
      <button data-act="closeFile" data-arg="${esc(id)}" aria-label="Cerrar ${esc(name)}"
        style="border:none;background:none;cursor:pointer;color:var(--color-dark-text-3);
               font-size:12px;line-height:1;padding:0 2px">×</button>
    </div>`;
  }).join('');
  return `<div style="display:flex;overflow-x:auto;border-bottom:1px solid var(--color-dark-border);
    background:var(--app-surface-sunken)">${tabs}</div>`;
}

/** Side by side: the left pane is the file before, the right pane after. */
function sideBySide(file) {
  const pane = (rows, title) => `
    <div style="min-width:0;overflow:hidden;border-right:1px solid var(--color-dark-border)">
      <div class="mono" style="padding:5px 10px;font-size:9.5px;color:var(--color-dark-text-3);
           background:var(--app-surface-sunken);border-bottom:1px solid var(--color-dark-border)">${title}</div>
      ${rows}
    </div>`;

  const left = file.rows.map((r) => {
    const kind = r.kind === 'del' ? 'del' : r.kind === 'add' ? 'pad' : 'ctx';
    const content = r.kind === 'add' ? '' : highlightLine(r.ltext, file.path);
    return `<div class="diff-row mono" data-kind="${kind}">
      <span class="ln">${r.kind === 'add' ? '' : r.lno}</span>
      <span class="lt">${content}</span></div>`;
  }).join('');

  const right = file.rows.map((r) => {
    const kind = r.kind === 'add' ? 'add' : r.kind === 'del' ? 'pad' : 'ctx';
    const content = r.kind === 'del' ? '' : highlightLine(r.rtext, file.path);
    return `<div class="diff-row mono" data-kind="${kind}">
      <span class="ln">${r.kind === 'del' ? '' : r.rno}</span>
      <span class="lt">${content}</span></div>`;
  }).join('');

  // minmax(0,1fr) keeps a long line from widening its column past half the panel
  return `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
    ${pane(left, 'Antes')}${pane(right, 'Después')}</div>`;
}

/** Unified: one column, `-` then `+`, the way git shows it. */
function unified(file) {
  return file.rows.map((r) => {
    const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ' ';
    const text = r.kind === 'del' ? r.ltext : r.rtext || r.ltext;
    return `<div class="diff-row mono" data-kind="${r.kind === 'ctx' ? 'ctx' : r.kind}">
      <span class="ln">${r.kind === 'add' ? r.rno : r.lno}</span>
      <span class="lt">${sign} ${highlightLine(text, file.path)}</span></div>`;
  }).join('');
}

function conflictBanner(diff, file, conflicts) {
  if (!file.conflict) return '';
  const others = (conflicts[diff.repo] || []).filter((p) => p !== file.path);
  return `
  <div style="display:flex;align-items:center;gap:11px;padding:9px 13px;
       background:var(--app-diff-del);border-bottom:1px solid var(--state-blocked)">
    <span style="font:600 10.5px var(--font-body);color:var(--app-diff-del-line)">
      Este archivo choca con main</span>
    ${others.length ? `<span class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">
      también: ${esc(others.join(', '))}</span>` : ''}
    <button class="btn-ghost" style="margin-left:auto;border-color:var(--state-blocked);
      color:var(--app-diff-del-line)">Resolver</button>
  </div>`;
}

function getEditorLabel(diff, data) {
  if (!diff || !data) return 'Editor externo';
  const repos = data.getRepos ? data.getRepos() : [];
  const repo = repos.find((r) => r.name === diff.repo || r.path === diff.repo);
  const accountId = repo?.accountId;
  const accounts = data.getAccounts ? data.getAccounts() : [];
  const acc = accounts.find((a) => a.id === accountId);
  const ed = acc?.editor || 'vscode';
  if (ed === 'antigravity') return 'Antigravity IDE';
  if (ed === 'system') return 'Explorador';
  return 'VS Code';
}

function fileHeader(state, diff, file, editorLabel, agentId) {
  const modeTab = (id, label) => `<button class="tab" role="tab"
    aria-selected="${state.diffMode === id}" data-act="diffMode" data-arg="${id}">${label}</button>`;

  return `
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 13px;
       border-bottom:1px solid var(--color-dark-border)">
    <div style="min-width:0">
      <div class="mono" style="font-size:11.5px;font-weight:600;overflow:hidden;
           text-overflow:ellipsis;white-space:nowrap">${esc(file.path)}</div>
      <div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">
        ${esc(diff.repo)} · ${esc(diff.branch)}</div>
    </div>
    <span style="font:500 9.5px var(--font-body);color:${statusColor(diff.status)}">${esc(diff.status)}</span>
    ${counts(file.add, file.del)}
    <div role="tablist" style="display:flex;gap:4px;margin-left:auto;background:var(--color-dark-bg);
         padding:3px;border-radius:var(--radius-full);border:1px solid var(--color-dark-border)">
      ${modeTab('sbs', 'Lado a lado')}${modeTab('uni', 'Unificado')}
    </div>
    <button class="btn-ghost" style="padding:4px 9px;font-size:10.5px;display:flex;align-items:center;gap:5px"
      data-act="openExternalEditor" data-arg="${esc(agentId)}|${esc(file.path)}"
      title="Abrir worktree en ${esc(editorLabel)}">
      <span style="font-size:11px">↗</span> Abrir en ${esc(editorLabel)}
    </button>
  </div>`;
}

function fileFooter(diff, agentId, editorLabel, filePath) {
  return `
  <div style="display:flex;align-items:center;gap:11px;flex-wrap:wrap;padding:10px 13px;
       border-top:1px solid var(--color-dark-border);background:var(--app-surface-sunken)">
    <div style="min-width:0;flex:1">
      <div style="font:400 9px var(--font-body);color:var(--color-dark-text-3)">mensaje del commit</div>
      <div class="mono" style="font-size:10.5px;color:var(--color-dark-text-2);overflow:hidden;
           text-overflow:ellipsis;white-space:nowrap">${esc(diff.message)}</div>
    </div>
    <button class="btn-ghost" data-act="openExternalEditor" data-arg="${esc(agentId)}|${esc(filePath || '')}">
      ↗ Abrir en ${esc(editorLabel)}
    </button>
    <button class="btn-ghost" data-act="openChat" data-arg="${esc(agentId)}">Abrir hilo del agente</button>
    <button class="btn-ghost">Descartar</button>
    <button class="btn-primary" data-act="deliverAgent" data-arg="${esc(agentId)}"
      style="padding:8px 15px;border-radius:var(--radius-sm);font-size:11.5px">
      Commitear y abrir PR</button>
  </div>`;
}

function emptyPane() {
  return `
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;
       min-height:340px;padding:30px;text-align:center">
    <div class="font-display" style="font:600 13px var(--font-display)">Ningún archivo abierto</div>
    <div style="font:400 11px/1.6 var(--font-body);color:var(--color-dark-text-3);max-width:330px">
      Elige un archivo del árbol para revisar el diff antes de dejar que el agente empuje. Los que
      chocan con main se marcan y no se pueden empujar hasta resolverlos.
    </div>
  </div>`;
}

/** @returns {string} */
export function renderVisualizer(state, data) {
  const diffs = data.getDiffs();
  const conflicts = data.getConflicts();

  let pane = emptyPane();
  const activeId = state.visualizerActive;
  if (activeId) {
    const { agentId, path } = splitTab(activeId);
    const diff = diffs[agentId];
    const file = diff && diff.files.find((f) => f.path === path);
    if (file) {
      const editorLabel = getEditorLabel(diff, data);
      pane = fileHeader(state, diff, file, editorLabel, agentId)
        + conflictBanner(diff, file, conflicts)
        + `<div class="mono" style="padding:4px 10px;font-size:9.5px;color:var(--color-dark-text-3);
             background:var(--app-diff-gutter)">${esc(file.hunk)}</div>`
        + `<div style="max-height:52vh;overflow:auto">${state.diffMode === 'uni' ? unified(file) : sideBySide(file)}</div>`
        + fileFooter(diff, agentId, editorLabel, file.path);
    }
  }

  return `
  <div>
    <div class="font-display" style="font:600 15px var(--font-display);margin-bottom:4px">Visualizador</div>
    <div style="font:400 12px/1.6 var(--font-body);color:var(--color-dark-text-3);max-width:660px;margin-bottom:18px">
      Inspección y aprobación de cambios de cada agente antes de integrarse. Los agentes no pueden empujar por su cuenta:
      revisas el diff aquí o en tu editor externo configurado, y el harness hace el commit, push y PR con la cuenta de la carpeta.
    </div>
    <div style="display:grid;grid-template-columns:288px minmax(0,1fr);gap:14px;align-items:start">
      ${changeTree(state, diffs)}
      <div class="panel" style="overflow:hidden">
        ${openTabs(state)}
        ${pane}
      </div>
    </div>
  </div>`;
}

// Backward compatibility alias during migration
export const renderEditor = renderVisualizer;
