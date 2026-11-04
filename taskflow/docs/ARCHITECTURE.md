# TaskFlow architecture

TaskFlow is a single-user, local-only productivity app: a React single-page UI, an ASP.NET Core Web API and a SQLite
database. Nothing leaves the machine, there is no account system and no cloud service.

```
Browser (React, Vite)  ──/api──▶  ASP.NET Core API (localhost:5062)  ──EF Core──▶  SQLite
  localStorage: theme, settings,                    │                                E:\FormEngine\data\taskflow.db
  focus-timer state                                 ├─ attachments  E:\FormEngine\data\attachments\
                                                    └─ backups      E:\FormEngine\data\backups\
```

Everything is bound to `localhost` (API `http://localhost:5062`, UI `http://localhost:5174`). The API has no
authentication because it is not meant to be reachable from anywhere but the same computer.

## Backend layers

`Controllers → Services → Data access (EF Core DbContext) → SQLite`

| Layer | Folder | Responsibility |
|-------|--------|----------------|
| Controllers | `Controllers/` | Translate HTTP to a service call and back. Model binding + DTO validation attributes. **No business rules.** |
| Services | `Services/` | All rules: `TaskService` (queries, create/update, completion/board state, reschedule, duplicate, bulk, activity), `RecurrenceService` + `RecurrenceCalculator` (pure date maths), `TagService`, `NotificationService`, `FocusService`, `AttachmentService`, `ExportService`, `ImportService`, `BackupService`. |
| Data access | `Data/TaskFlowDbContext.cs`, `Models/`, `Migrations/` | EF Core's `DbContext` is the unit of work and its `DbSet`s are the repositories. A hand-written repository layer on top would only re-wrap `IQueryable`, so it was deliberately not added. |
| DTOs | `Dtos/` | Wire contracts. Entities are never serialised directly. |

Cross-cutting decisions:

* **Consistent errors.** Services throw `ApiException(status, message, field?)`; `ApiExceptionHandler` turns it into RFC 7807
  `ProblemDetails` (`400` with an `errors` dictionary for validation, `404`, `409`, `413`). Unexpected exceptions become a
  generic `500` and are logged, never leaked.
* **Time.** Everything uses an injected `TimeProvider`, so tests control "now" and the time zone. Timestamps are stored and
  returned in UTC; "today", due dates and weeks are calendar dates in the server's local zone.
* **Concurrency.** SQLite allows one writer. Multi-step writes run in `IsolationLevel.Serializable` transactions, which the
  SQLite provider maps to `BEGIN IMMEDIATE`, so concurrent requests queue instead of failing with `SQLITE_BUSY`. A unique index
  on `(RecurrenceRuleId, OccurrenceNumber)` is the last line of defence against a duplicate occurrence.
* **Migrations.** Applied automatically at start-up (`Database.Migrate()`); every schema change is an additive EF migration.
  `start.ps1` copies the database aside before the first start of each day.
* **Validation.** DTO attributes (`[Required]`, `[Range]`, `[StringLength]`) plus service checks that need the database
  (category/tag exists, start ≤ due, reminders need a due date, recurrence rules are sane, bulk values are valid).
* **SQL injection.** All access is through EF Core (parameterised); the only raw SQL is `VACUUM INTO $path` with a bound parameter
  and the read-only snapshot reader (table/column names are constants). `LIKE` patterns escape `% _ \`.
* **Uploads.** Extension allow-list, 10 MB / 20 per task, generated storage names (the user's file name is display-only and
  stripped of path parts), always served as a download with `X-Content-Type-Options: nosniff`.

### Task state model

`IsCompleted` and the board column `Status` (`Todo | InProgress | Done`) are two views of one fact: a task is completed exactly
when its status is `Done`. `TaskService.Transition` is the single place that changes either, so the checkbox, the Kanban board,
PUT, bulk actions and recurrence all agree. Completing a task stamps `CompletedAt`; reopening clears it.

### Recurrence

A `RecurrenceRule` holds the schedule shared by a series; each occurrence is an ordinary task pointing at the rule with an
`OccurrenceNumber`. Completing occurrence *N* (by any path) calls `RecurrenceService.SpawnNextAsync`, which

1. does nothing if the rule is stopped or occurrence *N+1* already exists (reopen → complete again never duplicates),
2. asks `RecurrenceCalculator.NextAfter(rule, dueDate, today)` for the next scheduled date — measured from the rule's
   **anchor date**, not from the previous occurrence, so "the 31st" does not drift to the 28th,
3. skips missed dates instead of queueing them (the next date is never before today) and never completes anything on the
   user's behalf,
4. honours `EndDate` and `MaxOccurrences` (the series ends and the rule is marked inactive),
5. copies title, notes, priority, category, tags, estimate, pinned/favorite, **unchecked** subtasks and relative reminders.

History is simply the earlier tasks in the series (`GET /api/tasks/{id}/occurrences`).

### Reminders and notifications

There is no background service. The open web page calls `POST /api/notifications/sync` every 30 s (paused while the tab is
hidden). The server turns due, un-notified reminders into `Notifications` rows (deduplicated by a unique key), plus one
"N tasks are overdue" digest per day and a per-task alert for timed tasks that passed their time today. **If TaskFlow is not
open in a browser tab, nothing can alert you** — that is a browser limitation, and a service worker was deliberately not added
because it still cannot wake a closed browser without a push service (which would need an external paid/cloud dependency).

### Backups

* **Snapshot** (`POST /api/backups`): `VACUUM INTO` a unique file `taskflow-backup-<UTC>.db`; never overwrites.
* **Export** (`GET /api/export`): JSON, schema `taskflow-export`, **version 2** (still reads version 1). CSV export is read-only.
* **Import**: preview (no writes) then apply; additive, de-duplicating, validated as a whole, one transaction, preceded by a
  `pre-import` snapshot.
* **Restore** (`POST /api/backups/{name}/restore?confirm=true`): reads the snapshot with a schema-tolerant reader (works for
  snapshots from older versions), takes a `pre-restore` snapshot, then — in one `Serializable` transaction — deletes all data and
  inserts the snapshot through the same validator. If anything is invalid the transaction rolls back and nothing changes.

## Frontend

React 19 + TypeScript + Vite, no UI or state library, no router library (hash routes), no new runtime dependencies.

| Concern | Where |
|---------|-------|
| Providers | `App.tsx` → `Providers`: Toast, Settings, TaskFlow store, Focus, TaskEditor |
| Store | `useTaskFlow.tsx`: loads **all** tasks, categories, tags and stats once, mutates through the API, then reloads. Optimistic updates (toggle, board move, reschedule, pin) roll back on error; a ticket counter discards out-of-order responses. |
| Filtering/sorting/search | `taskFilters.ts`, client-side over the loaded tasks, mirroring the server's rules, so every view is instant and consistent. (The server supports the same filters for other clients.) |
| Settings | `useSettings.tsx` → `localStorage` (`taskflow-settings`); theme in `useTheme.ts` (`taskflow-theme`); timer in `focus/` (`taskflow-focus`). |
| Pages | `pages/` — Dashboard, Tasks (My Tasks/Inbox/Today/Upcoming/Completed), Calendar, Kanban, Categories/Tags (`ManagePage`), Analytics, Focus, Settings (+ Backup & data). |
| Shared UI | `components/` — `Modal`/`ConfirmDialog`, `TaskEditor`, `TaskRow`, `QuickAdd`, `CommandPalette`, `NotificationBell`, `SideNav`, `Feedback` (empty states, skeletons). |
| Styling | `index.css` holds the design tokens (light/dark/system), shell and shared components; each page imports its own CSS. |

Trade-off worth knowing: loading every task into the browser is simple and fast for a personal list (the API caps an
import at 10 000 tasks and the list endpoint returns them in one response). If you routinely keep tens of thousands of tasks, the
store should move to server-side paging; the API already supports `status`, `q`, `tagIds`, `dueFrom`/`dueTo`, `limit`.

## Testing

| Layer | Tooling | Location |
|-------|---------|----------|
| Backend | xUnit + `WebApplicationFactory` against a throw-away SQLite file with a controllable clock | `api/TaskFlow.Tests` |
| Frontend | Vitest + Testing Library against an in-memory fake of the HTTP API | `web/src/*.test.ts(x)`, `web/src/testing/` |
| Browser | Playwright (`playwright-core` driving Edge) against the real API and UI on a **separate temp database** | `E:\FormEngine\.tools\e2e` (outside the repo) |
