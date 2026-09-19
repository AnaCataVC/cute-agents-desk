# Learnings & Root Cause Analysis: Live Telemetry vs Simulated Mocks and Quotas

## 1. Antipattern: Artificial Tick Oscillations in Production Telemetry

### Root Cause
- In `ui/tokens-view.js`, the "ritmo ahora" (current rate) stat card was rendered using:
  ```javascript
  value: `${u.rate.total + (state.tick % 7) * 40} tok/min`
  ```
- This artificial modulo oscillation was originally introduced as a cosmetic placeholder to convey "liveness" to the artboard.
- In production, it caused active confusion: the rate showed non-zero values (`40 tok/min`, `80 tok/min`, `120 tok/min`) cycling continuously even when zero agents were running, masking genuine underlying rate calculations.

### Resolution & Pattern
- **Zero Mock Telemetry Invariant:** Metrics displayed in system health and resource consumption cards must be strictly deterministic. If rate is zero, it must render as `0 tok/min`.
- Removed `+ (state.tick % 7) * 40` so the card directly reflects measured rates computed from active agents.

---

## 2. Telemetry Scope Disconnect: Local Safety Budgets vs Official Provider Quotas

### Root Cause
- The "Uso" tab originally only displayed `u.budgets` computed against hardcoded local daily caps (`claudeTokens / 1.6M` and `agyTokens / 900k`), derived solely from today's sessions in `events.jsonl`.
- If no agents were dispatched through the harness today, all counters showed 0% usage. Meanwhile, the developer had exhausted their weekly subscription quota in external Claude Code or Antigravity sessions.
- Users naturally assumed the progress bars represented their actual Anthropic / Google subscription balances.

### Resolution & Pattern
- **Two-Tier Resource Governance:** Decouple local harness safety caps from cloud provider subscription quotas.
  1. **Official Provider Telemetry (`desk:quotas` / `electron/quotas.js`):** Query non-interactive diagnostic commands (`claude -p "/usage"` and `agy -p "/usage"`) with a 60-second in-memory TTL cache and strict timeout bounds. Extract weekly used percentages, rolling 5-hour window balances, and reset timestamps.
  2. **Local Safety Caps ("Tope diario del arnés"):** Retained exclusively as an execution breaker to kill runaway local agent loops before budgets are depleted.
- Provide an explicit "Actualizar" action to force-refresh provider quotas on demand.

---

## 3. Windows Subprocess Tree Termination & CLI Stdio Pitfalls

### Root Cause
- In Windows (`win32`), running `spawn('claude', ['-p', '/usage'], { shell: true })` spawns an intermediate `cmd.exe` process.
- Calling `child.kill('SIGKILL')` upon timeout only signals the `cmd.exe` shell, leaving the underlying `claude.exe` or `agy.exe` process running orphaned in the background.
- Running `claude -p "/usage"` with `stdio: ['ignore', 'pipe', 'pipe']` does NOT close stdin with EOF; Claude CLI detects non-TTY input and waits 3 seconds (`Warning: no stdin data received in 3s, proceeding without it`).
- Claude CLI's `/usage` diagnostic contacts Anthropic cloud APIs over the network, requiring 12–14 seconds on Windows. A low 8-second timeout caused `taskkill` to terminate the process prematurely every single time, returning `claude: null`.

### Resolution & Pattern
- **Process Tree Murder on Windows:** On timeout, inspect `child.pid` and execute `taskkill /PID <pid> /T /F` synchronously to terminate the entire process hierarchy.
- **Immediate EOF Stdin Suppression:** Configure `stdio: ['pipe', 'pipe', 'pipe']` and immediately invoke `child.stdin?.end()` to send EOF, eliminating the 3-second stdin wait.
- **Realistic Split Timeouts & Cooldowns:** Allot up to 20–22 seconds for remote `/usage` fetches while capping fast local commands (`auth status --json`) to 5 seconds. Apply a 10-second cooldown on manual refreshes to prevent process exhaustion.
- **Dual Limit Visualization:** Render both current session usage (`sessionUsedPct`, `sessionResetsAt`) and weekly usage (`weekAllModelsUsedPct`, `weekResetsAt`) for complete parity with AGY.
