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

function newConversationForm(state) {
  if (!state.newConvOpen) {
    return `
    <button class="btn-ghost" data-act="toggleNewConversation"
      style="width:100%;border-radius:var(--radius-sm);font-size:11px;padding:8px 10px">
      + nueva conversación
    </button>`;
  }

  const INPUT = 'width:100%;padding:7px 9px;border-radius:var(--radius-sm);'
    + 'border:1px solid var(--color-dark-border);background:var(--color-dark-bg);'
    + 'color:var(--color-dark-text-1);font:400 11px var(--font-body)';

  return `
  <div style="display:flex;flex-direction:column;gap:7px;padding:10px;background:var(--color-dark-surface);
       border:1px solid var(--color-dark-border);border-radius:var(--radius-sm)">
    <input data-act="newConvTitle" value="${esc(state.newConvTitle || '')}" placeholder="título…"
      style="${INPUT}">
    <input data-act="newConvTopic" value="${esc(state.newConvTopic || '')}" placeholder="tema (opcional)"
      style="${INPUT}">
    <div style="display:flex;gap:7px">
      <button class="btn-primary" data-act="newConversation" style="flex:1;padding:7px 10px;font-size:11px">
        Crear
      </button>
      <button class="btn-ghost" data-act="toggleNewConversation" style="padding:7px 10px;font-size:11px">
        Cancelar
      </button>
    </div>
  </div>`;
}

function conversationRow(conv) {
  return `
  <div style="display:flex;flex-direction:column;gap:3px;padding:8px 9px;border-radius:var(--radius-sm);
       background:var(--app-surface-tree)">
    <div style="display:flex;align-items:center;gap:6px">
      <span class="mono" style="font-size:10.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(conv.title)}</span>
      <span class="mono" style="font-size:9px;color:var(--color-dark-text-3)">cap ${esc(String(conv.cap ?? '—'))}</span>
    </div>
    ${conv.topic ? `<div class="mono" style="font-size:9.5px;color:var(--color-dark-text-3);overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap">${esc(conv.topic)}</div>` : ''}
    <div style="display:flex;align-items:center;gap:7px;margin-top:2px">
      <span class="mono" style="font-size:9px;color:var(--color-dark-text-3);flex:1">${esc(relTime(conv.createdAt))}</span>
      <button class="chip" data-act="openCoordinator" data-arg="${esc(conv.id)}"
        title="Abrir coordinador" style="font-size:9.5px;padding:3px 8px">
        abrir coordinador
      </button>
    </div>
  </div>`;
}

/** @returns {string} */
export function renderSidebar(state, data) {
  const conversations = data.getConversations();

  const list = conversations.length
    ? `<div style="display:flex;flex-direction:column;gap:7px">${conversations.map(conversationRow).join('')}</div>`
    : `<div class="mono" style="font-size:10px;line-height:1.5;color:var(--color-dark-text-3);
         padding:9px;background:var(--color-dark-bg);border:1px dashed var(--color-dark-border);
         border-radius:var(--radius-sm)">
         Sin conversaciones todavía. Creá una para abrir un coordinador.
       </div>`;

  return `
  <div style="width:220px;flex:none;padding:16px 12px;border-right:1px solid var(--color-dark-border);
       background:var(--app-surface-sunken);min-width:0;display:flex;flex-direction:column;gap:12px;
       align-self:stretch">
    <div class="font-display" style="font:600 11px var(--font-display);letter-spacing:.05em;
         text-transform:uppercase">Conversaciones</div>
    ${newConversationForm(state)}
    ${list}
  </div>`;
}
