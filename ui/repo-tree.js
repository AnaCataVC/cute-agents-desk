// @ts-check
/**
 * The repo column: account -> folder -> repo, collapsible, with the filter block.
 *
 * Row geometry (paddings, fonts, indents) is the artboard's `buildRows()`, kept because the
 * left padding per level is what makes the hierarchy readable without drawing any guides.
 */

import { esc } from './esc.js';

/** Does this repo survive the current filters? */
function matches(repo, state, agentRepos) {
  if (state.accFilter !== 'all' && repo.accountId !== state.accFilter) return false;
  if (state.stFilter === 'dirty' && !repo.dirty) return false;
  if (state.stFilter === 'clean' && repo.dirty) return false;
  const hasAgent = agentRepos instanceof Set ? agentRepos.has(repo.name) : (agentRepos || []).includes(repo.name);
  if (state.stFilter === 'agent' && !hasAgent) return false;
  if (state.search) {
    const q = state.search.toLowerCase();
    const matchesName = repo.name.toLowerCase().includes(q);
    const matchesRel = repo.relPath && repo.relPath.toLowerCase().includes(q);
    if (!matchesName && !matchesRel) return false;
  }
  return true;
}

/**
 * Represents a directory in the tree containing subfolders and/or leaf repos.
 */
class FolderTreeNode {
  /**
   * @param {string} name
   * @param {string} fullSubpath
   */
  constructor(name, fullSubpath) {
    this.name = name;
    this.fullSubpath = fullSubpath;
    /** @type {Map<string, FolderTreeNode>} */
    this.subfolders = new Map();
    /** @type {any[]} */
    this.repos = [];
    this.count = 0;
    this.hasBusy = false;
    this.hasDirty = false;
  }
}

/**
 * Builds a hierarchical tree from a flat list of repos belonging to a declared folder root.
 * Precomputes counts and active/dirty bubble-up flags in a single O(N) pass.
 * @param {any[]} repos
 * @param {Set<string>} agentRepos
 * @returns {FolderTreeNode}
 */
function buildFolderTree(repos, agentRepos) {
  const root = new FolderTreeNode('', '');
  for (const repo of repos) {
    const isBusy = agentRepos.has(repo.name);
    const isDirty = Boolean(repo.dirty);

    const sub = (repo.subfolder || '').trim();
    if (!sub) {
      root.repos.push(repo);
      root.count++;
      if (isBusy) root.hasBusy = true;
      if (isDirty) root.hasDirty = true;
      continue;
    }

    const parts = sub.split('/').filter(Boolean);
    let current = root;
    let pathAcc = '';
    const lineage = [root];

    for (const part of parts) {
      pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
      if (!current.subfolders.has(part)) {
        current.subfolders.set(part, new FolderTreeNode(part, pathAcc));
      }
      current = current.subfolders.get(part);
      lineage.push(current);
    }

    current.repos.push(repo);

    for (const node of lineage) {
      node.count++;
      if (isBusy) node.hasBusy = true;
      if (isDirty) node.hasDirty = true;
    }
  }
  return root;
}

/**
 * Recursively renders subfolders and leaf repos.
 * @param {FolderTreeNode} node
 * @param {number} depth
 * @param {string} folderRootPath
 * @param {any} state
 * @param {Set<string>} agentRepos
 * @param {string[]} rows
 */
function renderFolderNode(node, depth, folderRootPath, state, agentRepos, rows) {
  const sortedSubfolders = Array.from(node.subfolders.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const sub of sortedSubfolders) {
    const nodeKey = `${folderRootPath.replace(/\\/g, '/')}::${sub.fullSubpath}`;
    const isNodeOpen = state.open[nodeKey] !== undefined
      ? !!state.open[nodeKey]
      : Boolean(state.search || sub.hasBusy);
    const padLeft = 18 + depth * 11;

    rows.push(`
    <div data-act="toggleNode" data-arg="${esc(nodeKey)}" title="${esc(sub.fullSubpath)}"
      style="display:flex;align-items:center;gap:6px;padding:5px 9px 5px ${padLeft}px;cursor:pointer;
             background:transparent;border-radius:6px;user-select:none">
      <span style="font:400 9px var(--font-body);color:var(--color-dark-text-3);width:9px">${isNodeOpen ? '▾' : '▸'}</span>
      <span class="mono" style="font-size:10.5px;font-weight:600;color:var(--color-dark-text-2);flex:1;
            min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub.name)}/</span>
      ${sub.hasBusy ? '<span class="r-antenna" style="width:7px;height:7px;border-radius:50%;background:var(--color-dark-accent);margin-right:2px"></span>' : ''}
      ${sub.hasDirty ? '<span style="font:400 8px var(--font-body);color:var(--app-dirty);margin-right:2px">●</span>' : ''}
      <span class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">${sub.count}</span>
    </div>`);

    if (isNodeOpen) {
      renderFolderNode(sub, depth + 1, folderRootPath, state, agentRepos, rows);
    }
  }

  // Render direct repos in this folder node
  const repoPadLeft = node.fullSubpath === '' ? 32 : (18 + depth * 11 + 10);
  for (const repo of node.repos) {
    const busy = agentRepos.has(repo.name);
    const bg = busy
      ? 'background:var(--app-surface-mine);box-shadow:inset 0 0 0 1px var(--color-dark-accent)'
      : 'background:transparent';
    const titlePath = repo.path || (repo.relPath ? `${repo.folder}/${repo.relPath}` : `${repo.folder}/${repo.name}`);
    rows.push(`
    <div data-act="openQueue" data-arg="${esc(repo.path || repo.name)}" title="${esc(titlePath)}"
      style="display:flex;align-items:center;gap:7px;padding:5px 9px 5px ${repoPadLeft}px;cursor:pointer;
             border-radius:7px;${bg}">
      <span class="${busy ? 'r-antenna' : ''}" style="width:9px;font:400 7px var(--font-body);
            color:var(--color-dark-accent)">${busy ? '●' : ''}</span>
      <span class="mono" style="font-size:10.5px;color:${busy ? 'var(--color-dark-text-1)' : 'var(--color-dark-text-2)'};
            flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(repo.name)}</span>
      <span style="font:400 9px var(--font-body);color:var(--app-dirty)">${repo.dirty ? '●' : ''}</span>
    </div>`);
  }
}

function filterBlock(state, data, visibleCount) {
  if (!state.filtersOpen) return '';

  const accChips = [{ id: 'all', label: 'todas' }, ...data.getAccounts().map((a) => ({ id: a.id, label: a.name }))]
    .map((f) => `<button class="chip" aria-pressed="${state.accFilter === f.id}"
      data-act="accFilter" data-arg="${esc(f.id)}">${esc(f.label)}</button>`).join('');

  const stChips = [
    { id: 'any', label: 'cualquiera' }, { id: 'dirty', label: 'árbol sucio' },
    { id: 'agent', label: 'con agente' }, { id: 'clean', label: 'limpio' },
  ].map((f) => `<button class="chip" aria-pressed="${state.stFilter === f.id}"
      data-act="stFilter" data-arg="${esc(f.id)}">${esc(f.label)}</button>`).join('');

  const label = 'font:600 9.5px var(--font-body);color:var(--color-dark-text-3);'
    + 'letter-spacing:.07em;text-transform:uppercase;margin:12px 0 6px';

  return `
  <div style="padding:12px;background:var(--color-dark-surface);border:1px solid var(--color-dark-border);
       border-radius:14px;margin-bottom:10px">
    <label style="display:flex;align-items:center;gap:8px;padding:7px 11px;background:var(--color-dark-bg);
           border:1px solid var(--color-dark-border);border-radius:var(--radius-full)">
      <span class="mono" style="font-size:11px;color:var(--color-dark-text-3)">/</span>
      <input data-act="search" value="${esc(state.search)}" placeholder="buscar por nombre…"
        style="flex:1;min-width:0;border:none;background:transparent;color:var(--color-dark-text-1);
               font:400 11.5px var(--font-mono);outline:none">
    </label>
    <div style="${label}">Cuenta</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${accChips}</div>
    <div style="${label}">Estado</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${stChips}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:13px;padding-top:11px;
         border-top:1px solid var(--color-dark-border)">
      <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-3)">${visibleCount} de ${data.getRepos().length} repos</span>
      <button class="chip" data-act="clearFilters" style="margin-left:auto">Limpiar</button>
    </div>
  </div>`;
}

/** @returns {string} */
export function renderRepoTree(state, data) {
  const repos = data.getRepos();
  const agentRepos = new Set(data.getAgents().map((a) => a.repo));
  const visible = repos.filter((r) => matches(r, state, agentRepos));

  const rows = [];
  if (!data.getAccounts().length && !repos.length) {
    rows.push(`
    <div style="padding:24px 12px;text-align:center;font:400 11px var(--font-body);color:var(--color-dark-text-3)">
      <div class="r-antenna" style="width:10px;height:10px;border-radius:50%;background:var(--color-lilac);margin:0 auto 8px"></div>
      <div>Escaneando repositorios…</div>
    </div>`);
  }
  for (const acc of data.getAccounts()) {
    const mine = visible.filter((r) => r.accountId === acc.id);
    const total = repos.filter((r) => r.accountId === acc.id).length;
    const open = !!state.open[acc.id];

    rows.push(`
    <div data-act="toggleNode" data-arg="${esc(acc.id)}" title="${esc(acc.email)}"
      style="display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;
             background:var(--app-surface-tree);border-radius:var(--radius-sm);
             border-left:3px solid ${esc(acc.color)};margin-top:5px">
      <span style="font:400 9px var(--font-body);color:var(--color-dark-text-3);width:9px">${open ? '▾' : '▸'}</span>
      <span class="mono" style="font-size:11px;font-weight:600;flex:1;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(acc.name)}</span>
      <span class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">${mine.length}${mine.length === total ? '' : `/${total}`}</span>
    </div>`);

    if (!open) continue;

    for (const folder of (acc.folders || [])) {
      const kids = mine.filter((r) => r.folder === folder.path);
      if (!kids.length) continue;
      const fOpen = !!state.open[folder.path];

      rows.push(`
      <div data-act="toggleNode" data-arg="${esc(folder.path)}" title="${esc(folder.path)}"
        style="display:flex;align-items:center;gap:7px;padding:6px 9px 6px 18px;cursor:pointer;
               background:var(--color-dark-bg);border-radius:7px">
        <span style="font:400 9px var(--font-body);color:var(--color-dark-text-3);width:9px">${fOpen ? '▾' : '▸'}</span>
        <span class="mono" style="font-size:10.5px;font-weight:500;color:var(--color-dark-text-2);flex:1;
              min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(folder.path)}</span>
        <span class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">${kids.length}</span>
      </div>`);

      if (!fOpen) continue;

      const tree = buildFolderTree(kids, agentRepos);
      renderFolderNode(tree, 1, folder.path, state, agentRepos, rows);
    }
  }

  return `
  <div style="padding:16px;border-right:1px solid var(--color-dark-border);
       background:var(--app-surface-sunken);min-width:0;border-radius:var(--radius-lg)">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px">
      <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
           text-transform:uppercase">Repos</div>
      <button class="chip" data-act="toggleFilters" aria-pressed="${state.filtersOpen}">
        ${state.filtersOpen ? 'ocultar filtros' : 'filtros'}
      </button>
    </div>
    ${filterBlock(state, data, visible.length)}
    <div style="display:flex;flex-direction:column;gap:1px;max-height:660px;overflow:auto;
         padding-right:12px;scrollbar-gutter:stable">${rows.join('')}</div>
    <div style="margin-top:12px;padding:11px 12px;background:var(--color-dark-surface);
         border:1px solid var(--color-dark-border);border-radius:var(--radius-md);
         font:400 10.5px/1.55 var(--font-body);color:var(--color-dark-text-3)">
      Punto rosa = árbol sucio · halo lila = agente trabajando ahí. Clic en un repo abre el diálogo de
      encolar tarea; una tarea por repo.
    </div>
  </div>`;
}
