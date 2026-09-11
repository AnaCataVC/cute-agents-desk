> **Created:** 2026-09-11
> **Last Updated:** 2026-09-11

# Architecture Specification: Zero-Mock Dynamic Skills Discovery

## 1. Executive Summary
This document specifies the architecture and implementation of dynamic, zero-mock skill discovery across supported CLI engines (`claude` and `agy`) in Cute Agents Desk.

Prior to this implementation, the configuration interface relied on hardcoded artboard mock data (`dwh-designer`, `sql-queries`, `dashboard-finder`, etc.) and referenced a non-existent directory (`~/.agy/skills`). This feature transitions the skills management subsystem into an honest zero-mock seam that discovers real skills installed on the host machine with bounded I/O, path sanitization, and fallback empty states.

---

## 2. Supported Engine Discovery Paths

| Engine | Storage Path (Normalized) | Typical Skill File Structure |
| :--- | :--- | :--- |
| **Claude Code CLI** | `~/.claude/skills/` | `<skill-name>/SKILL.md` |
| **Antigravity CLI (User)** | `~/.gemini/config/skills/` | `<skill-name>/SKILL.md` |
| **Antigravity CLI (Built-in)** | `~/.gemini/antigravity-cli/builtin/skills/` | `<skill-name>/SKILL.md` |

---

## 3. Security & Resilience Invariants

### 3.1 Bounded I/O & DoS Containment (8 KB Cap)
To prevent memory saturation or event loop stalling from massive or maliciously crafted files, `electron/frontmatter.js` implements a strict 8,192-byte read cap:
```javascript
const MAX_FRONTMATTER_BYTES = 8192;
const fd = fs.openSync(filePath, 'r');
try {
  const buf = Buffer.alloc(MAX_FRONTMATTER_BYTES);
  const bytesRead = fs.readSync(fd, buf, 0, MAX_FRONTMATTER_BYTES, 0);
  return parseSkillFrontmatter(buf.toString('utf8', 0, bytesRead));
} finally {
  fs.closeSync(fd);
}
```
Frontmatter YAML header blocks never exceed 8 KB in practice. Releasing the file descriptor inside `finally` guarantees leak-free operation.

### 3.2 Path Sanitization & PII Leak Prevention
Absolute host paths (e.g. `C:\Users\<username>\...`) must never be broadcast to the renderer process or leaked into UI screenshots:
- `sanitizePath()` detects and strips `os.homedir()`, replacing it with `~`.
- Path separators are standardized using forward slashes (`/`), producing clean identifiers such as `~/.claude/skills`.

### 3.3 Strict Depth-1 Traversal & Directory Filtering
- Traversal iterates exclusively at depth 1 using `fs.readdirSync(dir, { withFileTypes: true })`.
- Internal, hidden, or pruned directories starting with `.` or `_` (such as `.git`, `.agents`, or `_podadas`) are explicitly excluded.
- Symlinks to directories are resolved safely via `fs.statSync(skillDir).isDirectory()` inside a `try/catch` block, ignoring broken or inaccessible links.

### 3.4 Resilient Error Handling (ENOENT Degradation)
If a CLI engine is uninstalled or its skills folder does not exist on disk, the backend catches the missing path and yields:
```json
{
  "engine": "claude cli",
  "color": "var(--color-lilac)",
  "path": "~/.claude/skills",
  "installed": false,
  "rows": []
}
```
No unhandled exceptions or rejected IPC promises escape to the main window.

---

## 4. Frontmatter Parsing Specification (`electron/frontmatter.js`)

The micro-parser extracts scalar values without external libraries:
- **UTF-8 BOM Stripping:** Detects and removes leading `\uFEFF` emitted by PowerShell utilities.
- **Name:** Captured from `^name:\s*(.+)$`, stripped of surrounding quotes.
- **Description:** Supports single-line text and YAML block folded scalars (`>` or `|`), aggregating indented child lines.
- **Version:** Extracts root or `metadata.version`. Defaults to `—` if unspecified.
- **Load Mode:** Evaluates `load:`, `trigger:`, or `always_on:`. If set to `always`, `siempre`, or `true`, assigns `siempre`; defaults to `a demanda` (progressive disclosure).

---

## 5. IPC Contract & UI Integration

### 5.1 Preload & IPC Channel
- **IPC Channel:** `desk:skills`
- **Preload API:** `window.desk.skills()`

### 5.2 UI State & Component Rendering
- **`ui/data.js`:**
  - `setLiveSkills(skills)` stores the discovered engine groups.
  - `getEngineSkills()` returns live data, falling back to clean uninstalled groups (`installed: false, rows: []`) in static web previews.
- **`ui/app.js`:**
  - Fetches skills on startup via `window.desk.skills()`.
  - Implements `refreshSkills` action triggered via delegated DOM event handlers.
  - Does NOT poll continuously, avoiding unnecessary background disk wakeups.
- **`ui/config.js`:**
  - Renders honest empty states:
    - If `installed === false`: *"Directorio no detectado o motor no instalado."*
    - If empty: *"Sin skills instaladas en esta ruta."*
  - Provides a manual "Refrescar skills" button.

---

## 6. Verification & Test Suite

The feature is verified by `tools/verify-skills.js`, registered in the `FAST` test array of `tools/verify-all.js` (`npm test`):
1. **Unit Tests:** Frontmatter parsing edge cases (single-line, folded blocks, metadata versions, load triggers, corrupt files).
2. **Hermetic Tests:** Temp directory fixtures with valid skills, missing markdown fallbacks, pruned `_podadas` exclusion, and non-existent roots.
3. **Live System Smoke Test:** Verifies live discovery on the active host, confirming paths are sanitized with `~` and no internal directories leak into the result.
