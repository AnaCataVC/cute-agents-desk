# Architecture & Research: Hierarchical Repository Tree & Real Path Resolution

> **Created:** 2026-09-12  
> **Topic:** Hierarchical directory tree navigation and robust repo dispatch in Cute Agents Desk

---

## 1. Context and Problem Statement

Cute Agents Desk allows users to configure account roots with scan depths in `accounts.json` (e.g. `C:/Users/<username>/Work/Repositories` with `depth: 3`).

In real workstations, repositories are rarely located immediately inside the root folder. Instead, they are organized in nested domain/team hierarchies:
```text
Repositories/
  external/
    nvidia-cuopt-examples/
    summitagentic2026/
  simplit/
    ada/
      ada-chat-frontend/
      ada-genai/
    data-domain/
      datamart-mcp/
    front/
      apollo-web/
    optimizer/
      simpli-2-optimizer/
```

### Critical Flaws in the Existing Implementation
1. **Flattening in `discovery.js`**:
   `inspectRepo` forces `folder = folderRoot`, discarding intermediate subdirectories (`simplit/ada/`, etc.).
2. **Hardcoded 3-Level Flat Tree in `repo-tree.js`**:
   `repo-tree.js` assumes `Account -> Declared Folder -> Repos`. For root folders containing dozens of repositories across multiple sub-teams, this produces an unmanageable, flat list of 50+ items without visual organization.
3. **Broken Process Working Directory (`cwd`) in `app.js`**:
   `app.js` crafts `cwd = `${repo.folder}/${repo.name}`` because `repo.path` is dropped in `data.js`. For any nested repository, this points to a non-existent path (`.../Repositories/ada-chat-frontend`), causing `main.js` (`spawnWorker`) to reject dispatch with:
   `""<invalid-path>" no es uno de los repos registrados"`.

---

## 2. Architectural Design

### 2.1 Preserving Full Paths & Relative Directories
In `electron/discovery.js`:
- Calculate `relPath = path.relative(folderRoot, repoPath).replace(/\\/g, '/')`.
- Calculate `subfolder = path.relative(folderRoot, path.dirname(repoPath)).replace(/\\/g, '/')`.
- Preserve `path: repoPath` as the absolute canonical path on disk.
- Keep `folder: folderRoot` intact for backwards compatibility with existing account mappings and tests.

In `ui/data.js`:
- `getRepos()` must return `path`, `relPath`, and `subfolder` alongside existing fields.

### 2.2 Hierarchical N-Level Collapsible Tree in `ui/repo-tree.js`
Under each declared root folder:
- Convert the flat array of repos for that root into a nested directory tree:
  ```typescript
  interface TreeNode {
    name: string;
    path: string; // unique key for state.open, e.g. "root::simplit" or "root::simplit/ada"
    isFolder: boolean;
    subfolders: Map<string, TreeNode>;
    repos: Repo[];
  }
  ```
- **Collapsible State:**
  Each subfolder node gets an action `data-act="toggleNode" data-arg="${nodeKey}"`.
  The open state is tracked in `state.open[nodeKey]`.
  By default, if `state.open[nodeKey]` is undefined, we can choose a sensible default:
  - If searching/filtering: auto-expand ancestor folders with matching repos.
  - Normal view: expanded by default or collapsed with clear `▸` / `▾` indicator. (Defaulting to expanded or 1-level expanded lets users see the structure immediately).
- **Styling & Indentation:**
  Each level adds indentation (`padding-left: calc(18px + depth * 14px)`), using clean typography, folder icons or badges, and repo counts (`<span class="mono">N repos</span>`).
- **Antenna & Dirty Indicators:**
  Bubble up or display indicators on leaf repos and folder badges so users instantly spot active agents or dirty trees anywhere inside nested folders.

### 2.3 Dispatching Tasks with Canonical `repo.path`
In `ui/app.js`:
- In `submitQueue()`:
  `const cwd = repo ? (repo.path || (repo.folder ? `${repo.folder}/${repo.name}` : repo.name)) : undefined;`
- Guaranteed valid path matching `repos.some((r) => r.path === cwd)` in `main.js`.

---

## 3. Backwards Compatibility & Invariants
- `repo.folder === folder.path` continues to hold for `verify-live-repo-data.mjs`.
- Existing tests continue passing with zero regressions.
- No new external dependencies required; implemented purely with Vanilla JS & CSS.
