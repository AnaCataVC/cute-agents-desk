// @ts-check
/**
 * The "Configuración" tab: eight sub-tabs plus the always-visible summary sidebar.
 *
 * Each sub-tab is literally a section of `config.json`, so the grouping here is not a UI
 * choice — it is the file's shape. Buttons with no `data-act` render inert on purpose: the
 * action protocol in app.js does not define them yet, and inventing one would be a lie
 * about what the page can do.
 */

import { esc } from './esc.js';

const SWATCHES = ['var(--color-mint)', 'var(--color-lilac)', 'var(--color-blue)',
  'var(--color-pink)', 'var(--state-approval)'];

/** A settings row: label on the left, a mono value pill or a toggle on the right. */
function settingsRow([label, value]) {
  const control = typeof value === 'boolean'
    ? `<span class="toggle-track" data-on="${value}"><span class="toggle-knob" data-on="${value}"></span></span>`
    : `<span class="value-pill mono">${esc(String(value))}</span>`;
  return `<div class="settings-row"><span>${esc(label)}</span><span style="margin-left:auto">${control}</span></div>`;
}

// Order and labels match the approved design (Despacho Local B.dc.html) exactly — this is not a
// free grouping choice, it is what the reference design checks against.
const SUB_TABS = [
  ['accounts', 'Cuentas y rutas'], ['engines', 'Motores'], ['skills', 'Skills'],
  ['adv', 'Avanzado'], ['bosses', 'Coordinadores'],
  ['exec', 'Ejecución'], ['deliver', 'Entrega'], ['perf', 'Rendimiento'],
];

function tabs(state) {
  return `<div style="display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 16px" role="tablist">
    ${SUB_TABS.map(([id, label]) => `<button class="tab" role="tab" aria-selected="${state.cfgTab === id}"
      style="border:1px solid var(--color-dark-border);background:var(--color-dark-surface)"
      data-act="cfgTab" data-arg="${id}">${label}</button>`).join('')}
  </div>`;
}

function panel(title, blurb, body, columns = 1) {
  return `
  <div class="panel" style="padding:16px">
    <div style="font:600 12.5px var(--font-display);margin-bottom:3px">${title}</div>
    ${blurb ? `<div style="font:400 11px/1.55 var(--font-body);color:var(--color-dark-text-3);
      max-width:620px;margin-bottom:13px">${blurb}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:9px 20px;
         color:var(--color-dark-text-2)">${body}</div>
  </div>`;
}

/* ---- cuentas y rutas ---- */

function swatchButton(ac, color) {
  const selected = ac.color === color;
  return `<button data-act="setAccountColor" data-arg="${esc(ac.id)}|${esc(color)}" data-selected="${selected}" title="${esc(color)}"
    style="width:18px;height:18px;border-radius:5px;background:${color};cursor:pointer;padding:0;
    border:${selected ? '2px solid var(--color-dark-text-1)' : '1px solid var(--color-dark-border)'}"></button>`;
}

function folderRow(f, data) {
  const repoCount = data.getRepos().filter((r) => r.folder === f.path).length;
  return `
  <div class="settings-row">
    <span class="mono" style="font-weight:500;font-size:11.5px;color:var(--color-dark-text-1)">${esc(f.path)}</span>
    <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-3)">${repoCount} repos · ${esc(f.depth)}</span>
    <button class="btn-ghost" style="margin-left:auto;padding:4px 9px;font-size:10px">Quitar</button>
  </div>`;
}

function accountCard(ac, data) {
  const repoCount = data.getRepos().filter((r) => r.accountId === ac.id).length;
  return `
  <div class="panel" style="padding:16px;border-left:4px solid ${ac.color}">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="width:11px;height:11px;border-radius:3px;background:${ac.color};flex:none"></span>
      <span class="mono" style="font-weight:600;font-size:13.5px">${esc(ac.name)}</span>
      <span class="mono" style="font-size:11px;color:var(--color-dark-text-3)">${esc(ac.email)}</span>
      <span class="mono" style="margin-left:auto;font-size:10.5px;color:var(--color-dark-text-3)">
        ${repoCount} repos · ${esc(ac.scopes)}</span>
    </div>
    <div class="settings-row" style="margin-top:11px">
      <span style="font-size:10.5px;color:var(--color-dark-text-3)">Color de la cuenta</span>
      <div style="display:flex;gap:6px;margin-left:auto">${SWATCHES.map((v) => swatchButton(ac, v)).join('')}</div>
    </div>
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
      ${(ac.folders || []).map((f) => folderRow(f, data)).join('')}
      <button class="btn-ghost" style="align-self:flex-start;margin-top:2px;border-style:dashed"
        data-act="openScan" data-arg="${ac.id}">Añadir carpeta…</button>
    </div>
  </div>`;
}

function mismatchPanel(mismatches) {
  if (!mismatches.length) {
    return `
    <div class="panel" style="margin-top:18px;padding:16px;border-left:4px solid var(--color-mint)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font:600 12.5px var(--font-display);color:var(--color-mint)">Sin desajustes detectados</span>
        <span style="font:600 10px var(--font-body);color:var(--app-on-accent);
              background:var(--color-mint);padding:2px 7px;border-radius:var(--radius-full)">0</span>
      </div>
      <div style="font:400 11px/1.55 var(--font-body);color:var(--color-dark-text-3);margin-top:6px">
        Todos los repositorios escaneados coinciden con el email de su cuenta asignada.
      </div>
    </div>`;
  }

  return `
  <div class="panel" style="margin-top:18px;padding:16px">
    <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
      <span style="font:600 12.5px var(--font-display)">Desajustes detectados</span>
      <span style="font:600 10px var(--font-body);color:var(--app-on-accent);
            background:var(--state-approval);padding:2px 7px;border-radius:var(--radius-full)">${mismatches.length}</span>
    </div>
    <div style="font:400 11px/1.55 var(--font-body);color:var(--color-dark-text-3);margin-bottom:12px">
      El repo vive bajo la carpeta de una cuenta pero su <span class="mono">git config user.email</span>
      apunta a la otra. No se bloquea nada: el aviso reaparece en la tarjeta del agente justo antes de empujar.
    </div>
    <div style="display:flex;flex-direction:column;gap:7px">
      ${mismatches.map((m) => `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;
           background:var(--who-system-bg);border:1px solid var(--state-approval);border-radius:10px">
        <span class="mono" style="font-weight:500;font-size:11.5px">${esc(m.repo)}</span>
        <span class="mono" style="font-size:10.5px;color:var(--app-on-warning)">${esc(m.detail)}</span>
        <button style="margin-left:auto;padding:5px 11px;border:none;border-radius:var(--radius-full);
          background:var(--state-approval);color:var(--app-on-accent);font:600 10.5px var(--font-body);
          cursor:pointer">Usar ${esc(m.fix)}</button>
        <button class="btn-ghost" style="border-color:var(--state-approval);
          color:var(--state-approval)">Dejar así</button>
      </div>`).join('')}
    </div>
  </div>`;
}

function accountsPanel(data) {
  return `
  <div>
    <div style="font:600 12.5px var(--font-display);margin-bottom:4px">Cuentas y rutas</div>
    <div style="font:400 12px/1.6 var(--font-body);color:var(--color-dark-text-3);max-width:640px;margin-bottom:18px">
      Las cuentas se leen de <span class="mono" style="color:var(--color-dark-text-2)">gh auth status</span>.
      Tú asocias las carpetas donde viven los repos: todo repo bajo una carpeta hereda esa cuenta al
      despachar, y el nombre + email de la rama y el PR salen de ahí.
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${data.getAccounts().map((ac) => accountCard(ac, data)).join('')}</div>
    ${mismatchPanel(data.getMismatches())}
  </div>`;
}

/* ---- motores ---- */

function engineCard(engine) {
  const full = engine.hooks === 'full';
  return `
  <div style="padding:12px;background:var(--color-dark-bg);border-radius:11px;
       border:1px ${full ? 'solid' : 'dashed'} var(--color-dark-border)">
    <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
      <span style="font:500 10px var(--font-body);color:var(--app-on-accent);background:var(--color-lilac);
            padding:2px 8px;border-radius:var(--radius-full)">${esc(engine.name)}</span>
      <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-2)">${esc(engine.command)}</span>
      <span style="margin-left:auto;font:600 9.5px var(--font-body);padding:2px 8px;
            border-radius:var(--radius-full);
            background:${full ? 'var(--color-mint)' : 'var(--state-approval)'};
            color:var(--app-on-accent)">${esc(engine.hooksLabel)}</span>
    </div>
    <div class="mono" style="display:flex;gap:18px;flex-wrap:wrap;margin-top:9px;font-size:10.5px;
         color:var(--color-dark-text-3)">
      <span>tope de contexto · <span style="color:var(--color-dark-text-2)">${esc(engine.contextCap)}</span></span>
      <span>aviso al · <span style="color:var(--color-dark-text-2)">${esc(engine.warnAt)}</span></span>
      <span>prefijo de rama · <span style="color:var(--color-dark-text-2)">${esc(engine.branchPrefix)}</span></span>
    </div>
  </div>`;
}

function enginesPanel(data) {
  return panel('Motores',
    'Comando con el que se levanta cada agente y qué telemetría reporta de verdad. Un motor sin hooks '
    + 'completos se dibuja con borde punteado: ahí hay menos información, no menos trabajo.',
    `${data.getEngines().map(engineCard).join('')}
     <button class="btn-ghost" style="justify-self:start;border-style:dashed">Añadir motor…</button>`);
}

/* ---- skills ---- */

function skillTable(group) {
  const emptyMsg = group.installed === false
    ? 'Directorio no detectado o motor no instalado.'
    : 'Sin skills instaladas en esta ruta.';

  const content = group.rows.length
    ? group.rows.map(([name, desc, version, load]) => `
      <div class="settings-row">
        <span class="mono" style="font-size:11px;font-weight:500;color:var(--color-dark-text-1);
              flex:none">${esc(name)}</span>
        <span style="font-size:10.5px;color:var(--color-dark-text-3);min-width:0;overflow:hidden;
              text-overflow:ellipsis;white-space:nowrap">${esc(desc)}</span>
        <span class="mono" style="margin-left:auto;font-size:10px;color:var(--color-dark-text-3)">${esc(version)}</span>
        <span style="padding:1px 7px;border-radius:var(--radius-full);font:600 9px var(--font-body);
              background:${load === 'siempre' ? 'var(--app-on-accent)' : 'var(--color-dark-surface)'};
              color:${load === 'siempre' ? 'var(--color-lilac)' : 'var(--color-dark-text-3)'}">${esc(load)}</span>
      </div>`).join('')
    : `<div style="font:400 11px var(--font-body);color:var(--color-dark-text-3);padding:6px 0">${esc(emptyMsg)}</div>`;

  return `
  <div style="margin-bottom:14px">
    <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:8px">
      <span style="font:500 11px var(--font-body);color:${group.color}">${esc(group.engine)}</span>
      <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(group.path)}</span>
      <span class="mono" style="margin-left:auto;font-size:10px;color:var(--color-dark-text-3)">
        ${group.rows.length} skills</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${content}</div>
  </div>`;
}

function skillsPanel(data) {
  return panel('Skills',
    'Lo que cada CLI trae instalado en su propio directorio de skills. Una skill "siempre" entra en el '
    + 'contexto de cada agente de ese motor y se paga en tokens aunque no se use; en el hilo de un agente '
    + 'se ve cuáles realmente usó.',
    `${data.getEngineSkills().map(skillTable).join('')}
    <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
      <button class="btn-ghost" data-act="refreshSkills" style="border-style:dashed">Refrescar skills</button>
    </div>`);
}

/* ---- coordinadores ---- */

function bossRow(flow) {
  const badgeBg = flow.split === 'por repo' ? 'var(--color-lilac)' : 'var(--color-blue)';
  return `
  <div class="settings-row">
    <span class="mono" style="font-size:11.5px;font-weight:500;color:var(--color-dark-text-1)">${esc(flow.name)}</span>
    <span style="font:500 9.5px var(--font-body);color:var(--app-on-accent);background:${badgeBg};
          padding:1px 7px;border-radius:var(--radius-full)">${esc(flow.split)}</span>
    <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-3);min-width:0;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap">${esc(flow.repos)}</span>
    <span class="mono" style="margin-left:auto;font-size:10px;color:var(--color-dark-text-3)">
      ${flow.roster.length} agentes</span>
  </div>`;
}

function bossesPanel(data) {
  const live = data.getFlows().filter((f) => f.status !== 'archivado');
  return `
  ${panel('Coordinadores',
    'Cada petición nueva crea un coordinador. Él abre sesiones paralelas —sus agentes— y consolida la '
    + 'entrega. Los topes de acá los impone el servidor: un tope que el coordinador pueda negociar no es un tope.',
    data.getSettings().coordinators.map(settingsRow).join(''), 2)}
  <div class="panel" style="margin-top:14px;padding:16px">
    <div style="font:600 9.5px var(--font-body);color:var(--color-dark-text-3);letter-spacing:.07em;
         text-transform:uppercase;margin-bottom:8px">Coordinadores vivos</div>
    <div style="display:flex;flex-direction:column;gap:7px">${live.map(bossRow).join('')}</div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:11px">
      <button class="btn-ghost" data-act="openQueue" data-arg="" style="border-style:dashed">Crear coordinador…</button>
      <span style="font-size:10.5px;color:var(--color-dark-text-3)">Los terminados se archivan con su entrega.</span>
    </div>
  </div>`;
}

/* ---- sidebar ---- */

function scanSummaryCard(data) {
  const s = data.getScanSummary();
  const row = (label, value, color) => `
    <div style="display:flex;justify-content:space-between;${color ? `color:${color}` : ''}">
      <span>${label}</span><span class="mono">${value}</span></div>`;

  return `
  <div class="panel" style="padding:16px">
    <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
         text-transform:uppercase;margin-bottom:10px">Último escaneo</div>
    <div style="display:flex;flex-direction:column;gap:8px;font:400 11.5px var(--font-body);
         color:var(--color-dark-text-2)">
      ${row('Carpetas asociadas', s.folders)}
      ${row('Repos git encontrados', s.repos)}
      ${row('Con árbol sucio', s.dirty)}
      ${row('Sin remoto en github', s.noRemote)}
      ${row('Cuenta desajustada', s.mismatched, 'var(--state-approval)')}
    </div>
    <button class="btn-primary" style="width:100%;justify-content:center;margin-top:14px;
      border-radius:10px">Volver a escanear</button>
    <div style="font-size:10px;color:var(--color-dark-text-3);margin-top:8px;text-align:center">
      ${esc(s.when)} · ${esc(s.took)}</div>
  </div>`;
}

/** Worktrees are never deleted on their own — this is the "siempre visible" list the plan
 * requires precisely because nothing else surfaces one once its agent has exited. */
function worktreesCard(data) {
  const worktrees = data.getWorktrees();
  const liveIds = new Set(data.getAgents().map((a) => a.id));

  const row = (w) => {
    const alive = liveIds.has(w.agentId);
    const flags = [
      w.hasUncommittedChanges ? 'cambios sin commitear' : null,
      w.hasUnpushedCommits ? 'commits sin empujar' : null,
    ].filter(Boolean).join(' · ') || 'limpio';
    return `
    <div style="display:flex;flex-direction:column;gap:4px;padding:9px 0;
         border-bottom:1px solid var(--color-dark-border)">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="mono" style="font-size:11px;font-weight:600">${esc(w.agentId)}</span>
        <span class="mono" style="font-size:10px;color:var(--color-dark-text-3)">${esc(w.branch)}</span>
        <button class="chip" style="margin-left:auto" ${alive ? 'disabled title="todavia esta vivo"' : ''}
          data-act="reapWorktree" data-arg="${esc(w.agentId)}">${alive ? 'vivo' : 'reap'}</button>
      </div>
      <span style="font:400 10.5px var(--font-body);color:var(--color-dark-text-3)">${esc(flags)}</span>
    </div>`;
  };

  return `
  <div class="panel" style="padding:16px">
    <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
         text-transform:uppercase;margin-bottom:10px">Worktrees retenidos</div>
    ${worktrees.length ? worktrees.map(row).join('')
    : `<div style="font:400 11.5px/1.6 var(--font-body);color:var(--color-dark-text-3)">
         Ninguno todavía — se crea uno por cada tarea en modo escritura, fuera del repo.</div>`}
  </div>`;
}

function deliverInfoCard() {
  return `
  <div class="panel" style="padding:16px">
    <div class="font-display" style="font:600 12px var(--font-display);letter-spacing:.05em;
         text-transform:uppercase;margin-bottom:10px">Al entregar</div>
    <div style="font:400 11.5px/1.65 var(--font-body);color:var(--color-dark-text-2)">
      Cada tarea entregada deja rama con prefijo por motor, PR en borrador con la cuenta de la carpeta,
      y el reporte del agente enlazado en el PR. Nada se empuja a <span class="mono">main</span>.
    </div>
    <div class="mono" style="margin-top:12px;display:flex;flex-direction:column;gap:6px;font-size:10.5px;
         color:var(--color-dark-text-3)">
      <div>rama · <span style="color:var(--color-lilac)">claude/&lt;tarea&gt;</span> ·
        <span style="color:var(--color-blue)">agy/&lt;tarea&gt;</span></div>
      <div>pr · <span style="color:var(--color-dark-text-2)">draft, reviewer: nadie</span></div>
      <div>commit · <span style="color:var(--color-dark-text-2)">email de la cuenta de la carpeta</span></div>
    </div>
  </div>`;
}

/**
 * @param {Record<string, any>} state
 * @param {typeof import('./data.js')} data
 */
export function renderConfig(state, data) {
  const s = data.getSettings();
  const bodies = {
    accounts: () => accountsPanel(data),
    engines: () => enginesPanel(data),
    skills: () => skillsPanel(data),
    bosses: () => bossesPanel(data),
    exec: () => panel('Ejecución',
      'Cuántas sesiones corren a la vez y qué acciones necesitan tu OK antes de ejecutarse.',
      s.exec.map(settingsRow).join(''), 2),
    deliver: () => panel('Entrega', '', s.deliver.map(settingsRow).join(''), 2),
    adv: () => panel('Avanzado',
      'Lo que hace que un agente no herede tu sesión ni tus hooks personales. Si el saneo de variables '
      + 'falla, el agente deja de guardar su transcript y no se puede reanudar — por eso está acá y no oculto.',
      s.advanced.map(settingsRow).join(''), 2),
    perf: () => panel('Rendimiento',
      'La terminal es lo más caro de la pantalla: se monta sólo al abrirla y nunca más de una.',
      s.perf.map(settingsRow).join(''), 2),
  };

  return `
  <div style="display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:22px;align-items:start">
    <div>
      <div class="font-display" style="font-size:15px;font-weight:600;margin-bottom:4px">Configuración</div>
      ${tabs(state)}
      ${(bodies[state.cfgTab] || bodies.accounts)()}
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${scanSummaryCard(data)}
      ${worktreesCard(data)}
      ${deliverInfoCard()}
    </div>
  </div>`;
}
