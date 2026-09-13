# Desktop Configuration Persistence & Schema Architecture

## 1. Context & Objectives
Cute Agents Desk features eight configuration sub-tabs (`accounts`, `engines`, `skills`, `bosses`, `exec`, `deliver`, `perf`, `adv`). Historically, account identities and local folder mappings were persisted in `accounts.json`, while runtime execution parameters (such as `maxParallel`, `tokenCap`, PR draft flags, and coordinator limits) remained hardcoded as immutable constants in `ui/data.js`, `electron/scheduler.js`, and `electron/delivery.js`.

This architecture specifies the design, lifecycle, atomic persistence, and runtime wire-up of a dedicated `config.json` configuration store.

---

## 2. Configuration Resolution Order & Environment Hierarchy
Following the zero-leaks and portability invariants established by `electron/accounts.js`:

1. **Environment Override:** If `process.env.CUTE_AGENTS_DESK_HOME` is defined, use `path.join(process.env.CUTE_AGENTS_DESK_HOME, 'config.json')`.
2. **Portable Mode:** If running from a portable executable (`PORTABLE_EXECUTABLE_DIR`), check for `config.json` alongside the executable.
3. **Development Workspace:** In dev mode (`NODE_ENV !== 'production'`), if `config.json` exists in project root (`path.join(__dirname, '..', 'config.json')`), prioritize it for isolated local debugging.
4. **User Profile (Default Production):** Fallback to `path.join(paths.home, 'config.json')` (`~/.cute-agents-desk/config.json`).

---

## 3. Schema & Canonical Defaults
The configuration store must guarantee forward and backward compatibility. When user configuration lacks newly introduced keys, the system performs a deep merge with canonical defaults rather than failing or overwriting user preferences.

```json
{
  "coordinators": {
    "maxSessionsPerCoordinator": 3,
    "defaultEngine": "claude",
    "askBeforeSpawning": false,
    "allowAgentLinks": false,
    "reuseCoordinatorSameRepo": true,
    "reportInterval": "tool",
    "archiveOnDeliver": true,
    "idleTimeoutMinutes": 15
  },
  "exec": {
    "maxParallel": 5,
    "blockedTimeoutMinutes": 5,
    "requirePushApproval": true,
    "requireBashApproval": true,
    "autoApproveReads": true
  },
  "deliver": {
    "draftPR": true,
    "blockPushToMain": true,
    "attachReportToPR": true,
    "singlePRPerRepo": true,
    "prTitleTemplate": "<tipo>: <tarea>"
  },
  "perf": {
    "maxMountedTerminals": 1,
    "terminalScrollbackLines": 2000,
    "cardRefreshIntervalMs": 1000,
    "statusAnimations": true,
    "eventLogRotationMb": 50
  },
  "advanced": {
    "harnessDir": "~/.cute-agents-desk",
    "worktreesOutsideRepo": true,
    "sanitizeClaudeEnv": true,
    "isolateAgentConfig": true,
    "serializeRemoteOps": true,
    "reconcileOnStartup": true,
    "windowProtocol": "app://desk",
    "singleInstance": true
  },
  "engines": {
    "claude": {
      "name": "Claude Code",
      "command": "claude",
      "hooks": "full",
      "hooksLabel": "hooks completos",
      "contextCap": 200000,
      "warnAtPercent": 80,
      "branchPrefix": "claude/"
    },
    "agy": {
      "name": "Antigravity CLI",
      "command": "agy",
      "hooks": "full",
      "hooksLabel": "hooks completos",
      "contextCap": 200000,
      "warnAtPercent": 80,
      "branchPrefix": "agy/"
    }
  }
}
```

---

## 4. Atomic Persistence & Corruption Prevention
In desktop environments, unexpected process terminations, OS sleep/hibernate cycles, or system crashes during disk writes can truncate JSON files to 0 bytes.

### Pattern: Safe Atomic Replacement
1. Serialize payload with standard formatting (`JSON.stringify(config, null, 2)`).
2. Write payload to a temporary file (`config.json.tmp`) located in the same directory (guaranteeing same filesystem partition).
3. Flush to physical storage (`fs.fsyncSync`).
4. Atomically rename temporary file over target file (`fs.renameSync`).
5. On Windows, if `EPERM` or `EBUSY` occurs during rename due to background indexing services (SearchIndexer/Antivirus), implement an exponential backoff retry fallback with direct copy + unlink.

---

## 5. IPC Architecture & Reactive Subsystem Wiring
- **Backend IPC (`electron/main.js`):**
  - `desk:config`: Synchronously/asynchronously returns current merged configuration.
  - `desk:updateConfig`: Accepts `{ section, key, value }` or partial patch, persists to disk, and dispatches dynamic reconfigurations:
    - Updates `scheduler.globalCap` dynamically without server restarts.
    - Updates active `delivery.js` draft policy.
    - Broadcasts updated config state to renderer via `desk:patch` or returns `{ ok: true, config }`.
- **Renderer Binding (`ui/app.js` & `ui/config.js`):**
  - Interactive click handlers on `.toggle-track` elements (`data-act="toggleConfig"`).
  - Editable value fields / dialogs for numeric/string settings.
  - Immediate optimistic UI update + background IPC persistence.
