# Learnings & Root Cause Analysis: Config Persistence and Adversarial Hardening

## 1. Context & Architectural Problem
Cute Agents Desk features eight configuration sub-tabs (`accounts`, `engines`, `skills`, `bosses`, `exec`, `deliver`, `perf`, `adv`). While account profiles and local repository folder mappings were persisted in `accounts.json`, execution parameters (such as `maxParallel`, engine `contextCap`, delivery PR flags, and coordinator limits) remained hardcoded as immutable constants in `ui/data.js`, `electron/scheduler.js`, and `electron/delivery.js`.

The implementation of `config.json` required a robust, thread-safe, and secure configuration subsystem capable of dynamic reconfiguration without sacrificing the zero-secret and plain-text inspection principles of the harness.

---

## 2. Red Team Findings & Adversarial Hardening

During the adversarial stress-test review of the initial `config.json` implementation, four distinct vulnerabilities and edge cases were identified and systematically resolved:

### 2.1 Prototype Pollution Prevention (V-01)
* **Vulnerability:** Unfiltered property merging in `deepMerge` and `updateConfigKey` allowed attackers or compromised renderer scripts to inject properties onto `Object.prototype` via `__proto__`, `constructor`, or `prototype`.
* **Hardening:**
  * Implemented an immutable blacklist of forbidden keys (`FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])`).
  * Enforced strict schema guards checking `Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, section)` and key validation before applying mutations.

### 2.2 Numerical Bounds Clamping & DoS Prevention (V-02)
* **Vulnerability:** Unchecked user inputs could inject negative or extreme integer values:
  * Setting `maxParallel = -1` caused `runningCount >= this.globalCap` (`0 >= -1`) to evaluate to `true` permanently, inducing a complete Denial of Service on worker process spawning.
  * Setting `maxParallel = 1000` could trigger process table exhaustion and memory starvation (*fork bomb*) in Windows environments.
* **Hardening:**
  * Implemented `validateAndSanitize(section, key, value)`.
  * Clamped `maxParallel` strictly between `1` and `20`.
  * Clamped `maxSessionsPerCoordinator` between `1` and `10`.
  * Clamped token context caps and timeouts to operational safety margins.

### 2.3 Elimination of Read-Modify-Write Concurrency Races (V-03 & V-05)
* **Vulnerability:** Rapid successive IPC mutations from UI toggle switches triggered concurrent file reads before prior disk writes finished atomic renaming, causing state loss. Additionally, `Date.now().tmp` collided under sub-millisecond multi-core execution.
* **Hardening:**
  * Added in-memory cached configuration state (`cachedConfig`) synchronized across all operations.
  * Added process PID, high-resolution timestamp, and random nonce entropy (`${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`) to temporary swap files.
  * Implemented atomic rename (`renameSync`) with fallback to `copyFileSync` and `unlinkSync` to handle Windows file indexing locks.

### 2.4 Accurate UI Toggle Inversion for Unset Defaults (V-04)
* **Vulnerability:** When a user toggled an option whose key was not yet serialized in a sparse disk JSON, `current[section]?.[key]` returned `undefined`. Evaluating `typeof oldVal === 'boolean' ? !oldVal : true` incorrectly forced options with visual defaults of `true` to remain `true` on the initial click.
* **Hardening:**
  * In `ui/app.js`, `toggleConfig` now falls back to querying the effective visual default from `data.getSettings()` whenever the key is not explicitly populated in local state, ensuring deterministic toggle inversion on the first interaction.

---

## 3. Subsystem Integration & Dynamic Reconfiguration

* **Scheduler Integration:** Updating `exec.maxParallel` dynamically synchronizes `scheduler.globalCap` in real time without requiring application restarts.
* **Delivery Pipeline:** `delivery.js` inspects `config.deliver.draftPR` dynamically when invoking GitHub CLI (`gh pr create`), optionally omitting `--draft` when user configuration requests published PRs.
* **Dynamic Context Windows:** Worker spawning reads the engine-specific `contextCap` from `config.engines[engine]` to enforce live budget limits per agent.
