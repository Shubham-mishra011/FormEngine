# TaskFlow roadmap

Reflects the code as it is now (release 1.0.0). "Done" means implemented **and** covered by automated tests; see
[docs/IMPLEMENTATION_PROGRESS.md](docs/IMPLEMENTATION_PROGRESS.md) for the test counts and the browser-test record.

## Delivered

| # | Area | State | Notes |
|---|------|-------|-------|
| 1 | Import / export / backup / restore | Done | JSON export **v2** (reads v1), CSV, validated import with preview and duplicate detection, snapshots (`VACUUM INTO`, never overwritten), transactional **replace-all restore** with automatic safety snapshot, additive "preview restore". |
| 2 | Dark / light / system themes | Done | Tokens in `index.css`; choice persisted; contrast verified in the browser tests. |
| 3 | Productivity analytics | Done | Daily / weekly / monthly trends, streaks, distributions, overdue stats – all from stored timestamps. |
| 4 | Subtasks | Done | One level (no self-reference, so no cycles); progress on the parent; kept on completion, import and export. |
| 5 | Tags | Done | Many per task, colours, filter + search (`#tag`), deleting a tag never deletes tasks. |
| 6 | Calendar | Done | Month / week / day, drag-and-drop + keyboard rescheduling, create-from-day, filters, overdue / upcoming / unscheduled. |
| 7 | Kanban | Done | To Do / In Progress / Done with persisted order (`SortOrder`), drag-and-drop + buttons. `IsCompleted ⇔ Status = Done` is enforced in one place. |
| 8 | Focus timer | Done | Persisted, clock-based; sessions linked to tasks; statistics; honest about background-tab throttling. |
| 9 | Reminders / notifications | Done within browser limits | Reminders fire only while a tab is open (see below). |
| 10 | Recurring tasks | Done | Calculator unit tests + API tests (month-end, leap years, missed occurrences, limits, races, export/import). |
| 11 | Advanced task management | Done | Priority incl. Urgent, start/due date + time, estimates, pin/favorite, duplicate, bulk actions, attachments, activity history, recently-modified sort. |
| 12 | Dashboard, command palette, quick add, settings, responsive shell | Done | Customisable widgets; `Ctrl+K`; natural-language quick add; 390 px layout verified. |

## Not done / deliberately out of scope

* **Reminders while the browser is closed.** Needs an always-on process or a push service. A Windows scheduled task or tray app that polls
  `POST /api/notifications/sync` and raises a toast would be the next step (still local, no paid service).
* **Attachments in backups.** Snapshots and JSON exports carry attachment *records*; the files live in `E:\FormEngine\data\attachments`. A zip bundle export would close this.
* **Server-side paging.** The UI loads all tasks. Fine for personal use; revisit if lists reach tens of thousands (the API already has `limit`, `status`, `q`, `dueFrom/dueTo`).
* **Multi-device sync, accounts, sharing.** Out of scope for a single-user local app.
* **Per-user preferences in the database.** Preferences are browser `localStorage`; moving them server-side would let them survive a browser change.
* **Conflict detection.** Two tabs editing one task: last save wins.
* **Undo for delete.** Deletion is confirmed instead of undoable.

## Ideas worth considering next

1. Windows scheduled-task notifier for closed-browser reminders.
2. ZIP export/import bundle including attachments.
3. Natural-language dates in the task editor's date fields (the quick-add parser already exists in `web/src/quickAdd.ts`).
4. Saved filters / smart lists.
5. Sub-task reordering by drag-and-drop (the `SortOrder` column already exists).

## Engineering rules that remain in force

* Every schema change is an additive EF migration with a "seed an old database, upgrade, assert nothing is lost" test.
* No migration is applied to the real database without a copy on E: first (`start.ps1` does this daily; do it by hand before risky changes).
* Design-time `dotnet ef` commands run against a scratch database.
* Everything – tools, caches, temp, builds, databases, backups – stays on E:.
