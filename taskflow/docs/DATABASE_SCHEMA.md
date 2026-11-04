# TaskFlow database schema

SQLite, managed only through EF Core migrations (`api/TaskFlow.Api/Migrations`). File: `E:\FormEngine\data\taskflow.db`
(override with `ConnectionStrings__Default`). Timestamps are stored as UTC text; due dates are plain `yyyy-MM-dd` text;
times are `HH:mm:ss` text. Enums are stored as their names.

## Migrations

| # | Migration | What it did |
|---|-----------|-------------|
| 1 | `InitialCreate` | `Tasks`, `Categories` |
| 2 | `CategoryNameNoCase` | case-insensitive unique category names (merges case-duplicates) |
| 3 | `AddSubtasks` | `Subtasks` |
| 4 | `AdvancedFeatures` | new `Tasks` columns; `Tags`, `TaskTags`, `RecurrenceRules`, `Reminders`, `Notifications`, `FocusSessions`, `Activity`, `Attachments`. Data fixes: `Status='Done'` where `IsCompleted=1`, `OccurrenceNumber=1`. |

`MigrationTests` seeds a database at migration 3 with open and completed tasks, upgrades it, and asserts every row and
relationship survives.

## Tables

### Tasks
| Column | Type | Notes |
|--------|------|-------|
| Id | INTEGER PK | |
| Title | TEXT(200) NOT NULL | |
| Description | TEXT(4000) | short summary |
| Notes | TEXT(4000) | long notes |
| IsCompleted | INTEGER | **always** equals `Status = 'Done'` |
| Status | TEXT(12) default `Todo` | `Todo`, `InProgress`, `Done` (Kanban column) |
| Priority | TEXT(10) | `Low`, `Medium`, `High`, `Urgent` |
| StartDate / DueDate | TEXT (date) | |
| DueTime | TEXT (time) | only with a DueDate |
| EstimatedMinutes / ActualMinutes | INTEGER | |
| IsPinned / IsFavorite | INTEGER | |
| SortOrder | INTEGER | position inside its board column |
| CategoryId | FK → Categories | `ON DELETE SET NULL` |
| RecurrenceRuleId | FK → RecurrenceRules | `ON DELETE SET NULL` |
| OccurrenceNumber | INTEGER | 1-based position in the series |
| CreatedAt, UpdatedAt, CompletedAt | TEXT (UTC) | |

Indexes: `IsCompleted`, `DueDate`, `Status`, `UpdatedAt`, `CategoryId`, **unique** `(RecurrenceRuleId, OccurrenceNumber)` where the
rule is not null.

### Categories
`Id`, `Name` (≤50, `NOCASE`, unique), `Color` (`#rrggbb`). Deleting a category keeps its tasks (`CategoryId` becomes NULL).

### Tags / TaskTags
`Tags(Id, Name ≤30 NOCASE unique, Color)`; join `TaskTags(TaskId, TagId)` with a composite primary key, both foreign keys
`ON DELETE CASCADE` — deleting a tag removes only the join rows; deleting a task removes only its join rows.

### Subtasks
`Id`, `TaskId` (FK cascade), `Title`, `IsCompleted`, `SortOrder`, `CreatedAt`, `CompletedAt`. No self-reference, so a subtask
cannot have subtasks and cycles are impossible by construction (one level of nesting).

### RecurrenceRules
`Id`, `Frequency` (`Daily|Weekly|Monthly|Yearly`), `Interval`, `Weekdays` (CSV of 0–6, Sunday = 0), `MonthDays` (CSV of 1–31, `-1` =
last day), `AnchorDate`, `EndDate`, `MaxOccurrences`, `OccurrencesGenerated`, `IsActive`, `CreatedAt`, `StoppedAt`. Completed
occurrences stay as tasks, which is the recurrence history.

### Reminders
`Id`, `TaskId` (FK cascade), `MinutesBefore` (null for an absolute reminder), `RemindAt` (UTC, recomputed when the due date/time
changes), `NotifiedAt`. Index `(NotifiedAt, RemindAt)`.

### Notifications
`Id`, `TaskId` (FK cascade, nullable), `Kind` (`Reminder|Overdue|System`), `Title`, `Message`, `DedupeKey` (**unique**, e.g.
`reminder:12`, `overdue-digest:2026-10-21`), `CreatedAt`, `ReadAt`, `DismissedAt`.

### FocusSessions
`Id`, `TaskId` (FK `SET NULL` — history outlives the task), `Kind` (`Focus|ShortBreak|LongBreak`), `PlannedSeconds`,
`ActualSeconds`, `Completed`, `StartedAt`, `EndedAt`. Index `StartedAt`.

### Activity
`Id`, `TaskId` (FK cascade), `Kind` (Created, Updated, Completed, Reopened, StatusChanged, Rescheduled, Pinned, …), `Detail`, `At`.
Indexes `(TaskId, At)`, `At`.

### Attachments
`Id`, `TaskId` (FK cascade), `FileName` (display only), `StoredName` (generated; file lives in the attachments folder),
`ContentType` (chosen by the server from the extension), `SizeBytes`, `CreatedAt`. The files themselves are **not** in the database or
in snapshots.

## Deletion rules at a glance

| Delete… | Also removes | Keeps |
|---------|--------------|-------|
| a task | its subtasks, reminders, notifications, activity, attachment rows + files, tag links | category, tags, focus sessions (unlinked), earlier occurrences |
| a category | – | tasks (uncategorised) |
| a tag | task↔tag links | tasks |
| the last open occurrence of a series | ends the series (rule → inactive) | completed occurrences |
| completed tasks (bulk clear) | as for tasks | open tasks |
