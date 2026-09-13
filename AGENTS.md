# Guidelines for AI Agents (`AGENTS.md`)

This repository follows strict engineering, architectural, and documentation standards. All AI coding assistants interacting with this codebase must adhere to the following directives:

---

## 1. Documentation Language Directives

- **Technical Documentation in English:** All technical documentation, guides, architectural specs, learnings, PR descriptions, and markdown files inside `docs/` must be written in **English**.
- **README Structure (Bilingual):**
  - The primary `README.md` in the repository root is written in **Spanish** (`Español`).
  - An accompanying complete English version is maintained at `README.en.md`.
  - Both files must stay in 1:1 functional synchrony whenever features, test counts, or architectures are updated.
- **Zero Flags Invariant:** Never use country flag emojis (`🇺🇸`, `🇬🇧`, `🇪🇸`, etc.) or flag graphics in any documentation, language switchers, or headers. Use clean semantic text (`[Español](README.md) | [English](README.en.md)`).

---

## 2. Source Code & Commit Conventions

- **Code in English:** Variable names, functions, classes, comments, and docstrings must be in English.
- **Conventional Commits:** Follow standard Conventional Commits format in English (`feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`).
- **Interactive Chat Language:** Respond to the user in Spanish (unless explicitly requested otherwise).

---

## 3. Architecture & Testing Invariants

- **Fast & Hermetic Test Suite (`npm test`):**
  - All automated fast unit tests live in `tools/verify-*.js` and must pass under plain `node` in seconds without spawning real CLI agents or opening Electron windows.
  - All tests must maintain 100% pass rate (`29/29 verify scripts OK`).
- **Zero Mock Telemetry:** Never introduce artificial oscillations or mock animations in production telemetry cards (`ui/tokens-view.js`). Metrics must reflect deterministic, live state.
- **Windows Process Management:** Always terminate child process trees cleanly on Windows via `taskkill /PID <pid> /T /F` when handling CLI timeouts.
- **IPC Architecture Reference:** Refer to `docs/architecture/ipc-contracts.md` and `docs/architecture/subsystems-overview.md` before introducing new channels or modifying Electron preload boundaries.
- **Hermetic & Typed Payloads (Zero Unvalidated Objects):** Payloads passed across IPC boundaries (`desktop:*` / `desk:*`) must consist exclusively of JSON-compatible serializable primitives or validated schemas. Always validate input shapes and boundaries before triggering filesystem, Git worktree, or subprocess operations.
- **Worktree Invariant for Write Operations:** Write tasks and background scheduled runs must always operate inside dedicated Git worktrees (`<engine>/<task>-<id>`), keeping the root checkout clean.

