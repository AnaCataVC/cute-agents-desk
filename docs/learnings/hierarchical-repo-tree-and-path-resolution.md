> **Created:** 2026-09-12  
> **Status:** Active  
> **Scope:** UI Architecture (`ui/repo-tree.js`), Data Seam (`ui/data.js`), Scanner (`electron/discovery.js`)

# Learning: Hierarchical Repository Tree Virtualization & Canonical Path Resolution

## Context & Problem
In developer workstations with multiple GitHub accounts, repositories are frequently organized under domain or team directories rather than lying directly inside the top-level declared roots:
```text
Work/Repositories/
  external/
    tool-a/
  simplit/
    ada/
      frontend/
      backend/
    infra/
      k8s/
```
The early prototype flattened all discovered repositories to the top-level declared root (`folderRoot`). This triggered two systemic issues:
1. **Cognitive Overload & Visual Sprawl:** Displaying 50+ repositories in an unorganized flat list completely erased the domain/team organization established on disk.
2. **Process Dispatch Failure (Broken `cwd`):** Attempting to spawn agents using `${repo.folder}/${repo.name}` produced non-existent paths (e.g. `Work/Repositories/frontend` instead of `Work/Repositories/simplit/ada/frontend`), leading to instant dispatch refusal in the Electron backend (`SpawnRefused`).
3. **Dispatch Hijacking on Duplicate Names:** Identically-named repositories in distinct directories (e.g. `simplit/infra/infra-k8s` vs `simplit/paul/infra-k8s`) collided when selecting or dispatching by bare `repo.name`.

---

## Key Technical Decisions & Patterns

### 1. Single-Pass O(N) Metric & Flag Accumulation
Early naive tree implementations recomputed folder counts and child statuses (`totalRepos`, `hasBusy`, `hasDirty`) via recursive getters during rendering, creating $O(\text{depth} \times N)$ overhead on every repaint.

**Resolution:**  
Precompute metrics and bubble up status flags during a single $O(N)$ tree construction pass using node lineage tracking:
```javascript
const lineage = [root];
for (const part of parts) {
  // Traverse or create folder node...
  lineage.push(current);
}
current.repos.push(repo);

// Single upward propagation
for (const node of lineage) {
  node.count++;
  if (isBusy) node.hasBusy = true;
  if (isDirty) node.hasDirty = true;
}
```
During rendering, subfolder badges and indicators read these properties in $O(1)$ time with zero recursion.

### 2. Disambiguated Dispatch by Canonical Path
Repositories are indexed and referenced across the UI and dispatch pipelines by their absolute canonical disk path (`repo.path`), using `repo.name` solely as a presentation label.
- The queue dialog, repo selection dropdown, and IPC payload use `repo.path`.
- When identical repository names exist across different team folders, task dispatch is guaranteed to target the exact intended repository and worktree.

### 3. User Intention Precedence over Ambient Auto-Expansion
To prevent folders with active agents from becoming uncollapsible:
```javascript
const isNodeOpen = state.open[nodeKey] !== undefined
  ? !!state.open[nodeKey]
  : Boolean(state.search || sub.hasBusy);
```
- **Implicit state:** Auto-expands when an agent is running or during active search.
- **Explicit state:** Once the user clicks to collapse or expand, `state.open[nodeKey]` takes absolute precedence, preventing UI deadlocks.

---

## Verification
- Unit test suite: `tools/verify-hierarchical-repo-tree.mjs` verifying multi-level nesting, path search, duplicate name isolation, and explicit collapse.
- Backwards compatibility: Existing root-level mappings (`repo.folder === folder.path`) remain preserved for all historical tests and external config consumers.
