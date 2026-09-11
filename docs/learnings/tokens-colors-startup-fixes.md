# Learnings & Root Cause Analysis: UI Tokens, Account Colors, and Startup Latency

## 1. Token Counter Reactivity & Aggregated Usage

### Root Cause
- In `electron/events.js`, the `apply()` method handled incoming CLI `Status` events by parsing token counts, context percentages, and costs, but immediately returned without invoking `this.publish()`.
- Consequently, while internal agent records stored token metrics, the Electron main process never dispatched IPC updates (`desk:patch`) to the renderer upon status changes.
- In `ui/data.js`, `getUsage()` returned mock static counters (`'0 k'`, `'$0.00'`), remaining completely detached from live sessions.

### Resolution & Pattern
- **Reactive Status Dispatch:** Explicitly invoke `this.publish()` upon `Status` event ingestion.
- **Historical Accumulation without Double-Counting:** Maintain cumulative token and cost counters for completed agents (`completedUsage`). Active agents are tracked via the live agent registry (`this.agents`), while terminal agents (`done` or `failed`) are accrued into completed statistics and excluded from live iteration to avoid double-counting during their UI retention window (`TERMINAL_RETENTION_MS`).
- **Dynamic Frontend Computations:** Calculate total tokens, engine splits (Claude vs. AGY), live rates (tok/min), risk thresholds (context >= 85%), and per-account allocations reactively in `getUsage()`.

---

## 2. Interactive Account Color Customization & Persistence

### Root Cause
- In `ui/config.js`, account color swatch buttons (`swatchButton`) lacked action identifiers (`data-act`), rendering them inert in the event delegation pipeline.
- There was no IPC handler or backend function to update and persist account colors to `accounts.json`.

### Resolution & Pattern
- **Action Wiring:** Tagged swatch buttons with `data-act="setAccountColor"` and encoded account identifier and color via `data-arg="${accountId}|${color}"`.
- **Atomic Config Persistence:** Implemented `updateAccountColor(gh, color)` in `electron/accounts.js` to modify `accounts.json` safely.
- **In-Memory Cache Synchronization:** Exposed `desk:setAccountColor` IPC which persists the change and updates `repoDataPromise` cache in memory without triggering expensive Git re-scans.
- **Optimistic UI Updates:** Applied optimistic color updates in `ui/data.js` for zero-latency feedback before remote IPC resolution.

---

## 3. Desktop Startup Latency & Initial Blank Screen Prevention

### Root Cause
- `BrowserWindow` was instantiated with default visibility (`show: true`) and a dark background (`#151223`), presenting a blank dark frame while Chromium fetched, parsed, and evaluated local stylesheets, fonts, and ES module imports.
- `index.html` mounted an empty `<div id="app"></div>` without inline loading skeletons.
- Initial repository discovery (`scanRepos`) walked 70+ local repositories spawning 280 Git subprocesses, blocking initial data delivery by ~19 seconds.

### Resolution & Pattern
- **Graceful Window Presentation:** Configured `BrowserWindow` with `show: false`, deferring display until the `ready-to-show` event with a fallback timeout.
- **Branded Initial Loader Skeleton:** Embeeded a lightweight CSS animation and branding skeleton inside `<div id="app">` in `index.html`. This ensures immediate visual feedback upon the first paint before module execution.
- **Disk Metadata Caching (`reposCache`):** Cached discovered repository metadata to `repos-cache.json`. On subsequent application boots, `getRepoData()` returns cached repository structures in 0 ms, while scheduling a non-blocking background scan to refresh cache state and broadcast diffs via `desk:patch`.
- **Tree Loading Indicator:** Provided an explicit loading state in `renderRepoTree` to inform users while cold scans run.
