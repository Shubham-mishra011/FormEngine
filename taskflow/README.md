# TaskFlow

A personal productivity app that runs entirely on your computer: tasks, subtasks, tags, recurring tasks, a calendar, a Kanban board,
a focus timer, reminders, analytics, a dashboard, a command palette, light/dark themes, and a safety net of exports, snapshots and restore.

React + Vite + TypeScript frontend · ASP.NET Core (.NET 10) Web API · Entity Framework Core · SQLite. Single user, no account,
no cloud, no paid services. Lives beside the Form Engine app and does not touch it.

| | |
|---|---|
| UI | http://localhost:5174 |
| API | http://localhost:5062 (localhost only) |
| Database | `E:\FormEngine\data\taskflow.db` |
| Backups | `E:\FormEngine\data\backups\` |
| Attachments | `E:\FormEngine\data\attachments\` |
| Logs (start script) | `E:\FormEngine\data\logs\` |
| Tools, caches, temp | `E:\FormEngine\.tools\` (everything is kept on E:) |

More detail: [User guide](docs/USER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [Database schema](docs/DATABASE_SCHEMA.md) ·
[API reference](docs/API_REFERENCE.md) · [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md) · [Roadmap](ROADMAP.md)

## Features

* **Tasks** – create, edit, duplicate, delete, complete/reopen; description + notes; Low/Medium/High/Urgent; start date, due date and time;
  estimate and time spent; categories and tags; pin and favorite; attachments; activity history; recently-modified sort; bulk select and bulk actions;
  advanced multi-criteria filters and search (title, description, notes, category, tags, subtasks); clear completed with confirmation.
* **Quick add** everywhere (`Q`): natural language such as `Pay rent tomorrow 9am !high #home @Finance every month`.
* **Subtasks** with progress on the parent; completing a parent never destroys unfinished subtasks.
* **Tags** with colours, filter and search by tag, deleting a tag never deletes tasks.
* **Recurring tasks** – daily / weekly (chosen weekdays) / monthly (chosen days, last day) / yearly / custom interval, end date, max count,
  month-end safe, missed occurrences are skipped (never auto-completed), no duplicates, full history, edit or stop at any time.
* **Calendar** – month / week / day, upcoming and overdue, drag-and-drop rescheduling, create from a day, filters.
* **Kanban** – To Do / In Progress / Done, drag-and-drop persisted through the API, priority/due/category/tag indicators, per-column quick add.
* **Dashboard** with customisable widgets · **Analytics** from real timestamps (trends, streaks, distributions, overdue stats).
* **Focus timer** (Pomodoro) tied to tasks, with history and statistics; **reminders and notifications** (in-app + optional browser notifications).
* **Command palette** (`Ctrl+K`), keyboard shortcuts, light / dark / system themes, responsive down to 390 px, reduced-motion support.
* **Data safety** – JSON export (v2, reads v1), CSV export, validated import with preview and duplicate detection, snapshots, transactional restore,
  automatic pre-import / pre-restore snapshots.

## Install (one time)

Everything installs under `E:\FormEngine\.tools`. In every new terminal first run:

```powershell
. E:\FormEngine\env.ps1        # sets .NET, NuGet, npm and temp locations for this session only
cd E:\FormEngine\taskflow\web
npm install                     # packages go to the E: npm cache (see web\.npmrc)
```

The .NET SDK is already at `E:\FormEngine\.tools\dotnet`; NuGet packages restore to `E:\FormEngine\.tools\nuget`.

## Start and stop

```powershell
.\taskflow\scripts\start.ps1              # dev servers: Vite (UI) + API, opens the browser
.\taskflow\scripts\start.ps1 -Preview     # serve the optimised production build instead
.\taskflow\scripts\stop.ps1               # stops both
```

`start.ps1` refuses to start if a port is busy, copies the database aside once per day (`E:\FormEngine\data\backups\startup-<date>-<time>\`),
builds the API, starts both servers hidden with logs in `E:\FormEngine\data\logs`, and waits until they answer. Closing the browser tab does
not stop the servers; `stop.ps1` does. Manual start, if you prefer two terminals:

```powershell
. E:\FormEngine\env.ps1
dotnet run --project taskflow\api\TaskFlow.Api --launch-profile http     # terminal 1
cd taskflow\web; npm run dev                                             # terminal 2
```

## Database and migrations

The API creates and upgrades the database on start (`Database.Migrate()`); every change is an additive EF Core migration. Nothing ever drops
or recreates the database. To add a migration (developers) – **point the design-time tools at a scratch database**, because start-up migrates:

```powershell
. E:\FormEngine\env.ps1
$env:ConnectionStrings__Default = 'Data Source=E:/FormEngine/.tools/tmp/ef-design.db'
cd taskflow\api\TaskFlow.Api
E:\FormEngine\.tools\dotnet-ef\dotnet-ef.exe migrations add <Name>
```

Before a release that includes a migration, take a snapshot (below) – `start.ps1` also copies the files aside.

## Backup and restore

* **Back up**: *Settings → Backup & data → Create backup now* → `E:\FormEngine\data\backups\taskflow-backup-<UTC time>.db`. Names are unique; existing
  backups are never overwritten. For a portable copy use *Download everything (JSON)*.
* **Restore everything**: *Restore…* next to a backup, confirm. All current data is replaced by the backup, atomically, after a
  `taskflow-pre-restore-<time>.db` safety snapshot (restore that one to undo).
* **Merge instead**: *Preview restore* (or import a JSON file) shows what would be added/skipped; nothing existing is touched.
* **Last resort / by hand**: stop the app, then copy a snapshot over `E:\FormEngine\data\taskflow.db` and delete `taskflow.db-wal` and `taskflow.db-shm`.
* Attachments are files in `E:\FormEngine\data\attachments` and are **not** inside snapshots/exports – back that folder up too.

## Testing

```powershell
. E:\FormEngine\env.ps1
dotnet test taskflow\api\TaskFlow.slnx                       # backend (xUnit, real API + throw-away SQLite files)
cd taskflow\web
npm test                                                     # frontend (Vitest + Testing Library)
npx tsc -b                                                   # TypeScript
npm run lint                                                 # oxlint
npm run build                                                # production build
```

Browser tests (Playwright driving Edge, against the real API and UI **on a separate temp database**) live outside the repo in
`E:\FormEngine\.tools\e2e` (`start3.ps1 -Fresh`, then `node run3.mjs phase1`, restart the API, `node run3.mjs phase2`).
Tests never touch `E:\FormEngine\data\taskflow.db`: the backend tests override `ConnectionStrings:Default`, `Backups:Directory` and
`Attachments:Directory` with temp paths.

## Configuration

`api/TaskFlow.Api/appsettings.json`: `ConnectionStrings:Default`, `Backups:Directory`, `Attachments:Directory`, `Cors:Origins`. Override with
environment variables (`ConnectionStrings__Default`, `Backups__Directory`, `Attachments__Directory`).

## Troubleshooting

| Symptom | What to do |
|---------|-----------|
| "Cannot reach the server" banner | The API is not running. `.\taskflow\scripts\start.ps1`, or check `E:\FormEngine\data\logs\api.err.log`. |
| `start.ps1`: "Port 5062/5174 is already in use" | `.\taskflow\scripts\stop.ps1`; if it persists find the owner: `Get-NetTCPConnection -LocalPort 5062 -State Listen`. |
| UI loads but data is empty after an upgrade | Check you are on the right database (*Settings → About* shows the path). Your previous data is untouched in `E:\FormEngine\data`; the day's start-up copy is in `backups\startup-…`. |
| Migration failed on start | The API stops with the error in `api.err.log`; the database is not modified further. Restore the `startup-…` copy or a snapshot and report the log. |
| No reminders / alerts | They only fire while a TaskFlow tab is open. Check *Settings → Reminders*, and that the browser has allowed notifications for localhost. |
| Disk usage on C: | Run `. E:\FormEngine\env.ps1` first in every terminal; it points npm, NuGet, .NET and temp at E:. Windows and VS Code keep their own files on C:. |
| Port conflict with another app | Ports are fixed in `web/vite.config.ts` (5174) and `api/TaskFlow.Api/Properties/launchSettings.json` (5062). |

## Known limitations

* Single user, local only; the API has no authentication and must stay bound to localhost.
* Reminders and the overdue digest only work while a TaskFlow tab is open (browsers cannot run a closed page; a push service would be an external dependency).
* The focus timer is computed from the clock, but browsers may throttle background tabs, so alerts can be late there.
* The browser loads all tasks into memory and filters them locally – ideal for personal use (the API caps imports at 10 000 tasks), not for very large lists.
* "Today", overdue and week boundaries use the computer's local time zone; the browser and API must be on the same machine/zone.
* Attachments are not part of snapshots or JSON exports (only their records are).
* Preferences (theme, formats, widgets, timer lengths) are saved per browser, not in the database.
* Two simultaneous editors of the same task: last save wins (no merge UI).
