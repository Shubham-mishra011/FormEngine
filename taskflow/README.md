# TaskFlow

Personal to-do app: React + Vite frontend, ASP.NET Core (.NET 10) Web API, EF Core + SQLite.
Lives beside the existing FORM ENGINE app and does not touch it.

```
taskflow/
  api/TaskFlow.Api     ASP.NET Core Web API (controllers, EF Core, migrations)
  api/TaskFlow.Tests   xunit integration tests (real API + throwaway SQLite file)
  web/                 React + Vite + TypeScript UI, vitest tests
E:\FormEngine\data\taskflow.db   the database (created and migrated on API start)
```

## Everything stays on E:
In every new terminal, first run `. E:\FormEngine\env.ps1`. It sets, for that session only,
the .NET SDK, NuGet, npm and temp locations under `E:\FormEngine\.tools`.

## Run
```powershell
. E:\FormEngine\env.ps1
# terminal 1 - API on http://localhost:5062
dotnet run --project taskflow\api\TaskFlow.Api --launch-profile http
# terminal 2 - UI on http://localhost:5174 (proxies /api to the API)
cd taskflow\web; npm run dev
```

## Test
```powershell
dotnet test taskflow\api\TaskFlow.slnx
cd taskflow\web; npm test; npm run build
```

## API
`GET/POST /api/tasks`, `GET/PUT/DELETE /api/tasks/{id}`, `PATCH /api/tasks/{id}/toggle`,
`DELETE /api/tasks/completed`, `GET /api/tasks/stats`, `GET/POST /api/categories`,
`PUT/DELETE /api/categories/{id}`.
Task list query: `status` (all|active|completed|overdue|today), `q`, `categoryId`, `priority`,
`sort` (created_desc|due|priority|title, `_desc` suffix reverses).
