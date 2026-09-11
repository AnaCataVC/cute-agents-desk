> **Created:** 2026-09-11
> **Last Updated:** 2026-09-11

# Delivery Pipeline & Engine Worktree Isolation Specification

## 1. Executive Summary
This document specifies the technical architecture, contracts, and execution patterns for:
1. **Engine Worktree Isolation for Antigravity CLI (`agy`)**: Bringing parity to `agy` tasks in write mode by provisioning dedicated `git worktree` instances instead of running directly against the user's base repository checkout.
2. **Automated Delivery Pipeline**: Automated delivery flow when an agent finishes work:
   - Committing remaining changes with the repository's registered account identity (author name and email).
   - Branch naming per engine conventions (`claude/<task-slug>` and `agy/<task-slug>`).
   - Pushing the task branch to remote `origin`.
   - Creating a GitHub Pull Request marked strictly as **Draft** via `gh pr create --draft`.
   - Attaching the agent's final report/transcript summary in the PR body.
   - Preserving `main` unmutated.
   - Registering the delivery in the harness state (`getDelivered()`) for UI display on the Agent and Flows tabs.

---

## 2. Worktree Isolation for Antigravity CLI (`agy`)

### 2.1 The Architectural Discrepancy
In Claude Code:
- The process `cwd` is set directly to the newly created worktree directory (`~/.cute-agents-desk/wt/<agentId>`).
- Claude Code discovers hooks via `--settings <path>`, which can be any absolute path on disk.

In Antigravity CLI (`agy`):
- `agy` does NOT have a `--settings` flag.
- It strictly resolves hooks from `<process_cwd>/.agents/hooks.json`.
- Therefore, `agy`'s process `cwd` must remain the harness directory (`dirs.dir` = `~/.cute-agents-desk/agents/<agentId>`).
- Repositories are accessed via the `--add-dir <path>` argument.

### 2.2 The Solution for `agy` Worktree Isolation
1. When spawning an `agy` agent in `mode: 'write'` with `worktree: true`:
   - Call `worktree.createWorktree(cwd, id)` just like `claude`. This creates an isolated worktree at `~/.cute-agents-desk/wt/<id>` on branch `agy/<task-or-id>` or `agent/<id>` based off `HEAD`.
   - Pass the isolated worktree directory path to `--add-dir <worktreeDir>` instead of `cwd`.
   - Record `worktreeCwd: worktreeDir` in the agent's manifest and return handle.
2. Benefit:
   - Zero mutation of the user's active checkout.
   - Multiple `agy` agents (or mixed `claude` and `agy` agents) can edit the same repository simultaneously without colliding or overwriting uncommitted work.
   - Retained worktree management and manual reaping in the Configuration tab seamlessly cover `agy` agents.

---

## 3. GitHub CLI (`gh`) Automation & Account Segregation

### 3.1 Account Discovery and Switching
- The system maps filesystem folders to GitHub accounts in `accounts.json` (managed via the Configuration tab and `electron/accounts.js`).
- Every repository scanned by `electron/discovery.js` is mapped to an `accountId` (`gh` login).
- To prevent cross-account pollution (e.g. committing work code with a personal account or vice versa):
  - Execute `gh auth switch -u <accountId> --hostname github.com 2>$null` before invoking GitHub CLI commands.
  - Additionally, extract the account's token via `gh auth token -u <accountId>` and pass it in `process.env.GH_TOKEN` to ensure subprocess commands remain authenticated to the expected account even under concurrent calls.

### 3.2 Git Author & Committer Identification
- To satisfy identity requirements without altering global git config:
  - Query the account's registered name and email from `accounts.json` (or `gh api user`).
  - When committing pending changes in the worktree:
    ```bash
    git -C <worktreeDir> commit -m "<commit-message>" --author="<Name> <<email>>"
    ```
  - Or supply environment variables:
    - `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL`
    - `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL`

### 3.3 Draft PR Creation Contract
Verified flags via `gh pr create --help`:
- `--draft`: Marks the pull request as a draft (never ready-to-merge).
- `--title <title>`: Formatted as `<type>: <task>` (e.g. `feat: <task>` or `fix: <task>`).
- `--body <body-or-report>`: Contains the agent's output summary, token usage, and link to the session log/report.
- `--head <branch>`: The newly pushed task branch (e.g. `claude/<task-slug>` or `agy/<task-slug>`).
- `--base <baseBranch>`: The branch the worktree branched off from (retrieved from `worktree.json` manifest, usually `main` or `master`).

Command pattern:
```bash
gh pr create --draft --title "<title>" --body "<body>" --head "<branch>" --base "<baseBranch>"
```

---

## 4. Delivery Lifecycle & State Integration

1. **Delivery Trigger**:
   - Automated: When a write-mode agent completes successfully (exit code 0 or explicitly finishes turn).
   - Manual: User-triggered "Entregar" action from agent card / diff view.
2. **Delivery Pipeline Execution (`electron/delivery.js`)**:
   - Check if the agent's worktree has uncommitted or unpushed changes.
   - Commit uncommitted changes with the proper author identity.
   - Push branch to remote `origin`.
   - Execute `gh pr create --draft`.
   - Parse PR URL and PR number from `gh pr create` output or JSON.
   - Save delivery entry to persistent store (`~/.cute-agents-desk/deliveries.json` or conversation manifest).
3. **UI Integration**:
   - `getDelivered()` in `ui/data.js` fetches delivered tasks via `window.desk.delivered()`.
   - Renders in `ui/agent-card.js` under the "Entregados" section.
   - Updates `ui/editor.js` status pill to `PR borrador` (#number · account).
