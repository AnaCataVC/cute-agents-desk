// @ts-check
/**
 * The conversation thread of one agent, as three sub-tabs: Ficha (status card), Hilo (the
 * mailbox thread) and Diff (its uncommitted changes) — matching the approved design's panel,
 * not a two-column chat-with-sidebar layout.
 *
 * The thread itself is fed by the mailbox and the hook events, not by the PTY's stdout, so
 * every line has an author. That is what makes "quién decidió esto" answerable — the
 * coordinator, the agent, you, the harness, or a tool.
 */

import { shortTokens } from './ring.js';
import { esc } from './esc.js';

const AUTHOR_LABEL = {
  boss: 'coordinador', sub: 'agente', user: 'tú', sys: 'harness', tool: 'herramienta',
};

const PANEL_TABS = [['ficha', 'Ficha'], ['hilo', 'Hilo'], ['diff', 'Diff']];

function panelTabs(state) {
  return `
  <div style="display:flex;gap:2px;padding:3px;background:var(--color-dark-surface);
       border-radius:var(--radius-full);margin-top:10px;width:fit-content">
    ${PANEL_TABS.map(([id, label]) => `<button class="tab" role="tab" aria-selected="${(state.chatTab || 'hilo') === id}"
      data-act="chatTab" data-arg="${id}">${label}</button>`).join('')}
  </div>`;
}

function bubble([kind, who, when, text], authors) {
  const a = authors[kind] || authors.sub;
  const mine = kind === 'user';
  return `
  <div style="display:flex;flex-direction:column;align-items:${a.align};gap:3px">
    <div style="display:flex;gap:7px;align-items:baseline;${mine ? 'flex-direction:row-reverse' : ''}">
      <span class="mono" style="font-size:9.5px;font-weight:600;color:${a.color}">${esc(who)}</span>
      <span class="mono" style="font-size:9px;color:var(--color-dark-text-3)">${esc(when)}</span>
      <span style="font:400 8.5px var(--font-body);color:var(--color-dark-text-3)">${AUTHOR_LABEL[kind] || ''}</span>
    </div>
    <div style="max-width:78%;padding:9px 12px;background:${a.bg};border-radius:12px;
         font:400 11.5px/1.6 ${kind === 'tool' ? 'var(--font-mono)' : 'var(--font-body)'};
         color:var(--color-dark-text-${kind === 'tool' ? '3' : '1'})">${esc(text)}</div>
  </div>`;
}

/** What the agent's session actually loaded, and what it used. A loaded-but-unused skill is context spent. */
function skillChips(rows, skillStates) {
  if (!rows.length) return '';
  return rows.map(([name, st]) => {
    const s = skillStates[st] || skillStates.disponible;
    return `<span style="padding:2px 8px;border-radius:var(--radius-full);background:${s.bg};
      display:inline-flex;gap:5px;align-items:baseline">
      <span class="mono" style="font-size:9.5px;color:${s.color}">${esc(name)}</span>
    </span>`;
  }).join('');
}

function skillsPanel(rows, skillStates, title = 'Skills de esta sesión') {
  if (!rows.length) return '';
  return `
  <div>
    <div class="font-display" style="font:600 9.5px var(--font-display);letter-spacing:.07em;
         text-transform:uppercase;color:var(--color-dark-text-3);margin-bottom:7px">${title}</div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">${skillChips(rows, skillStates)}</div>
  </div>`;
}

/**
 * `label` is always plain text and gets escaped here; `valueHtml` is a pre-rendered fragment by
 * contract (its callers build it themselves, e.g. via `mono()` below, which escapes its own
 * input) — the "Html" suffix is the signal that a value is trusted, not raw display data.
 */
function infoBox(rows) {
  return `
  <div style="display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--color-dark-surface);
       border:1px solid var(--color-dark-border);border-radius:var(--radius-md);
       font:400 11px var(--font-body);color:var(--color-dark-text-2)">
    ${rows.map(([label, valueHtml]) => `
      <div style="display:flex;align-items:center;gap:10px">
        <span>${esc(label)}</span><span style="margin-left:auto">${valueHtml}</span>
      </div>`).join('')}
  </div>`;
}

/** The status card: what this session is, right now — not a running transcript. */
function fichaPanel(agent, states, skills, skillStates, data) {
  const st = states[agent.state] || states.idle;
  const acc = (data?.getAccounts() || []).find((a) => a.id === agent.accountId);
  const account = acc ? (acc.name || acc.id) : (agent.accountId || '—');
  const diff = data.getDiffs()[agent.id];
  const pct = Math.round((agent.tokens / agent.tokenCap) * 100);
  const mono = (v) => `<span class="mono" style="font-size:10.5px;color:var(--color-dark-text-1)">${esc(v)}</span>`;

  return `
  <div style="display:flex;flex-direction:column;gap:12px;padding:14px 16px">
    <div style="display:flex;align-items:center;gap:9px">
      <span style="padding:2px 9px;border-radius:var(--radius-full);background:${st.bg || 'var(--color-dark-surface)'};
            color:${st.color};font:600 10px var(--font-body)">${st.label}</span>
      <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-2)">${esc(agent.tool)}</span>
    </div>
    ${infoBox([
      ['Repo', mono(agent.repo)],
      ['Rama', mono(agent.branch)],
      ['Cuenta', mono(account)],
      ['Coordinador', mono(agent.boss)],
    ])}
    <div style="padding:12px;background:var(--color-dark-surface);border:1px solid var(--color-dark-border);
         border-radius:var(--radius-md)">
      <div style="display:flex;align-items:baseline;gap:9px">
        <span style="font:600 9.5px var(--font-body);color:var(--color-dark-text-3);letter-spacing:.07em;
              text-transform:uppercase">Ventana de contexto</span>
        <span class="mono" style="margin-left:auto;font-size:12px;font-weight:600">${pct}%</span>
        <span class="mono" style="font-size:10.5px;color:var(--color-dark-text-3)">
          ${shortTokens(agent.tokens)} / ${shortTokens(agent.tokenCap)}</span>
      </div>
      <div style="height:6px;border-radius:var(--radius-full);background:var(--color-dark-border);
           overflow:hidden;margin-top:8px">
        <span style="display:block;height:100%;width:${pct}%;background:${st.color}"></span>
      </div>
    </div>
    ${skillsPanel(skills, skillStates)}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn-primary" style="padding:9px 15px" data-act="chatTab" data-arg="hilo">
        ${data.getThread(agent.id).length ? 'Ver el hilo' : 'Abrir el hilo'}</button>
      <button class="chip" style="padding:9px 15px" data-act="chatTab" data-arg="diff">
        ${diff ? `Ver diff · ${diff.files.length} archivo${diff.files.length === 1 ? '' : 's'}` : 'Sin cambios'}</button>
    </div>
  </div>`;
}

function hiloPanel(agent, data, state) {
  const allMessages = data.getThread(agent.id) || [];
  // Paginate to latest 50 messages to prevent DOM bloat per stress test
  const displayMessages = allMessages.slice(-50);
  const messages = displayMessages.map((m) => bubble(m, data.AUTHORS)).join('');
  const skills = data.getAgentSkills(agent.id);
  const isBusy = agent.state === 'tool';
  const chatInput = state?.chatInput || '';

  return `
  <div style="display:flex;flex-direction:column;min-height:0;flex:1">
    ${skills.length ? `
    <div style="padding:9px 16px;border-bottom:1px solid var(--color-dark-border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font:600 9.5px var(--font-body);color:var(--color-dark-text-3);letter-spacing:.07em;
              text-transform:uppercase">Skills en este hilo</span>
        <span style="font:600 9px var(--font-body);color:var(--app-on-accent-text,var(--color-lilac));
              background:var(--color-lilac);padding:1px 7px;border-radius:var(--radius-full)">${skills.length} cargadas</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${skillChips(skills, data.SKILL_STATES)}</div>
    </div>` : ''}
    <div style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:13px;min-height:0">
      ${messages || `
      <div style="padding:26px 18px;background:var(--color-dark-surface);border:1px dashed var(--color-dark-border);
           border-radius:14px;text-align:center">
        <div style="font:500 11.5px var(--font-body);color:var(--color-dark-text-1)">Sin mensajes en este hilo</div>
        <div style="font:400 10.5px/1.55 var(--font-body);color:var(--color-dark-text-3);margin-top:5px">
          La sesión está abierta pero el coordinador no ha escrito todavía. Su ficha tiene el estado actual.</div>
        <button class="chip" style="margin-top:11px" data-act="chatTab" data-arg="ficha">Ver la ficha</button>
      </div>`}
    </div>
    <div style="padding:12px 16px;border-top:1px solid var(--color-dark-border)">
      <form data-act="submitChat" data-arg="${esc(agent.id)}"
        style="display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:var(--radius-full);
               border:1px solid var(--color-dark-border);background:var(--color-dark-surface)">
        <input type="text" data-act="chatInput" value="${esc(chatInput)}"
          placeholder="${isBusy ? 'Agente ocupado ejecutando herramienta…' : `Escribir al ${esc(agent.boss)}…`}"
          ${isBusy ? 'disabled' : ''}
          style="flex:1;background:transparent;border:none;outline:none;padding:6px 10px;
                 color:var(--color-dark-text-1);font:400 11.5px var(--font-body);min-width:0">
        <button type="submit" class="btn-primary" data-act="submitChat" data-arg="${esc(agent.id)}"
          ${isBusy || !chatInput.trim() ? 'disabled' : ''}
          style="padding:5px 12px;border-radius:var(--radius-full);font-size:11px;line-height:1.2;cursor:pointer">
          Enviar
        </button>
      </form>
      <div style="font:400 9.5px var(--font-body);color:var(--color-dark-text-3);margin-top:7px">
        ${isBusy ? 'El agente está ocupado. Espera a que termine su herramienta para enviar entrada.' : 'Lo que escribas entra por el coordinador; él decide si lo reparte o lo contesta.'}
      </div>
    </div>
  </div>`;
}

/** A compact file list, not the full side-by-side viewer — that one lives in the Visualizador tab. */
function diffPanel(agent, data) {
  const diff = data.getDiffs()[agent.id];
  if (!diff) {
    return `
    <div style="padding:26px 18px;margin:16px;background:var(--color-dark-surface);
         border:1px dashed var(--color-dark-border);border-radius:14px;text-align:center;
         font:400 11.5px var(--font-body);color:var(--color-dark-text-3)">Sin cambios sin commitear.</div>`;
  }
  const rows = diff.files.map((f) => `
    <button data-act="openDiffFile" data-arg="${esc(agent.id)}:${esc(f.path)}"
      style="display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:9px 12px;
             background:var(--color-dark-surface);border:1px solid var(--color-dark-border);
             border-radius:var(--radius-md);cursor:pointer">
      <span class="mono" style="font-size:10.5px;flex:1;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(f.path)}</span>
      <span class="mono" style="font-size:10px;color:var(--color-mint)">+${f.add}</span>
      <span class="mono" style="font-size:10px;color:var(--color-error)">-${f.del}</span>
    </button>`).join('');

  return `
  <div style="display:flex;flex-direction:column;gap:9px;padding:14px 16px">
    <div style="font:400 10.5px var(--font-body);color:var(--color-dark-text-3)">
      ${esc(diff.branch)} · ${esc(diff.status)} — ${esc(diff.message)}</div>
    ${rows}
  </div>`;
}

/** @returns {string} the panel body, or '' when no agent is open */
export function renderChat(state, data) {
  if (!state.chat) return '';
  const agent = data.getAgents().find((a) => a.id === state.chat);
  if (!agent) return '';

  const skills = data.getAgentSkills(agent.id);
  const tab = state.chatTab || 'hilo';
  const body = tab === 'ficha' ? fichaPanel(agent, data.STATES, skills, data.SKILL_STATES, data)
    : tab === 'diff' ? diffPanel(agent, data)
      : hiloPanel(agent, data, state);

  return `
  <div style="display:flex;flex-direction:column;max-height:86vh;min-width:0;width:420px">
    <div style="padding:14px 16px 11px;border-bottom:1px solid var(--color-dark-border)">
      <div style="display:flex;align-items:center;gap:9px">
        <span class="mono" style="font-size:12.5px;font-weight:600">${esc(agent.id)}</span>
        <span class="mono" style="font-size:11px;color:var(--color-dark-text-2)">${esc(agent.repo)}</span>
        <button class="chip" data-act="closeChat" style="margin-left:auto;width:24px;height:24px;padding:0">×</button>
      </div>
      <div style="font:400 10.5px var(--font-body);color:var(--color-dark-text-2);margin-top:5px">
        Sesión de <span style="color:var(--color-lilac)">${esc(agent.boss)}</span> · motor ${esc(agent.engine)}</div>
      ${panelTabs(state)}
    </div>
    ${body}
  </div>`;
}
