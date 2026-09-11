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
  if (state.stFilter === 'agent' && !agentRepos.includes(repo.name)) return false;
  if (state.search && !repo.name.includes(state.search.toLowerCase())) return false;
  return true;
}

function filterBlock(state, data, visibleCount) {
  if (!state.filtersOpen) return '';

  const accChips = [{ id: 'all', label: 'todas' }, ...data.getAccounts().map((a) => ({ id: a.id, label: a.name }))]
    .map((f) => `<button class="chip" aria-pressed="${state.accFilter === f.id}"
      data-act="accFilter" data-arg="${f.id}">${f.label}</button>`).join('');

  const stChips = [
    { id: 'any', label: 'cualquiera' }, { id: 'dirty', label: 'árbol sucio' },
    { id: 'agent', label: 'con agente' }, { id: 'clean', label: 'limpio' },
  ].map((f) => `<button class="chip" aria-pressed="${state.stFilter === f.id}"
      data-act="stFilter" data-arg="${f.id}">${f.label}</button>`).join('');

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
      <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-3)">${visibleCount} de 65 repos</span>
      <button class="chip" data-act="clearFilters" style="margin-left:auto">Limpiar</button>
    </div>
  </div>`;
}

/** @returns {string} */
export function renderRepoTree(state, data) {
  const repos = data.getRepos();
  const agentRepos = data.getAgents().map((a) => a.repo);
  const visible = repos.filter((r) => matches(r, state, agentRepos));

  const rows = [];
  for (const acc of data.getAccounts()) {
    const mine = visible.filter((r) => r.accountId === acc.id);
    const total = repos.filter((r) => r.accountId === acc.id).length;
    const open = !!state.open[acc.id];

    rows.push(`
    <div data-act="toggleNode" data-arg="${acc.id}" title="${esc(acc.email)}"
      style="display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;
             background:var(--app-surface-tree);border-radius:var(--radius-sm);
             border-left:3px solid ${acc.color};margin-top:5px">
      <span style="font:400 9px var(--font-body);color:var(--color-dark-text-3);width:9px">${open ? '▾' : '▸'}</span>
      <span class="mono" style="font-size:11px;font-weight:600;flex:1;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(acc.name)}</span>
      <span class="mono" style="font-size:9.5px;color:var(--color-dark-text-3)">${mine.length}${mine.length === total ? '' : `/${total}`}</span>
    </div>`);

    if (!open) continue;

    for (const folder of acc.folders) {
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

      for (const repo of kids) {
        const busy = agentRepos.includes(repo.name);
        // A repo with an agent on it gets an inset ring and a pulsing antenna dot, so the
        // eye finds "where is something happening" without reading a single label.
        const bg = busy
          ? 'background:var(--app-surface-mine);box-shadow:inset 0 0 0 1px var(--color-dark-accent)'
          : 'background:transparent';
        rows.push(`
        <div data-act="openQueue" data-arg="${esc(repo.name)}" title="${esc(`${repo.folder}/${repo.name}`)}"
          style="display:flex;align-items:center;gap:7px;padding:5px 9px 5px 32px;cursor:pointer;
                 border-radius:7px;${bg}">
          <span class="${busy ? 'r-antenna' : ''}" style="width:9px;font:400 7px var(--font-body);
                color:var(--color-dark-accent)">${busy ? '●' : ''}</span>
          <span class="mono" style="font-size:10.5px;color:${busy ? 'var(--color-dark-text-1)' : 'var(--color-dark-text-2)'};
                flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(repo.name)}</span>
          <span style="font:400 9px var(--font-body);color:var(--app-dirty)">${repo.dirty ? '●' : ''}</span>
        </div>`);
      }
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
