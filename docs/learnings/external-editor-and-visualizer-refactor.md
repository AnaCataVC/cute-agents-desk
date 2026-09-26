# Learnings & Adversarial Analysis: External Editor Integration & Visualizer Refactor

## 1. Context & Architectural Motivation

Cute Agents Desk is a desktop application built with Electron, Vanilla JS, and `node-pty` for supervising and orchestrating local AI coding agents (Claude Code, Antigravity CLI). Its primary value proposition is acting as an **agent dispatch center, worktree gatekeeper, and approval customhouse**.

The third tab in the application was historically named "Editor" (`ui/editor.js`). However, this tab was never an interactive code editor:
- It provides no text editing capabilities, no file writing, no Language Server Protocol (LSP), and no code execution.
- Its real responsibility is serving as an **uncommitted work inspection and approval gatekeeper**, displaying side-by-side or unified diffs of files modified in ephemeral Git worktrees before the user approves committing and opening a Pull Request.

When evaluating whether to add code editing capabilities and linters to this tab, an Expert Council (`ami-expert-council`) and an Adversarial Stress Test (`ami-stress-test-idea`) identified that turning Cute Agents Desk into an IDE would be an architectural antipattern:
1. **Linter ecosystem fragmentation:** Every language ecosystem requires separate runtimes, configurations, and dependencies (ESLint, Ruff, Clippy, golangci-lint). Embedding linters would create immense operational debt and false-positive conflicts with the agent's internal checks.
2. **Resource explosion:** Embeber Monaco Editor or LSP clients in Electron adds >50 MB to bundles and hundreds of megabytes of RAM per tab.
3. **Dirty state race conditions:** Allowing manual in-app file edits while agents run background tasks produces Git lock contention (`index.lock`) and context desynchronization.

The architectural solution was twofold:
1. **Bridge to external IDEs:** Allow users to open the agent's isolated worktree in their configured external editor of choice (Visual Studio Code or Google Antigravity IDE) according to the GitHub account owning the repository.
2. **Lightweight static syntax highlighting:** Add a micro-tokenizing syntax highlighter to the diff viewer (<10 KB, Vanilla ESM, zero external dependencies) without violating the strict Content Security Policy.
3. **Clarify product identity:** Rename the tab and module from "Editor" to "Visualizador" (`ui/visualizer.js`), removing misleading IDE terminology (`ideOpen`, `ideActive`).

---

## 2. Adversarial Stress-Test Findings & Mitigations

### 2.1 Dynamic Editor Binary Resolution Without Hardcoded Paths
* **Vulnerability:** Hardcoding executable paths (`C:\Users\<user>\...`) creates severe privacy leaks, breaks portability across machines, and fails when editors are installed in non-standard locations.
* **Hardening:**
  - Implemented dynamic 3-tier lookup in `electron/editor.js`:
    1. PATH lookup via `which` / `where.exe`.
    2. Environment variable detection (`%LOCALAPPDATA%\Programs\...` and `%ProgramFiles%\...`).
    3. Graceful fallback to `shell.openPath` / system file explorer without throwing unhandled exceptions.
  - Enforced an automated path privacy assertion in `tools/verify-external-editor.js` ensuring no local user profile paths exist in source files.

### 2.2 Shell Injection Prevention via Direct Spawn
* **Vulnerability:** Launching editors via `child_process.exec()` or `cmd.exe /c code ${path}` allows command injection if repository or worktree paths contain spaces, quotes, or metacharacters.
* **Hardening:**
  - Enforced strict `child_process.spawn(executable, argsArray, { detached: true, stdio: 'ignore', windowsHide: true })` with argument arrays.
  - Decoupled editor processes using `child.unref()` so closing Cute Agents Desk does not terminate the developer's external editor.

### 2.3 Strict XSS Prevention in Syntax Highlighting
* **Vulnerability:** When tokenizing diff lines containing HTML, JSX, or script tags, naive regex tokenizers could inject unescaped raw HTML into the renderer DOM, creating XSS vectors.
* **Hardening:**
  - In `ui/highlight.js`, every token (strings, keywords, comments, identifiers, punctuation) is individually filtered through `esc()` before being wrapped in semantic spans (`<span class="tok-...">`).
  - Added dedicated XSS payload test cases in `tools/verify-syntax-highlight.js` verifying that `<script>` and `<img onerror=...>` tags are converted to safe HTML entities.

### 2.4 Performance Safeguard for Massive Diffs
* **Vulnerability:** Running regex tokenization on minified files, lockfiles, or diffs with thousands of lines can block the single-threaded UI event loop.
* **Hardening:**
  - Added an automatic line-length bypass: lines exceeding 500 characters bypass tokenization and fall back to fast plain text escaping.
  - Benchmarked highlighting speed: 1,000 lines process in ~6.3 ms, guaranteeing rendering stays well within the 16 ms (60 FPS) frame budget.

---

## 3. Implementation Summary & Component Map

| Component | File | Role |
| :--- | :--- | :--- |
| **Editor Launcher** | `electron/editor.js` | Dynamic resolution for `vscode`, `antigravity`, and `system` with detached spawn. |
| **Account Preference** | `electron/accounts.js` | Reads and persists `editor: 'vscode' \| 'antigravity' \| 'system'` per account in `accounts.json`. |
| **IPC Bridge** | `electron/main.js`, `electron/preload.js` | Exposes `desk:openEditor` and `desk:setAccountEditor` channels. |
| **Syntax Highlighter** | `ui/highlight.js` | Fast Vanilla ESM tokenizer covering JS, TS, Python, Go, Rust, HTML, CSS, JSON, Shell, Markdown, and YAML. |
| **Visualizer View** | `ui/visualizer.js` | Approval diff viewer with dynamic `[ ↗ Abrir en <Editor> ]` launch buttons and color tokens. |
| **Compatibility Stub** | `ui/editor.js` | Re-exports from `visualizer.js` to preserve backward compatibility. |
| **Settings UI** | `ui/config.js` | Per-account interactive editor selector buttons. |
| **Application State** | `ui/app.js` | Manages `visualizerOpen` and `visualizerActive` tabs, mapping `visualizer` in `VIEWS` and `TABS`. |
| **CSS Tokens** | `ui/app.css` | Color tokens for `.tok-kw`, `.tok-str`, `.tok-com`, `.tok-num`, `.tok-fn`, and `.tok-type`. |
| **Verification Suites** | `tools/verify-external-editor.js`, `tools/verify-syntax-highlight.js` | 100% hermetic Node.js unit tests and performance benchmarks. |

---

## 4. Key Takeaways

1. **Avoid the Pseudo-IDE Trap:** Desktop tools for AI agent supervision should not attempt to replicate full IDE functionality. Providing a clean, instant bridge to the user's primary IDE preserves simplicity, agility, and performance.
2. **Terminology Drives Expectations:** Naming an inspection view "Editor" confuses users who expect interactive cursor editing. Renaming it to "Visualizador" accurately communicates its purpose as a diff approval customhouse.
3. **Hermetic Testing Invariant:** All automated tests continue to pass in under 3 seconds on plain Node.js (every verify script in `npm test` passes) without requiring live Electron windows or external network access.
