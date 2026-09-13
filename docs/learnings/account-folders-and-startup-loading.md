# Learnings & Root Cause Analysis: Account Folders Management and Startup Loading State

## 1. Account Folder Management & Dynamic Repository Discovery

### Root Cause
- In `ui/config.js`, the "Quitar" button on each folder row (`folderRow`) lacked a `data-act` attribute, making it inert.
- In `ui/dialogs.js`, `scanDialog` was disconnected from application state:
  - The path input did not bind to `state.scanPath`.
  - There was no integration with Electron's native directory picker (`dialog.showOpenDialog`).
  - The "Añadir carpeta" submit button was missing an action identifier (`data-act`).
- In `electron/accounts.js`, there were no backend functions to modify or persist folders inside `accounts.json` (`addAccountFolder`, `removeAccountFolder`).
- There were no corresponding IPC channels in `electron/preload.js` or `electron/main.js` to add/remove folders or trigger repository re-scans upon folder modifications.

### Resolution & Pattern
- **Atomic Folder Persistence in `accounts.js`:**
  - Implemented `addAccountFolder(gh, folderPath, depth)`: validates inputs, normalizes Windows and POSIX path separators to forward slashes (`/`), updates folder search depth if the path already exists, or appends a new folder entry and writes formatted JSON back to `accounts.json`.
  - Implemented `removeAccountFolder(gh, folderPath)`: filters out the matching folder path in a case-insensitive manner and persists the updated array.
- **Safe Repository Scanning:**
  - Updated `scanRepos` in `electron/discovery.js` to iterate over `(account.folders || [])`, preventing runtime crashes when an account temporarily has no registered folders.
- **IPC Wiring & Live Cache Synchronization:**
  - Added `refreshRepoData()` in `electron/main.js` that scans repositories under updated account folders, writes to `repos-cache.json`, updates `repoDataPromise`, and broadcasts `{ repoData: fresh }` via `desk:patch`.
  - Exposed `desk:addAccountFolder`, `desk:removeAccountFolder`, and `desk:pickDirectory` over IPC in `electron/preload.js`.
- **Interactive UI Binding:**
  - In `ui/config.js`, bound "Quitar" buttons to `removeFolder` with account and folder path parameters.
  - In `ui/dialogs.js`, updated `scanDialog` with interactive path input (`scanPath`), native folder picker button (`browseScanFolder`), depth selector chips (`scanDepth`), error feedback banner, and submit button (`submitScanFolder`).
  - In `ui/app.js`, implemented all actions and state properties to update repository trees reactively without requiring an application restart.

---

## 2. Startup Loading State & Placeholder Prevention

### Root Cause
- In `index.html`, an animated loading view (`"Iniciando despacho local..."`) was embedded inside `<div id="app">`.
- However, at the bottom of `ui/app.js`, `render()` was executed synchronously during module evaluation.
- Because background data retrieval calls (`desk.repos()`, `desk.conversations()`, `desk.agents()`, etc.) are asynchronous, `render()` immediately overwrote `#app` before any real data arrived.
- As a result, the application flashed unpopulated placeholder states (`0 repos · 0 cuentas · 0 de 5 sesiones...`, empty cards, empty repository lists) instead of preserving the loading view until data was available.

### Resolution & Pattern
- **Explicit Initial Loading Gate:**
  - Initialized `state.loading = Boolean(window.desk?.isDesk)` in `ui/app.js`.
  - In `paint()`, if `state.loading` is active, rendered `renderLoading()` to preserve the animated loading screen and prevent displaying zeroed metrics and empty tables.
- **Asynchronous Batch Settlement:**
  - Grouped all initial data fetching promises (`repos`, `conversations`, `agents`, `config`, `worktrees`, `usage`, `quotas`, `scheduledTasks`, `delivered`, `skills`) into `Promise.allSettled()`.
  - Once settled, set `state.loading = false` and triggered a single clean `render()`.
- **Timer and Smoke Test Guarding:**
  - Guarded the 1-second UI tick interval (`if (state.loading) return;`) to prevent premature re-renders.
  - Updated the automated smoke test in `electron/main.js` to poll with a timeout up to 6 seconds, allowing the initial asynchronous data load to settle before validating DOM tabs.
