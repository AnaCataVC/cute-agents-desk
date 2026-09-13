# External Editor Integration & Lightweight Syntax Highlighting Research

> **Status:** Active Reference  
> **Topic:** External IDE launch per GitHub account & Lightweight syntax highlighting in diff view  
> **Context:** Cute Agents Desk - Worktree review and diff inspection  

---

## 1. Executive Summary & Architectural Invariants

Cute Agents Desk is an agent orchestration and supervisory desktop application built with Electron, Vanilla JS, and `node-pty`. Its "Editor" tab serves as a **diff gatekeeper** for reviewing uncommitted changes across isolated agent worktrees before approving delivery to Pull Requests.

To maintain its core principles—instant cold start, low RAM footprint, hermetic testing, and zero dependency bloat—we evaluate two enhancements requested by the user:
1. **Configurable External Editor per GitHub Account**: Launching either Visual Studio Code or Google Antigravity IDE (or falling back to system default) directly into the agent's isolated worktree.
2. **Lightweight Static Syntax Highlighting**: Improving diff readability without embedding heavy IDE engines (Monaco/LSP) or violating the application's strict Content Security Policy (`script-src 'self'`).

---

## 2. External Editor Architecture (VS Code vs. Antigravity IDE)

### 2.1 Editor Target Models
Both Visual Studio Code and Google Antigravity IDE share a common command-line interface pattern (VS Code fork ancestry):

| Feature | Visual Studio Code | Antigravity IDE |
| :--- | :--- | :--- |
| **Default CLI Command** | `code` (`code.cmd` on Windows) | `antigravity-ide` (`antigravity-ide.cmd` on Windows) |
| **Default Install Directory (User Scope)** | `%LOCALAPPDATA%\Programs\Microsoft VS Code` | `%LOCALAPPDATA%\Programs\Antigravity IDE` |
| **Primary Executable** | `Code.exe` | `Antigravity IDE.exe` |
| **CLI Arguments for Folder** | `code [path]` | `antigravity-ide [path]` |
| **CLI Arguments for File + Line** | `code -g [path]:[line]` | `antigravity-ide -g [path]:[line]` |
| **New Window Flag** | `-n` or `--new-window` | `-n` or `--new-window` |
| **Reuse Window Flag** | `-r` or `--reuse-window` | `-r` or `--reuse-window` |

### 2.2 Dynamic Binary Resolution Strategy (Zero Hardcoded User Paths)
In accordance with privacy and portability invariants, no machine-specific user paths (`C:\Users\<user>\...`) may ever be hardcoded. The resolution pipeline must follow an ordered strategy:

1. **System `PATH` Lookup**:
   Attempt invocation via standard binary name: `code.cmd` / `code` for VS Code, and `antigravity-ide.cmd` / `antigravity-ide` for Antigravity IDE.
2. **Environment Variable Fallback (`%LOCALAPPDATA%`)**:
   - VS Code: Check `path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')` or `Code.exe`.
   - Antigravity IDE: Check `path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd')` or `Antigravity IDE.exe`.
   - Program Files: Check `process.env['ProgramFiles']` and `process.env['ProgramFiles(x86)']`.
3. **Graceful Fallback**:
   If the configured binary is not detected on the machine, do not crash or throw uncaught errors. Fall back cleanly to Electron's native `shell.openPath(worktreePath)` (which opens the OS file explorer or default folder association) and return an informative notification.

### 2.3 Command Execution Security (Zero Shell Injection)
- **Invariant**: Never use `child_process.exec()` or string interpolation with `cmd.exe /c`.
- **Enforcement**: Always use `child_process.spawn(resolvedExecutable, argsArray, { detached: true, stdio: 'ignore' })` with `unref()` so the editor process lives independently of Cute Agents Desk.
- Pass paths strictly through `argsArray` so paths with spaces or special characters are safely handled by the OS kernel without shell expansion vulnerabilities.

### 2.4 Data Model & Configuration Schema
In `accounts.json`, each account object gains an optional `editor` property:
```json
{
  "gh": "AccountHandle",
  "email": "developer@example.com",
  "color": "var(--color-lilac)",
  "editor": "vscode",
  "folders": [
    { "path": "D:/Repositories", "depth": 2 }
  ]
}
```
Supported values:
- `"vscode"` (default or explicit Visual Studio Code)
- `"antigravity"` (Google Antigravity IDE)
- `"system"` (System default file explorer / OS shell)

---

## 3. Lightweight Syntax Highlighting in the Diff Viewer

### 3.1 Content Security Policy & Bundle Constraints
`index.html` enforces:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' app:; style-src 'self' app: 'unsafe-inline';">
```
- External CDNs (cdnjs, jsdelivr, unpkg) are **strictly forbidden and blocked**.
- All code must exist locally in `ui/` as ES Modules (`ui/highlight.js`).
- Fast hermetic tests (`tools/verify-*.js`) run under standard Node.js without DOM APIs.

### 3.2 Evaluation of Candidate Approaches

| Criteria | Monaco Editor | Highlight.js Full | Prism.js Modular | Pure Micro Tokenizer (Vanilla ES) |
| :--- | :--- | :--- | :--- | :--- |
| **Bundle Size** | ~40-60 MB | ~1.2 MB | ~25-45 KB | **~6-12 KB** |
| **RAM Footprint** | +200 MB | +15 MB | <2 MB | **<500 KB** |
| **Dependencies** | Many | npm package | npm or vendored | **0 external dependencies** |
| **Node Unit Testable** | No (requires DOM) | Yes | Yes (core) | **100% Hermetic** |
| **XSS Safety** | High | High | High | **Total (Strict token escaping)** |
| **Language Coverage** | 100+ | 190+ | 200+ | **Targeted (Top 10 languages)** |

### 3.3 Micro-Tokenizer Architecture for Diffs
Rather than loading an entire AST parser for each language, diff highlighting only requires lexical classification of tokens:
- **Keywords**: `import`, `export`, `function`, `class`, `const`, `let`, `var`, `return`, `if`, `else`, `def`, `async`, `await`, etc.
- **Strings**: `'...'`, `"..."`, `` `...` ``.
- **Comments**: `//...`, `/* ... */`, `#...`.
- **Numbers**: `\b\d+(\.\d+)?\b`.
- **Types / Built-ins**: `true`, `false`, `null`, `undefined`, `self`, `None`, `True`, `False`.

#### XSS Prevention Invariant:
In `ui/editor.js`, line contents are already escaped with `esc(text)` (`& -> &amp;`, `< -> &lt;`, `> -> &gt;`).
The tokenizer must operate either:
1. On plain text strings, tokenize them, escape each token segment using `esc()`, and wrap with semantic spans: `<span class="tok-kw">${esc(token)}</span>`.
2. Ensure no raw unescaped input ever reaches the HTML string template.

#### Performance Safeguard:
For large diffs (e.g., generated lockfiles or files with >1,000 lines), tokenization runs only on visible or capped hunks (<800 lines per file), falling back to fast escaped plain text to guarantee that UI re-rendering remains <16ms (60 FPS).
