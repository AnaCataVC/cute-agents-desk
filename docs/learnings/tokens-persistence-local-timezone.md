# Learnings: Token Telemetry Persistence, Local Timezone Alignment, and Account Attribution

## 1. Local Timezone Day Boundaries vs. UTC Slicing

### Problem
In `electron/events.js`, daily telemetry was loaded using:
```javascript
const todayPrefix = new Date().toISOString().slice(0, 10);
```
Because `toISOString()` yields the date in UTC:
- For users in Western timezones (e.g., UTC-3, UTC-5), any session running between 21:00 and midnight local time was stamped with the following UTC calendar date.
- Opening the desktop app the next morning evaluated against the new UTC date, resulting in immediate reset to zero if no session had run yet that day.
- Historical token counts across previous days were completely unreferenced, leaving the entire usage view displaying flat zeros (`0 tokens`, `$0.00`).

### Solution
- Implemented `isSameLocalDay(isoString, refDate)` to compare timestamps using the machine's local calendar year, month, and day (`d.getFullYear() === refDate.getFullYear() && d.getMonth() === refDate.getMonth() && d.getDate() === refDate.getDate()`).
- Added dual accumulation: `completedUsage` (local today) and `completedAllTime` (entire historical log), allowing the UI to present both active daily consumption and cumulative totals.

---

## 2. Dynamic Account Attribution from Event Logs

### Problem
In `ui/data.js`, `getUsage()` computed the **Por cuenta** breakdown by iterating exclusively over `liveAgents`:
```javascript
for (const a of agents) {
  if (a.accountId && byAcc.has(a.accountId)) { ... }
}
```
When an agent completed and exited, it remained in `Registry.agents` for only 3 seconds (`TERMINAL_RETENTION_MS = 3000`) before being deleted to prevent memory leaks. Consequently, the moment an agent finished, its tokens vanished from the accounts view.

### Solution
- Exported and reused `accountIdForCwd(cwd, accounts)` in `electron/accounts.js`.
- During `loadTodayUsage()` and `Registry.exited()`, each agent's execution folder (`cwd`, `worktreeCwd`, or fallback `workspace.added_dirs` / `project_dir` from Status events) is mapped to its registered GitHub account.
- Accumulated usage is tracked in `byAccount` (for today) and `byAccountAllTime` (cumulative).
- `ui/data.js` reads these server-provided account metrics so that even when no agent is actively running, each account retains its historical consumption and visual proportion (`share`).

---

## 3. Hourly 24-Hour Telemetry Reconstruction

### Problem
The hourly chart was populated with an in-memory `Array(24).fill(0)` that only wrote the current hour's instantaneous total. Historical hour-by-hour distribution was never read from disk.

### Solution
- In `loadTodayUsage()`, Status events occurring on the current local day are parsed to extract token increases per hour (`0..23`).
- Incremental token deltas per agent are aggregated into an hourly bucket array (`completedHourlySeries`).
- `Registry.getUsage()` returns this 24-hour array (`series`), which the frontend directly renders.

---

## 4. Honest UI Hints for Zero-Today States

### Resolution
- When daily tokens are zero (e.g., fresh boot before running new agents), the primary stat cards display the historical total as context:
  `tokens hoy: 0 | hint: histórico: 447 k`
  `costo hoy: $0.00 | hint: histórico: $1.40`
- In the **Por cuenta** table, rows distinguish between active daily usage and historical baseline:
  `0 hoy (hist: 445 k)`
This eliminates confusing blank screens without faking live activity.
