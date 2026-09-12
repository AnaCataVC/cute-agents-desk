# Learnings: Scheduled Tasks Execution, Skills Authoring & Dialog Decoupling

## 1. Background Execution of Scheduled Tasks

### Problem & Challenges
Enabling automated recurring tasks (daily/weekly health checks, dependency audits) introduced risks:
1. **Unattended Execution over Dirty Checkouts:** If a user is actively writing code in a repository, spawning a scheduled agent could overwrite uncommitted changes or trigger Git lock collisions (`index.lock`).
2. **Process Starvation:** Background scheduled tasks firing simultaneously could saturate the global `maxParallel` cap, blocking manual user tasks.

### Resolution & Architectural Invariant
- **Worktree Invariant:** All scheduled tasks MUST execute within isolated ephemeral Git worktrees, never on the base checkout.
- **Graceful Concurrency Queuing:** When `scheduler.runningCount >= scheduler.globalCap`, scheduled runs are queued into the FIFO queue without starving interactive user-dispatched tasks.
- **Ad-Hoc Triggering:** The `desk:runScheduledTaskNow` channel allows developers to test cron tasks immediately without altering the cron expression.

---

## 2. Dynamic Skills Authoring & YAML Frontmatter Preservation

### Problem
Directly editing `SKILL.md` documents via an Electron desktop dialog can corrupt YAML frontmatter delimiters (`---`), lose indentation, or drop custom metadata fields (`allowed-tools`, `model-preferences`).

### Resolution & Implementation Pattern
- In `electron/skills.js`, reading splits frontmatter from Markdown body using strict boundary matching:
  ```javascript
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  ```
- Before writing updates via `saveSkill(id, newContent)`:
  1. Frontmatter syntax is verified for structural integrity.
  2. The target folder and filename are validated against path traversal (`..` or path separators).
  3. Writes are committed atomically.

---

## 3. Modal Dialog Decoupling in UI (`ui/dialogs.js`)

### Problem
Previously, specialized modals (such as skill editors, scheduled task configurations, and account color pickers) injected fragmented DOM containers or created global variable collisions in `ui/app.js`.

### Resolution
- Centralized modal rendering and teardown in `ui/dialogs.js`.
- Dialogs subscribe cleanly to the event delegation pipeline using standard action attributes (`data-act="..."`).
- Modal backdrop dismissals cleanly unbind keyboard listeners (`Escape` key), preventing event handler leakage across views.
