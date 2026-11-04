using System.Globalization;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;

namespace TaskFlow.Api.Services;

public class ExportService(TaskFlowDbContext db, TimeProvider time)
{
    private static string D(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public async Task<ExportDocument> BuildAsync()
    {
        var categories = await db.Categories.OrderBy(c => c.Id)
            .Select(c => new ExportCategory(c.Id, c.Name, c.Color)).ToListAsync();
        var tags = await db.Tags.OrderBy(t => t.Id).Select(t => new ExportTag(t.Id, t.Name, t.Color)).ToListAsync();
        var rules = (await db.RecurrenceRules.OrderBy(r => r.Id).ToListAsync()).Select(r => new ExportRecurrence(
            r.Id, r.Frequency.ToString(), r.Interval, RecurrenceCalculator.ParseList(r.Weekdays),
            RecurrenceCalculator.ParseList(r.MonthDays), D(r.AnchorDate), r.EndDate is { } e ? D(e) : null,
            r.MaxOccurrences, r.OccurrencesGenerated, r.IsActive)).ToList();

        var tasks = await db.Tasks.AsNoTracking().OrderBy(t => t.Id).ToListAsync();
        var subtasks = (await db.Subtasks.AsNoTracking().OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToListAsync()).ToLookup(s => s.TaskId);
        var taskTags = (await db.TaskTags.AsNoTracking().ToListAsync()).ToLookup(x => x.TaskId, x => x.TagId);
        var reminders = (await db.Reminders.AsNoTracking().OrderBy(r => r.Id).ToListAsync()).ToLookup(r => r.TaskId);
        var attachments = (await db.Attachments.AsNoTracking().OrderBy(a => a.Id).ToListAsync()).ToLookup(a => a.TaskId);

        var exported = tasks.Select(t => new ExportTask(
            t.Id, t.Title, t.Notes, t.IsCompleted, t.Priority.ToString(),
            t.DueDate is { } due ? D(due) : null,
            t.CategoryId, t.CreatedAt, t.UpdatedAt, t.CompletedAt,
            subtasks[t.Id].Select(s => new ExportSubtask(s.Title, s.IsCompleted, s.CreatedAt, s.CompletedAt)).ToList(),
            t.Description, t.Status.ToString(), t.StartDate is { } sd ? D(sd) : null,
            t.DueTime?.ToString("HH:mm", CultureInfo.InvariantCulture),
            t.EstimatedMinutes, t.ActualMinutes, t.IsPinned, t.IsFavorite, t.SortOrder,
            taskTags[t.Id].Order().ToList(), t.RecurrenceRuleId, t.OccurrenceNumber,
            reminders[t.Id].Select(r => new ExportReminder(r.MinutesBefore, r.RemindAt, r.NotifiedAt is not null)).ToList(),
            attachments[t.Id].Select(a => new ExportAttachment(a.FileName, a.StoredName, a.ContentType, a.SizeBytes, a.CreatedAt)).ToList()))
            .ToList();

        var focus = (await db.FocusSessions.AsNoTracking().OrderBy(f => f.Id).ToListAsync())
            .Select(f => new ExportFocusSession(f.TaskId, f.Kind.ToString(), f.PlannedSeconds, f.ActualSeconds, f.Completed, f.StartedAt, f.EndedAt))
            .ToList();

        return new ExportDocument(ExportFormat.Schema, ExportFormat.Version, time.GetUtcNow().UtcDateTime,
            categories, exported, tags, rules, focus);
    }

    private static readonly string[] CsvHeader =
    [
        "Id", "Title", "Notes", "Status", "Priority", "DueDate", "Category", "Subtasks", "CreatedAtUtc", "CompletedAtUtc",
        "Description", "Board", "StartDate", "DueTime", "EstimatedMinutes", "ActualMinutes", "Tags", "Pinned", "Favorite", "Repeats",
    ];

    public async Task<string> BuildCsvAsync()
    {
        var names = await db.Categories.ToDictionaryAsync(c => c.Id, c => c.Name);
        var tasks = await db.Tasks.AsNoTracking().Include(t => t.RecurrenceRule).OrderBy(t => t.Id).ToListAsync();
        var subtasks = (await db.Subtasks.ToListAsync()).ToLookup(s => s.TaskId);
        var tagNames = await db.Tags.ToDictionaryAsync(t => t.Id, t => t.Name);
        var taskTags = (await db.TaskTags.ToListAsync()).ToLookup(x => x.TaskId, x => x.TagId);

        var sb = new StringBuilder();
        sb.AppendLine(string.Join(',', CsvHeader));
        foreach (var t in tasks)
        {
            var subs = subtasks[t.Id].ToList();
            var row = new[]
            {
                t.Id.ToString(CultureInfo.InvariantCulture),
                t.Title,
                t.Notes ?? "",
                t.IsCompleted ? "Completed" : "Open",
                t.Priority.ToString(),
                t.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
                t.CategoryId is int id && names.TryGetValue(id, out var n) ? n : "",
                subs.Count == 0 ? "" : $"{subs.Count(s => s.IsCompleted)}/{subs.Count}",
                t.CreatedAt.ToString("o", CultureInfo.InvariantCulture),
                t.CompletedAt?.ToString("o", CultureInfo.InvariantCulture) ?? "",
                t.Description ?? "",
                t.Status.ToString(),
                t.StartDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
                t.DueTime?.ToString("HH:mm", CultureInfo.InvariantCulture) ?? "",
                t.EstimatedMinutes?.ToString(CultureInfo.InvariantCulture) ?? "",
                t.ActualMinutes?.ToString(CultureInfo.InvariantCulture) ?? "",
                string.Join(' ', taskTags[t.Id].Where(tagNames.ContainsKey).Select(x => tagNames[x]).Order()),
                t.IsPinned ? "Yes" : "",
                t.IsFavorite ? "Yes" : "",
                t.RecurrenceRule is { } r ? $"{r.Frequency} every {r.Interval}{(r.IsActive ? "" : " (stopped)")}" : "",
            };
            sb.AppendLine(string.Join(',', row.Select(CsvCell)));
        }
        return sb.ToString();
    }

    /// <summary>RFC 4180 quoting, plus neutralising spreadsheet formulas (CSV injection).</summary>
    public static string CsvCell(string value)
    {
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
            value = "'" + value;
        return value.IndexOfAny([',', '"', '\n', '\r']) >= 0
            ? "\"" + value.Replace("\"", "\"\"") + "\""
            : value;
    }

    // ---------------------------------------------------------------- snapshot reader

    private sealed class Row(Dictionary<string, object?> v)
    {
        public bool Has(string c) => v.ContainsKey(c);
        public object? Raw(string c) => v.TryGetValue(c, out var o) && o is not DBNull ? o : null;
        public string? Str(string c) => Raw(c)?.ToString();
        public int? Int(string c) => Raw(c) is { } o ? Convert.ToInt32(o, CultureInfo.InvariantCulture) : null;
        public long? Long(string c) => Raw(c) is { } o ? Convert.ToInt64(o, CultureInfo.InvariantCulture) : null;
        public bool Bool(string c) => Raw(c) is { } o && Convert.ToInt64(o, CultureInfo.InvariantCulture) != 0;
        public DateTime? Utc(string c) => Str(c) is { } s
            ? DateTime.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal)
            : null;
    }

    private static List<Row> Rows(SqliteConnection conn, string table, string? order = null)
    {
        using var exists = conn.CreateCommand();
        exists.CommandText = "SELECT 1 FROM sqlite_master WHERE type='table' AND name=$n";
        exists.Parameters.AddWithValue("$n", table);
        if (exists.ExecuteScalar() is null) return [];

        using var c = conn.CreateCommand();
        c.CommandText = $"SELECT * FROM \"{table}\"" + (order is null ? "" : $" ORDER BY {order}");
        using var r = c.ExecuteReader();
        var rows = new List<Row>();
        while (r.Read())
        {
            var d = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < r.FieldCount; i++) d[r.GetName(i)] = r.GetValue(i);
            rows.Add(new Row(d));
        }
        return rows;
    }

    /// <summary>
    /// Reads a database snapshot (made by <see cref="BackupService"/>) into the export format without touching
    /// the live database. Reads whatever columns and tables the snapshot has, so snapshots made by older
    /// versions of the app (before subtasks, tags, …) still work.
    /// </summary>
    public static ExportDocument ReadSnapshot(string path, DateTime exportedAtUtc)
    {
        using var conn = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path, Mode = SqliteOpenMode.ReadOnly, Pooling = false,
        }.ToString());
        conn.Open();

        using (var probe = conn.CreateCommand())
        {
            probe.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('Tasks','Categories')";
            if (Convert.ToInt32(probe.ExecuteScalar(), CultureInfo.InvariantCulture) != 2)
                throw new InvalidDataException("This file is not a TaskFlow database backup.");
        }

        var categories = Rows(conn, "Categories", "Id")
            .Select(r => new ExportCategory(r.Int("Id")!.Value, r.Str("Name")!, r.Str("Color")!)).ToList();
        var tags = Rows(conn, "Tags", "Id")
            .Select(r => new ExportTag(r.Int("Id")!.Value, r.Str("Name")!, r.Str("Color")!)).ToList();
        var rules = Rows(conn, "RecurrenceRules", "Id").Select(r => new ExportRecurrence(
            r.Int("Id")!.Value, r.Str("Frequency")!, r.Int("Interval") ?? 1,
            RecurrenceCalculator.ParseList(r.Str("Weekdays")), RecurrenceCalculator.ParseList(r.Str("MonthDays")),
            r.Str("AnchorDate")!, r.Str("EndDate"), r.Int("MaxOccurrences"), r.Int("OccurrencesGenerated") ?? 1,
            r.Bool("IsActive"))).ToList();

        var subtasks = Rows(conn, "Subtasks", "SortOrder, Id").ToLookup(r => r.Int("TaskId")!.Value);
        var taskTags = Rows(conn, "TaskTags").ToLookup(r => r.Int("TaskId")!.Value, r => r.Int("TagId")!.Value);
        var reminders = Rows(conn, "Reminders", "Id").ToLookup(r => r.Int("TaskId")!.Value);
        var attachments = Rows(conn, "Attachments", "Id").ToLookup(r => r.Int("TaskId")!.Value);

        var tasks = Rows(conn, "Tasks", "Id").Select(r =>
        {
            var id = r.Int("Id")!.Value;
            var created = r.Utc("CreatedAt")!.Value;
            return new ExportTask(
                id, r.Str("Title")!, r.Str("Notes"), r.Bool("IsCompleted"), r.Str("Priority") ?? "Medium",
                r.Str("DueDate"), r.Int("CategoryId"), created, r.Utc("UpdatedAt") ?? created, r.Utc("CompletedAt"),
                subtasks[id].Select(s => new ExportSubtask(s.Str("Title")!, s.Bool("IsCompleted"),
                    s.Utc("CreatedAt") ?? created, s.Utc("CompletedAt"))).ToList(),
                r.Str("Description"), r.Str("Status"), r.Str("StartDate"), r.Str("DueTime") is { Length: >= 5 } dt ? dt[..5] : null,
                r.Int("EstimatedMinutes"), r.Int("ActualMinutes"), r.Bool("IsPinned"), r.Bool("IsFavorite"),
                r.Int("SortOrder") ?? 0, taskTags[id].Order().ToList(), r.Int("RecurrenceRuleId"), r.Int("OccurrenceNumber") ?? 1,
                reminders[id].Select(x => new ExportReminder(x.Int("MinutesBefore"), x.Utc("RemindAt")!.Value, x.Raw("NotifiedAt") is not null)).ToList(),
                attachments[id].Select(a => new ExportAttachment(a.Str("FileName")!, a.Str("StoredName")!,
                    a.Str("ContentType") ?? "application/octet-stream", a.Long("SizeBytes") ?? 0, a.Utc("CreatedAt") ?? created)).ToList());
        }).ToList();

        var focus = Rows(conn, "FocusSessions", "Id").Select(f => new ExportFocusSession(
            f.Int("TaskId"), f.Str("Kind") ?? "Focus", f.Int("PlannedSeconds") ?? 0, f.Int("ActualSeconds") ?? 0,
            f.Bool("Completed"), f.Utc("StartedAt")!.Value, f.Utc("EndedAt")!.Value)).ToList();

        return new ExportDocument(ExportFormat.Schema, ExportFormat.Version, exportedAtUtc, categories, tasks, tags, rules, focus);
    }
}
