# Multi-Repo Parent Workspace & Non-Repo Coordinator Workspaces

> **Date:** 2026-09-19  
> **Topic:** Habilitación de carpetas paraguas / agrupadoras multi-repo (Workspace Multi-Repo) en Cute Agents Desk

---

## 1. Context & Problem Statement

In **Cute Agents Desk**, repository management and task delegation were originally designed with 1:1 Git repository semantics:
- Every scanned repository has a `.git` root.
- In `mode: 'write'`, an isolated `git worktree` is created on a separate branch (`agent/<id>` or `<engine>/<slug>-<id>`).
- The Coordinator operates with `worktree: false` directly in its own conversation folder (`~/.cute-agents-desk/conversations/<id>`), and receives a prompt listing discovered git repos.
- In `electron/agent.js`, if a worker or process is spawned on a directory that is not a git repository, `worktree.createWorktree` throws an error (`"<repoPath>" no es un repo git; no se puede crear un worktree ahi`), causing an audible failure and fallback.

### The Need for Multi-Repo Parent Workspaces
Users often group related projects under a single root directory (e.g. `C:\Proyectos\Plataforma\` containing `backend-api/`, `frontend-web/`, `mobile-app/`, and `infra/`).
Users want to:
1. Allow the coordinator or agent to work from this parent folder.
2. Ensure this feature is **strictly disabled by default** and only activated when explicitly requested by the user during conversation/coordinator configuration.
3. Allow the coordinator to understand the folder structure and delegate work into the individual child repositories where git worktrees and isolated branches continue to function normally.

---

## 2. Architectural Analysis & Solution Patterns

### 2.1 Workspace Detection & Repos Discovery
- `electron/discovery.js` already implements `findRepos(dir, depth)` which descends through subdirectories looking for `.git`.
- If a conversation has `cwd: "C:/path/to/umbrella"`, and `multiRepoWorkspace: true`:
  - `findRepos(cwd, 2)` can dynamically locate child repositories inside the umbrella directory.
  - The coordinator prompt can be enriched with a dedicated `<workspace_umbrella path="...">` section detailing the sub-repositories located within that parent workspace.

### 2.2 Worktree Isolation Invariant
- A non-git umbrella directory cannot have a `git worktree`.
- Attempting `git worktree add` on the umbrella root will fail.
- **Invariant:** When the coordinator delegates tasks with `"cwd": "<child-repo-path>"`, `agent.js` can and should create standard git worktrees inside the child repo.
- If a task is delegated directly to the umbrella root (e.g. general read/plan mode or root-level scripts), it must run with `worktree: false` or in read/plan mode without attempting git commands on the parent folder.

### 2.3 Opt-in State Invariant
- The flag `multiRepoWorkspace` must default to `false`.
- If `false`, the system maintains existing strict behavior.
- If `true`, the coordinator system prompt and spawn mechanics enable umbrella workspace inspection and sub-repo dispatching.
