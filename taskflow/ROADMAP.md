# TaskFlow roadmap

Written against the code as of the stabilisation sprint (API: 49 tests, web: 24 tests, 28 browser checks).
"Compatible" means: existing endpoints keep their shape, existing rows stay valid, and the change ships
as an additive EF migration (new tables, or new nullable / defaulted columns).

Current schema: `Tasks` (Id, Title, Notes, IsCompleted, Priority, DueDate, CategoryId, CreatedAt, UpdatedAt,
CompletedAt) and `Categories` (Id, Name NOCASE-unique, Color). Task DTOs are records; adding fields is
backwards compatible for the current client, which ignores unknown properties.

## Priority order

| # | Feature | Why here | Schema change | API compatible? | Size |
|---|---------|----------|---------------|-----------------|------|
| 1 | **Import / export & backup** | A safety net before any schema work. Also the only protection against losing `taskflow.db`. | None | Yes. New endpoints only: `GET /api/export` (JSON), `POST /api/import` (validate, then insert in one transaction), `POST /api/backup` (`VACUUM INTO` a timestamped file under `E:\FormEngine\data\backups`). | S |
| 2 | **Dark / light theme toggle** | Colours are already CSS variables and dark mode already follows the OS. Add a `data-theme` override persisted in `localStorage`. | None | Frontend only | S |
| 3 | **Productivity analytics** | `CreatedAt` and `CompletedAt` already exist, so completed-per-day, average time-to-complete and overdue trends need no new data. | None | Yes. New read-only `GET /api/stats/daily?from&to`. | M |
| 4 | **Subtasks** | The most requested to-do feature. Self-contained. | New `Subtasks` table (Id, TaskId FK cascade, Title, IsCompleted, SortOrder) | Yes. Add optional `subtaskTotal` / `subtaskDone` to `TaskDto`; subtask CRUD under `/api/tasks/{id}/subtasks`. Decide: completing the last subtask does not auto-complete the task (explicit beats surprising). | M |
| 5 | **Tags / labels** | Orthogonal to categories (many per task). | New `Tags` and `TaskTags` join table; tag names NOCASE-unique | Yes. Add `tags` to `TaskDto`; new `tagId` list filter; `TaskInput.tagIds` optional. | M |
| 6 | **Calendar view** | Pure presentation over `DueDate`. | None | Yes if `GET /api/tasks` gains optional `dueFrom` / `dueTo` filters (additive). | M |
| 7 | **Kanban with drag-and-drop** | Needs a notion of ordering and a third state. | `Tasks.SortOrder` (int, default 0) and optionally `Status` (Todo/Doing/Done) mapped so `IsCompleted == (Status == Done)` | Mostly. Keep `isCompleted` as the source of truth for existing clients; add `status` and `sortOrder`. The toggle endpoint must keep both consistent. Use pointer events or `@dnd-kit` (new dependency), and make it keyboard-accessible. | L |
| 8 | **Focus timer** | Client-side timer is trivial; value comes from linking sessions to tasks. | Optional `FocusSessions` (TaskId?, StartedAt, Seconds) | Yes | M |
| 9 | **Local reminders** | Needs a browser permission flow and only works while a tab is open unless a service worker is added. | `Tasks.ReminderAt` nullable | Yes | M |
| 10 | **Recurring tasks** | Highest semantic risk: what does "complete" mean, what about time zones and missed occurrences, and where does the next instance's `CreatedAt` come from? | `Tasks.RecurrenceRule` nullable (e.g. `daily`, `weekly:mon,wed`, `monthly:15`) and `RecurrenceParentId` nullable | Yes, but `PATCH .../toggle` gains a side effect (spawns the next instance). Needs a design decision and its own tests first. | L |

## Notes on sequencing
- Do 1 before 4, 5, 7, 9 or 10, since each of those migrates existing data.
- 4 and 5 share the pattern "child rows loaded with the task list"; add `Include` or a projection once and reuse it. The list endpoint currently sorts in memory, which is fine for a personal list but should be revisited if tasks reach the tens of thousands.
- 3, 6 and 8 reuse the same date helpers; keep `dates.ts` the single place that interprets due dates as plain calendar dates, not instants.
- Every migration should ship with a "migrate a seeded old-schema database" test, like `Migrating_an_existing_database_preserves_data_and_resolves_case_duplicates`.

## Known limitations of the current foundation
- Single user, no authentication. The API is meant to bind to localhost only; do not expose it publicly as is.
- "Today" and "overdue" use the API host's local clock. The browser and the API must be on the same machine or time zone.
- The connection string in `appsettings.json` is an absolute `E:/FormEngine/data/taskflow.db` path (deliberate, for the E: requirement). Override with `ConnectionStrings__Default`.
- There is no undo for delete; single-task delete is two-step instead.
