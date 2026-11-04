# TaskFlow API reference

Base URL `http://localhost:5062` (the UI proxies `/api` from `http://localhost:5174`). JSON in and out; enums are strings;
dates are `yyyy-MM-dd`, times `HH:mm` or `HH:mm:ss`, timestamps ISO-8601 UTC. Errors are RFC 7807 problem details:
`400` validation (`{"errors":{"Field":["message"]}}`), `404`, `409` duplicate name, `413` file too large.
In development, an OpenAPI document is served at `/openapi/v1.json`.

## Tasks — `/api/tasks`

| Method & path | Purpose |
|---------------|---------|
| `GET /api/tasks` | List. Query: `status` (`all|active|completed|overdue|today|upcoming|inbox`), `q` (space-separated words, all must match title/description/notes/category/tag/subtask; `#tag` = exact tag), `categoryId`, `priority`, `priorities` (CSV), `tagIds` (CSV) + `tagMode` (`any|all`), `pinned`, `favorite`, `board` (`Todo|InProgress|Done`), `dueFrom`, `dueTo`, `hasDue`, `recurring`, `sort` (`created|due|priority|title|updated|manual|status`, `_desc` to reverse), `pinnedFirst`, `limit` (1–5000). **Calendar queries** are `dueFrom`/`dueTo`. |
| `GET /api/tasks/{id}` | One task (with subtasks, tags, recurrence, reminders, attachment count, focus seconds) |
| `GET /api/tasks/stats` | `{total, completed, active, overdue, dueToday, inbox, upcoming, inProgress}` |
| `POST /api/tasks` | Create. Body: `title`*, `description`, `notes`, `priority`, `startDate`, `dueDate`, `dueTime`, `estimatedMinutes`, `actualMinutes`, `categoryId`, `status`/`isCompleted`, `isPinned`, `isFavorite`, `tagIds`, `reminders[{minutesBefore|at}]`, `recurrence{frequency, interval, weekdays, monthDays, endDate, maxOccurrences}` |
| `PUT /api/tasks/{id}` | Full update. **Omitted `isPinned`, `isFavorite`, `status`, `tagIds`, `reminders`, `recurrence` keep their current value**; other fields are replaced. Completing it spawns the next occurrence of a repeating task. |
| `PATCH /api/tasks/{id}/toggle` | Complete ↔ reopen |
| `PATCH /api/tasks/{id}/status` | `{status, position?}` — move between board columns; `position` inserts at an index and renumbers the column |
| `PATCH /api/tasks/{id}/reschedule` | `{dueDate, dueTime?}` — calendar drag-and-drop; follows reminders |
| `PATCH /api/tasks/{id}/flags` | `{isPinned?, isFavorite?}` |
| `POST /api/tasks/{id}/duplicate` | Copy (not completed, not pinned, no recurrence, subtasks unchecked) |
| `POST /api/tasks/{id}/recurrence/stop` | End the series for this task; the task stays |
| `POST /api/tasks/{id}/skip` | Move a repeating task to its next occurrence without completing it (`204` if the series ended) |
| `GET /api/tasks/{id}/occurrences` | The whole series (recurrence history) |
| `GET /api/tasks/{id}/activity` | Task history, newest first |
| `POST /api/tasks/bulk` | `{ids[≤500], action, value?}` with `action` one of `complete reopen delete priority category addTag removeTag pin unpin favorite unfavorite status dueDate`. Atomic. Returns `{affected, missing}`. |
| `DELETE /api/tasks/{id}` | Delete (and its attachment files) |
| `DELETE /api/tasks/completed` | Delete every completed task |
| `GET /api/activity?limit=` | Recent activity across tasks |

## Subtasks
`GET|POST /api/tasks/{taskId}/subtasks`, `PUT|DELETE /api/subtasks/{id}`, `PATCH /api/subtasks/{id}/toggle` (max 100 per task).

## Categories and tags
`GET|POST /api/categories`, `PUT|DELETE /api/categories/{id}` — `{name, color}`.
`GET|POST /api/tags`, `PUT|DELETE /api/tags/{id}` — `{name (no spaces, ≤30), color}`. Names are case-insensitively unique (`409`).

## Attachments
`GET|POST /api/tasks/{taskId}/attachments` (multipart field `file`), `GET /api/attachments/{id}` (download),
`DELETE /api/attachments/{id}`. Allowed: `.csv .doc .docx .gif .jpeg .jpg .json .log .md .pdf .png .ppt .pptx .txt .webp .xls .xlsx .zip`;
max 10 MB, 20 per task.

## Reminders and notifications
| Method & path | Purpose |
|---------------|---------|
| `POST /api/notifications/sync?overdue=true` | Create notifications for due reminders (idempotent) |
| `GET /api/notifications?includeDismissed=false&limit=50` | `{items, unread}` |
| `PATCH /api/notifications/{id}/read?read=true` | Mark read / unread |
| `POST /api/notifications/read-all` | Mark all read |
| `DELETE /api/notifications/{id}` · `DELETE /api/notifications` | Dismiss one / all |
| `GET /api/reminders/upcoming?days=7` | `{upcoming[], overdueTasks[]}` |

## Focus
`POST /api/focus/sessions` (record a finished run), `GET /api/focus/sessions?days=30&limit=100`,
`DELETE /api/focus/sessions/{id}`, `GET /api/focus/stats?days=14` (today/week/total, streaks, daily series, top tasks).

## Analytics
`GET /api/analytics?days=30` (1–365): completed today/week/month, created counts, completion rate, average hours to complete,
current & best streak, `daily`, `weekly` (12 weeks), `monthly` (12 months), `byPriority`, `byCategory`, `overdueDetail`.
All values are computed from stored timestamps; nothing is estimated.

## Data safety
| Method & path | Purpose |
|---------------|---------|
| `GET /api/export` | Full JSON (`schema: taskflow-export`, `version: 2`) |
| `GET /api/export/tasks.csv` | Tasks as CSV (UTF-8 BOM, formula-injection safe) |
| `POST /api/import/preview` | Validate a file and report adds/skips; writes nothing (`400` + summary if invalid) |
| `POST /api/import` | Validate again, take a `pre-import` snapshot, insert in one transaction. Never modifies or removes existing rows. |
| `GET /api/backups` · `POST /api/backups` | List / create a snapshot (header `X-Backup-Directory`) |
| `GET /api/backups/{name}/export` | Read a snapshot as an export document |
| `POST /api/backups/{name}/restore?confirm=true` | **Replace all data** with a snapshot (safety snapshot first; atomic) |
| `GET /api/about` | Version, database/backup/attachment paths, time zone |

Limits: 10 000 tasks, 1 000 categories, 1 000 tags, 100 subtasks per task, 10 reminders per task, 40 MB per import.
