> **Created:** 2026-09-11
> **Last Updated:** 2026-09-11

# Architecture Specification: Zero-Mock Seam & Configurable Account Names

## 1. Executive Summary
This document specifies the transition of Cute Agents Desk from prototype mock artboard data to an honest zero-mock data seam with user-configurable account aliases and dynamic UI binding.

Key tenets:
1. **Zero Mocks**: Unpopulated runtime telemetry, coordinators, tasks, chats, and diffs render honest empty/clean states rather than fabricated placeholder data.
2. **User-Configurable Account Identity**: Account aliases and names are defined strictly in the user profile configuration (`~/.cute-agents-desk/accounts.json`), isolated outside the git repository.
3. **Repository Cleanliness & Privacy**: No personal usernames, account names, or filesystem directory paths are hardcoded in the codebase or tracked by git.
4. **Dynamic UI Resolution**: All UI components (`boss-graph.js`, `chat.js`, `tokens-view.js`, `repo-tree.js`, `agent-card.js`, `config.js`) resolve account names, colors, and filters dynamically from `data.getAccounts()` without hardcoded conditional fallbacks.

---

## 2. Configurable Account Schema

### 2.1 Storage Location
Account mapping and configuration are stored exclusively in the user's OS home directory:
`~/.cute-agents-desk/accounts.json`

This path is ignored by git and never published to remotes.

### 2.2 Schema Extensions
Each account entry in `accounts.json` supports an optional `name` or `alias` string:
```json
[
  {
    "gh": "<github-username>",
    "name": "<custom-alias-or-display-name>",
    "email": "<author-email>",
    "color": "var(--color-mint)",
    "folders": [
      { "path": "/path/to/repositories", "depth": 3 }
    ]
  }
]
```

In `electron/accounts.js`:
- `buildAccounts()` reads `c.name || c.alias || c.label || c.gh`.
- If a custom alias is provided, the UI uses it everywhere.
- If omitted, it falls back to the live GitHub login (`c.gh`).

---

## 3. Zero-Mock Data Seam (`ui/data.js`)

| Function | Previous (Mock Artboard) | Target (Zero-Mock Seam) |
| :--- | :--- | :--- |
| `getFlows()` | Static array with `icarus`, `governance`, `mapas` coordinators and fake agents. | `[]` when no active coordinator has been spawned. |
| `getUsage()` | Hardcoded `1.58 M` tokens, static 24h series, hardcoded accounts array. | Dynamic accounts mapped from `getAccounts()`, real daily tokens + all-time totals, per-account attribution, and 24h series reconstructed from `events.jsonl`. |
| `getMismatches()` | Hardcoded `sdk-python` and `slack-apps` entries. | Dynamic filtering of live scanned repositories: `getRepos().filter(r => r.mismatch)`. |
| `getScanSummary()` | Static `folders: 4, repos: 65, dirty: 9...`. | Computed dynamically from live scanned accounts and repositories. |
| `getDiffs()` | Static mock TypeScript files and diff hunks. | `{}` when no pending uncommitted agent work exists. |
| `getChatMessages()` | Static fake agent dialogues (`labels-gobierno`, `retry-backoff`). | `[]` when an agent has no recorded messages. |
| `getTasks()` | Static queued task fixtures. | `[]` when the queue is empty. |
| `getTimeline()` | Static agent activity lanes. | Clean timeline with empty lanes when no sessions are active. |
| `getTerminalLines()` | Static mock cargo conflict lines. | `[]` (terminal displays honest empty state when no output has arrived). |

---

## 4. UI View Adaptations

### 4.1 Boss / Workflows View (`ui/boss-graph.js`)
- Remove hardcoded ternary: `const account = flow.accountId === 'work' ? 'simplit-work' : 'cata-personal'`.
- Resolve account via: `data.getAccounts().find(a => a.id === flow.accountId)?.name || flow.accountId || '—'`.
- Generate account filter chips dynamically from `data.getAccounts()`.
- Display clean empty state when `flows.length === 0`:
  *"No hay flujos de trabajo ni coordinadores activos."*

### 4.2 Agent Chat View (`ui/chat.js`)
- Replace hardcoded account ternary with dynamic lookup against `data.getAccounts()`.
- If `messages.length === 0`, display: *"Sin mensajes en esta sesión."*

### 4.3 Tokens & Usage View (`ui/tokens-view.js`)
- Render account usage cards dynamically based on configured accounts.
- Display today's token usage alongside cumulative all-time metrics (`allTime`) from `events.jsonl` so zero-day states provide context.
- Show clean empty state when `flows.length === 0` in the coordinator breakdown card.

### 4.4 Settings & Configuration (`ui/config.js`)
- When `mismatches.length === 0`, display positive clean banner:
  *"Sin desajustes detectados. Todas las rutas coinciden con el email de sus cuentas."*

