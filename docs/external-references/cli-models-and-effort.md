# CLI Model Selection, Reasoning Effort, and Execution Modes in Claude Code and Antigravity CLI

## 1. Executive Summary
This document benchmarks and specifies the command-line interfaces for:
1. **Model Selection** (`--model`)
2. **Reasoning Effort Level Configuration** (`--effort`)
3. **Execution / Permission Modes** (`--permission-mode` vs `--mode`, e.g., `acceptEdits`, `plan`, `auto`)

for both **Claude Code** (`claude`) and **Antigravity CLI** (`agy`). It defines contracts, valid domains, validation rules, and integration patterns for the `cute-agents-desk` execution harness.

---

## 2. Command-Line Interface Specifications

### 2.1 Claude Code (`claude`)
Verified via `claude --help` (v2.1.x+):
- **Model Flag:** `--model <model>`
  - Accepts short aliases (`sonnet`, `opus`, `haiku`) or fully-qualified model identifiers (e.g., `claude-sonnet-4-6`, `claude-opus-4-6`).
  - Optional fallback: `--fallback-model <model>`.
- **Reasoning Effort Flag:** `--effort <level>`
  - Permitted values: `low`, `medium`, `high`, `xhigh`, `max`.
  - Controls thinking token budgets and reasoning intensity for models supporting extended thinking.
- **Permission Mode Flag:** `--permission-mode <mode>`
  - Permitted values: `"acceptEdits"`, `"auto"`, `"bypassPermissions"`, `"manual"`, `"dontAsk"`, `"plan"`.
  - In particular:
    - `acceptEdits`: auto-approves file edits within the workspace (standard write mode in harness).
    - `plan`: planning mode (read-only planning and solution design).
    - `auto`: autonomous classifier-based permission evaluation.
    - `manual` / `dontAsk`: prompt or block on permission boundaries.
- **Default Behavior:**
  - If omitted, `claude` uses ambient configuration (`~/.claude.json`).

### 2.2 Antigravity CLI (`agy`)
Verified via `agy --help` and `agy models` (v1.2.x+):
- **Model Flag:** `--model <model>`
  - Accepts model identifiers returned by `agy models`:
    - `gemini-3.8-flash-high`
    - `gemini-3.8-flash-medium`
    - `gemini-3.8-flash-low`
    - `gemini-3.7-flash-high`
    - `gemini-3.7-flash-medium`
    - `gemini-3.7-flash-low`
    - `gemini-3.6-flash-high`
    - `gemini-3.6-flash-medium`
    - `gemini-3.6-flash-low`
    - `gemini-3.1-pro-high`
    - `gemini-3.1-pro-low`
    - `claude-sonnet-4-6`
    - `claude-opus-4-6-thinking`
    - `gpt-oss-120b-medium`
- **Reasoning Effort Flag:** `--effort <level>`
  - Permitted values: `low`, `medium`, `high`.
  - Description: "Reasoning effort for the current CLI session (low|medium|high)".
- **Execution Mode Flag:** `--mode <mode>`
  - Permitted values: `accept-edits`, `plan`.
  - Note: `agy` does **NOT** support `auto`, `bypassPermissions`, or `dontAsk`.
- **Default Behavior:**
  - If omitted, `agy` runs with ambient default model and configuration.

---

## 3. Comparison Matrix

| Dimension | Claude Code (`claude`) | Antigravity CLI (`agy`) | Validation Rule |
| :--- | :--- | :--- | :--- |
| **Model Flag** | `--model <model>` | `--model <model>` | Safe regex: `^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,99}$` (cannot start with `-`) |
| **Model Presets** | `default`, `sonnet`, `opus`, `haiku`, `claude-sonnet-4-6`, `claude-opus-4-6` | `default`, `gemini-3.8-flash-high`, `gemini-3.7-flash-high`, `gemini-3.1-pro-high`, `claude-sonnet-4-6`, etc. | Autocomplete preset + free-form text fallback |
| **Effort Flag** | `--effort <level>` | `--effort <level>` | Strict allowlist per engine |
| **Effort Domain** | `low`, `medium`, `high`, `xhigh`, `max` | `low`, `medium`, `high` | Reject `xhigh`/`max` for `agy` |
| **Execution Mode Flag** | `--permission-mode <mode>` | `--mode <mode>` | Engine-aware mapping |
| **Write Mode** | `--permission-mode acceptEdits` | `--mode accept-edits` | Both supported |
| **Planning Mode** | `--permission-mode plan` | `--mode plan` | Both supported (`plan` or `planning`) |
| **Auto Mode** | `--permission-mode auto` | **Unsupported** | Allow for `claude`; reject with error for `agy` |
| **Read-only Mode** | Harness hook blocks write tools | Harness hook allowlists read-only tools | Both supported in harness |

---

## 4. Integration & Validation Architecture

1. **Mode Normalization & Validation (`electron/agent.js`)**:
   - Normalized mode categories:
     - `'write'`: maps to `--permission-mode acceptEdits` (`claude`) or `--mode accept-edits` (`agy`). Spawns in worktree for `claude`.
     - `'plan'` / `'planning'`: maps to `--permission-mode plan` (`claude`) or `--mode plan` (`agy`). Skips worktree creation.
     - `'auto'`: maps to `--permission-mode auto` (`claude`). Throws validation error if requested for `agy`:
       `'el motor agy no soporta el modo "auto" (modos validos: write, plan, read)'`.
     - `'read'`: harness read-only mode (no worktree, hook enforcement).
   - Any unknown mode must throw a descriptive validation error before spawning child processes.

2. **Backend Contracts (`electron/agent.js`, `electron/main.js`)**:
   - `spawnWorker` validates `mode`, `model`, and `effort` against the selected engine. If validation fails, logs a `SpawnRefused` event and returns `{ error }` to the renderer or coordinator.

3. **UI Integration (`ui/dialogs.js`, `ui/app.js`)**:
   - In `queueDialog`, mode selector provides:
     - `Escribe` (`write`)
     - `Planifica` (`plan`)
     - `Auto` (`auto` — disabled or hidden when `agy` is selected)
     - `Sólo lee` (`read`)
   - Switching engines dynamically disables or switches incompatible mode selections to prevent invalid submissions.
