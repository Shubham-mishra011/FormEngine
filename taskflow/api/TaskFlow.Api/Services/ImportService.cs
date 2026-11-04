using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

public partial class ImportService(TaskFlowDbContext db, TimeProvider time, AttachmentService attachments)
{
    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorPattern();

    [GeneratedRegex(@"^[0-9a-f]{32}\.[a-z0-9]{1,5}$")]
    private static partial Regex StoredNamePattern();

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        MaxDepth = 16,
    };

    /// <summary>The validated, de-duplicated set of rows an import would insert. Nothing here is tracked by EF yet.</summary>
    public sealed class Plan
    {
        public required ImportSummary Summary { get; init; }
        public List<Category> NewCategories { get; } = [];
        public List<Tag> NewTags { get; } = [];
        public List<TaskItem> NewTasks { get; } = [];
        public List<FocusSession> NewFocus { get; } = [];
    }

    /// <summary>Parses raw JSON text. Returns a plan with Valid=false and readable errors instead of throwing.</summary>
    public async Task<Plan> PlanFromJsonAsync(string json)
    {
        ImportDocument? doc;
        try
        {
            doc = JsonSerializer.Deserialize<ImportDocument>(json, JsonOptions);
        }
        catch (JsonException ex)
        {
            var where = string.IsNullOrEmpty(ex.Path) || ex.Path == "$" ? "" : $" at {ex.Path}";
            return Invalid($"The file is not a valid TaskFlow export{where}: {FirstLine(ex.Message)}");
        }
        return await PlanAsync(doc);
    }

    public async Task<Plan> PlanAsync(ImportDocument? doc)
    {
        var errors = new List<string>();
        var warnings = new List<string>();
        void Err(string m) { if (errors.Count < ExportFormat.MaxErrorsReported) errors.Add(m); else if (errors.Count == ExportFormat.MaxErrorsReported) errors.Add("…and more problems (showing the first " + ExportFormat.MaxErrorsReported + ")."); }

        if (doc is null) return Invalid("The file is empty.");
        if (doc.Schema != ExportFormat.Schema)
            return Invalid($"Not a TaskFlow export: \"schema\" must be \"{ExportFormat.Schema}\".");
        if (doc.Version is null) return Invalid("Missing \"version\".");
        if (doc.Version > ExportFormat.Version)
            return Invalid($"This file is from a newer TaskFlow (export version {doc.Version}); this build reads versions {ExportFormat.MinSupportedVersion} to {ExportFormat.Version}. Update TaskFlow to import it.");
        if (doc.Version < ExportFormat.MinSupportedVersion)
            return Invalid($"Unsupported export version {doc.Version}; this build reads versions {ExportFormat.MinSupportedVersion} to {ExportFormat.Version}.");
        if (doc.Tasks is null) return Invalid("Missing \"tasks\" list.");
        var fileCategories = doc.Categories ?? [];
        var fileTags = doc.Tags ?? [];
        var fileRules = doc.RecurrenceRules ?? [];
        var fileFocus = doc.FocusSessions ?? [];
        if (doc.Tasks.Count > ExportFormat.MaxTasks) return Invalid($"Too many tasks (limit {ExportFormat.MaxTasks}).");
        if (fileCategories.Count > ExportFormat.MaxCategories) return Invalid($"Too many categories (limit {ExportFormat.MaxCategories}).");
        if (fileTags.Count > ExportFormat.MaxTags) return Invalid($"Too many tags (limit {ExportFormat.MaxTags}).");
        if (fileFocus.Count > ExportFormat.MaxFocusSessions) return Invalid($"Too many focus sessions (limit {ExportFormat.MaxFocusSessions}).");
        if (fileRules.Count > ExportFormat.MaxTasks) return Invalid("Too many recurrence rules.");

        var now = time.GetUtcNow().UtcDateTime;
        var newCategories = new List<Category>();
        var newTags = new List<Tag>();
        var newTasks = new List<TaskItem>();

        // ---- categories ----
        var existingCategories = await db.Categories.ToDictionaryAsync(c => c.Name.ToLower(), c => c.Id);
        var newByName = new Dictionary<string, Category>();
        var newByFileId = new Dictionary<int, Category>();
        var existingByFileId = new Dictionary<int, int>();
        var seenFileIds = new HashSet<int>();
        int catAdd = 0, catSkip = 0;

        for (var i = 0; i < fileCategories.Count; i++)
        {
            var c = fileCategories[i];
            var at = $"categories[{i}]";
            if (c is null) { Err($"{at} is empty."); continue; }
            var name = c.Name?.Trim() ?? "";
            if (name.Length == 0) { Err($"{at}.name is required."); continue; }
            if (name.Length > 50) { Err($"{at}.name is longer than 50 characters."); continue; }
            var color = c.Color ?? "#6366f1";
            if (!ColorPattern().IsMatch(color)) { Err($"{at}.color must look like #aabbcc."); continue; }
            if (c.Id is int fid && !seenFileIds.Add(fid)) { Err($"{at}.id {fid} appears more than once."); continue; }

            var key = name.ToLowerInvariant();
            if (existingCategories.TryGetValue(key, out var existingId))
            {
                catSkip++;
                if (c.Id is int f1) existingByFileId[f1] = existingId;
            }
            else if (newByName.TryGetValue(key, out var already))
            {
                catSkip++;
                warnings.Add($"{at}: \"{name}\" appears twice in the file; the first one is used.");
                if (c.Id is int f2) newByFileId[f2] = already;
            }
            else
            {
                var entity = new Category { Name = name, Color = color };
                newByName[key] = entity;
                newCategories.Add(entity);
                catAdd++;
                if (c.Id is int f3) newByFileId[f3] = entity;
            }
        }

        // ---- tags ----
        var existingTags = await db.Tags.ToDictionaryAsync(t => t.Name.ToLower(), t => t.Id);
        var newTagByName = new Dictionary<string, Tag>();
        var newTagByFileId = new Dictionary<int, Tag>();
        var existingTagByFileId = new Dictionary<int, int>();
        var seenTagIds = new HashSet<int>();
        int tagAdd = 0, tagSkip = 0;
        for (var i = 0; i < fileTags.Count; i++)
        {
            var g = fileTags[i];
            var at = $"tags[{i}]";
            if (g is null) { Err($"{at} is empty."); continue; }
            var name = g.Name?.Trim().TrimStart('#').Trim() ?? "";
            if (name.Length == 0) { Err($"{at}.name is required."); continue; }
            if (name.Length > 30) { Err($"{at}.name is longer than 30 characters."); continue; }
            if (name.Any(char.IsWhiteSpace)) { Err($"{at}.name cannot contain spaces."); continue; }
            var color = g.Color ?? "#8b5cf6";
            if (!ColorPattern().IsMatch(color)) { Err($"{at}.color must look like #aabbcc."); continue; }
            if (g.Id is int fid && !seenTagIds.Add(fid)) { Err($"{at}.id {fid} appears more than once."); continue; }

            var key = name.ToLowerInvariant();
            if (existingTags.TryGetValue(key, out var eid))
            {
                tagSkip++;
                if (g.Id is int f1) existingTagByFileId[f1] = eid;
            }
            else if (newTagByName.TryGetValue(key, out var already))
            {
                tagSkip++;
                if (g.Id is int f2) newTagByFileId[f2] = already;
            }
            else
            {
                var entity = new Tag { Name = name, Color = color };
                newTagByName[key] = entity;
                newTags.Add(entity);
                tagAdd++;
                if (g.Id is int f3) newTagByFileId[f3] = entity;
            }
        }

        // ---- recurrence rules (validated now, created only if a new task uses them) ----
        var ruleByFileId = new Dictionary<int, RecurrenceRule>();
        var ruleSeen = new HashSet<int>();
        for (var i = 0; i < fileRules.Count; i++)
        {
            var r = fileRules[i];
            var at = $"recurrenceRules[{i}]";
            if (r is null) { Err($"{at} is empty."); continue; }
            if (r.Id is not int rid) { Err($"{at}.id is required."); continue; }
            if (!ruleSeen.Add(rid)) { Err($"{at}.id {rid} appears more than once."); continue; }
            if (!Enum.TryParse<RecurrenceFrequency>(r.Frequency, true, out var freq) || int.TryParse(r.Frequency, out _) || !Enum.IsDefined(freq))
            { Err($"{at}.frequency must be Daily, Weekly, Monthly or Yearly."); continue; }
            var interval = r.Interval ?? 1;
            if (interval is < 1 or > 99) { Err($"{at}.interval must be between 1 and 99."); continue; }
            if (!TryDate(r.AnchorDate, out var anchor) || anchor is null) { Err($"{at}.anchorDate must be a real date like 2026-12-31."); continue; }
            if (!TryDate(r.EndDate, out var end)) { Err($"{at}.endDate must be a real date like 2026-12-31."); continue; }
            if (r.Weekdays?.Any(d => d is < 0 or > 6) == true) { Err($"{at}.weekdays must be 0–6."); continue; }
            if (r.MonthDays?.Any(d => d != -1 && (d < 1 || d > 31)) == true) { Err($"{at}.monthDays must be 1–31 or -1."); continue; }
            if (r.MaxOccurrences is < 1) { Err($"{at}.maxOccurrences must be at least 1."); continue; }
            ruleByFileId[rid] = new RecurrenceRule
            {
                Frequency = freq, Interval = interval,
                Weekdays = freq == RecurrenceFrequency.Weekly ? RecurrenceCalculator.JoinList(r.Weekdays) : null,
                MonthDays = freq == RecurrenceFrequency.Monthly ? RecurrenceCalculator.JoinList(r.MonthDays) : null,
                AnchorDate = anchor.Value, EndDate = end, MaxOccurrences = r.MaxOccurrences,
                OccurrencesGenerated = Math.Max(1, r.OccurrencesGenerated ?? 1),
                IsActive = r.IsActive ?? true, CreatedAt = now, StoppedAt = (r.IsActive ?? true) ? null : now,
            };
        }

        // ---- tasks ----
        var existingTaskIds = new Dictionary<string, int>();
        foreach (var t in await db.Tasks.Select(t => new { t.Id, t.Title, t.CreatedAt, t.RecurrenceRuleId, t.OccurrenceNumber }).ToListAsync())
            existingTaskIds.TryAdd(TaskKey(t.Title, t.CreatedAt, t.RecurrenceRuleId is null ? 0 : t.OccurrenceNumber), t.Id);
        var knownKeys = existingTaskIds.Keys.ToHashSet();
        var newTaskByFileId = new Dictionary<int, TaskItem>();
        var existingTaskByFileId = new Dictionary<int, int>();
        var occurrenceSeen = new HashSet<(int, int)>();
        int taskAdd = 0, taskSkip = 0, subAdd = 0, subSkip = 0;

        for (var i = 0; i < doc.Tasks.Count; i++)
        {
            var t = doc.Tasks[i];
            var at = $"tasks[{i}]";
            if (t is null) { Err($"{at} is empty."); continue; }
            var subCount = t.Subtasks?.Count ?? 0;
            var ok = true;

            var title = t.Title?.Trim() ?? "";
            if (title.Length == 0) { Err($"{at}.title is required."); ok = false; }
            else if (title.Length > 200) { Err($"{at}.title is longer than 200 characters."); ok = false; }
            if (t.Notes is { Length: > 4000 }) { Err($"{at}.notes is longer than 4000 characters."); ok = false; }
            if (t.Description is { Length: > 4000 }) { Err($"{at}.description is longer than 4000 characters."); ok = false; }

            var priority = Priority.Medium;
            if (t.Priority is not null &&
                (int.TryParse(t.Priority, out _) || !Enum.TryParse(t.Priority, true, out priority) || !Enum.IsDefined(priority)))
            { Err($"{at}.priority must be Low, Medium, High or Urgent."); ok = false; }

            var board = (WorkStatus?)null;
            if (t.Status is not null)
            {
                if (int.TryParse(t.Status, out _) || !Enum.TryParse<WorkStatus>(t.Status, true, out var ws) || !Enum.IsDefined(ws))
                { Err($"{at}.status must be Todo, InProgress or Done."); ok = false; }
                else board = ws;
            }

            DateOnly? due = null;
            if (!string.IsNullOrWhiteSpace(t.DueDate))
            {
                if (DateOnly.TryParseExact(t.DueDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) due = d;
                else { Err($"{at}.dueDate must be a real date like 2026-12-31."); ok = false; }
            }
            DateOnly? start = null;
            if (!string.IsNullOrWhiteSpace(t.StartDate))
            {
                if (DateOnly.TryParseExact(t.StartDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) start = d;
                else { Err($"{at}.startDate must be a real date like 2026-12-31."); ok = false; }
            }
            TimeOnly? dueTime = null;
            if (!string.IsNullOrWhiteSpace(t.DueTime))
            {
                if (TimeOnly.TryParseExact(t.DueTime, ["HH:mm", "HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var tm)) dueTime = tm;
                else { Err($"{at}.dueTime must look like 14:30."); ok = false; }
            }
            if (dueTime is not null && due is null) { warnings.Add($"{at}: dueTime ignored because there is no dueDate."); dueTime = null; }
            if (t.EstimatedMinutes is < 1 or > 100000) { Err($"{at}.estimatedMinutes must be between 1 and 100000."); ok = false; }
            if (t.ActualMinutes is < 0 or > 100000) { Err($"{at}.actualMinutes must be between 0 and 100000."); ok = false; }

            Category? newCat = null;
            int? existingCatId = null;
            if (t.CategoryId is int cid)
            {
                if (newByFileId.TryGetValue(cid, out var nc)) newCat = nc;
                else if (existingByFileId.TryGetValue(cid, out var ec)) existingCatId = ec;
                else { Err($"{at}.categoryId {cid} does not match any category in the file."); ok = false; }
            }

            var taskTagLinks = new List<TaskTag>();
            foreach (var tagRef in (t.TagIds ?? []).Distinct())
            {
                if (newTagByFileId.TryGetValue(tagRef, out var nt)) taskTagLinks.Add(new TaskTag { Tag = nt });
                else if (existingTagByFileId.TryGetValue(tagRef, out var et)) taskTagLinks.Add(new TaskTag { TagId = et });
                else { Err($"{at}.tagIds contains {tagRef}, which is not a tag in the file."); ok = false; }
            }

            RecurrenceRule? rule = null;
            if (t.RecurrenceRuleId is int rref)
            {
                if (!ruleByFileId.TryGetValue(rref, out rule)) { Err($"{at}.recurrenceRuleId {rref} does not match any recurrence rule in the file."); ok = false; }
                else if (!occurrenceSeen.Add((rref, Math.Max(1, t.OccurrenceNumber ?? 1))))
                { Err($"{at}: occurrence {Math.Max(1, t.OccurrenceNumber ?? 1)} of recurrence rule {rref} appears twice."); ok = false; }
            }

            if (subCount > ExportFormat.MaxSubtasksPerTask)
            { Err($"{at} has more than {ExportFormat.MaxSubtasksPerTask} subtasks."); ok = false; }
            var subs = new List<Subtask>();
            if (t.Subtasks is not null && subCount <= ExportFormat.MaxSubtasksPerTask)
            {
                for (var j = 0; j < t.Subtasks.Count; j++)
                {
                    var s = t.Subtasks[j];
                    var sat = $"{at}.subtasks[{j}]";
                    var st = s?.Title?.Trim() ?? "";
                    if (s is null || st.Length == 0) { Err($"{sat}.title is required."); ok = false; continue; }
                    if (st.Length > 200) { Err($"{sat}.title is longer than 200 characters."); ok = false; continue; }
                    var sDone = s.IsCompleted ?? false;
                    var sCreated = Utc(s.CreatedAt) ?? now;
                    subs.Add(new Subtask
                    {
                        Title = st, IsCompleted = sDone, SortOrder = j, CreatedAt = sCreated,
                        CompletedAt = sDone ? Utc(s.CompletedAt) ?? sCreated : null,
                    });
                }
            }

            var reminders = new List<Reminder>();
            if (t.Reminders is not null)
            {
                if (t.Reminders.Count > ExportFormat.MaxRemindersPerTask)
                { Err($"{at} has more than {ExportFormat.MaxRemindersPerTask} reminders."); ok = false; }
                else
                    for (var j = 0; j < t.Reminders.Count; j++)
                    {
                        var r = t.Reminders[j];
                        var rat = $"{at}.reminders[{j}]";
                        if (r?.RemindAt is null) { Err($"{rat}.remindAt is required."); ok = false; continue; }
                        if (r.MinutesBefore is < 0 or > 525600) { Err($"{rat}.minutesBefore must be between 0 and 525600."); ok = false; continue; }
                        var when = Utc(r.RemindAt)!.Value;
                        reminders.Add(new Reminder { MinutesBefore = r.MinutesBefore, RemindAt = when, NotifiedAt = r.Notified == true ? when : null });
                    }
            }

            var files = new List<Attachment>();
            if (t.Attachments is not null)
                for (var j = 0; j < t.Attachments.Count; j++)
                {
                    var a = t.Attachments[j];
                    var aat = $"{at}.attachments[{j}]";
                    if (a is null || string.IsNullOrWhiteSpace(a.FileName)) { Err($"{aat}.fileName is required."); ok = false; continue; }
                    if (a.StoredName is null || !StoredNamePattern().IsMatch(a.StoredName))
                    { Err($"{aat}.storedName is not a valid attachment file name."); ok = false; continue; }
                    if (!attachments.Exists(a.StoredName))
                    { warnings.Add($"{aat}: \"{a.FileName}\" is not on this computer, so the attachment was skipped."); continue; }
                    files.Add(new Attachment
                    {
                        FileName = AttachmentService.CleanName(a.FileName), StoredName = a.StoredName,
                        ContentType = string.IsNullOrWhiteSpace(a.ContentType) ? "application/octet-stream" : a.ContentType[..Math.Min(100, a.ContentType.Length)],
                        SizeBytes = a.SizeBytes ?? 0, CreatedAt = Utc(a.CreatedAt) ?? now,
                    });
                }
            if (!ok) continue;

            var created = Utc(t.CreatedAt) ?? now;
            var key = TaskKey(title, created, rule is null ? 0 : Math.Max(1, t.OccurrenceNumber ?? 1));
            if (!knownKeys.Add(key))
            {
                taskSkip++;
                subSkip += subs.Count;
                if (t.Id is int skippedId && existingTaskIds.TryGetValue(key, out var existingTaskId)) existingTaskByFileId[skippedId] = existingTaskId;
                continue;
            }

            var done = t.IsCompleted ?? (board == WorkStatus.Done);
            if (!done && t.CompletedAt is not null) warnings.Add($"{at}: completedAt ignored because the task is not completed.");
            var updated = Utc(t.UpdatedAt) ?? created;
            var item = new TaskItem
            {
                Title = title,
                Description = string.IsNullOrWhiteSpace(t.Description) ? null : t.Description.Trim(),
                Notes = string.IsNullOrWhiteSpace(t.Notes) ? null : t.Notes.Trim(),
                IsCompleted = done,
                Status = done ? WorkStatus.Done : board == WorkStatus.InProgress ? WorkStatus.InProgress : WorkStatus.Todo,
                Priority = priority,
                StartDate = start, DueDate = due, DueTime = dueTime,
                EstimatedMinutes = t.EstimatedMinutes, ActualMinutes = t.ActualMinutes,
                IsPinned = t.IsPinned ?? false, IsFavorite = t.IsFavorite ?? false, SortOrder = t.SortOrder ?? 0,
                CreatedAt = created,
                UpdatedAt = updated,
                CompletedAt = done ? Utc(t.CompletedAt) ?? updated : null,
                Category = newCat,
                CategoryId = existingCatId,
                Subtasks = subs,
                TaskTags = taskTagLinks,
                Reminders = reminders,
                Attachments = files,
                RecurrenceRule = rule,
                OccurrenceNumber = rule is null ? 1 : Math.Max(1, t.OccurrenceNumber ?? 1),
            };
            item.Activity.Add(new ActivityEntry { Kind = "Imported", At = now, Detail = "Imported from a TaskFlow file." });
            newTasks.Add(item);
            if (t.Id is int fileTaskId) newTaskByFileId[fileTaskId] = item;
            taskAdd++;
            subAdd += subs.Count;
        }

        // ---- focus sessions ----
        var existingFocus = (await db.FocusSessions.Select(f => new { f.Kind, f.StartedAt }).ToListAsync())
            .Select(f => FocusKey(f.Kind.ToString(), f.StartedAt)).ToHashSet();
        var newFocus = new List<FocusSession>();
        int focusAdd = 0, focusSkip = 0;
        for (var i = 0; i < fileFocus.Count; i++)
        {
            var f = fileFocus[i];
            var at = $"focusSessions[{i}]";
            if (f is null) { Err($"{at} is empty."); continue; }
            if (!Enum.TryParse<FocusKind>(f.Kind, true, out var kind) || int.TryParse(f.Kind, out _) || !Enum.IsDefined(kind))
            { Err($"{at}.kind must be Focus, ShortBreak or LongBreak."); continue; }
            if (f.StartedAt is null || f.EndedAt is null) { Err($"{at}.startedAt and endedAt are required."); continue; }
            var started = Utc(f.StartedAt)!.Value;
            var ended = Utc(f.EndedAt)!.Value;
            if (ended < started) { Err($"{at} ends before it starts."); continue; }
            if (f.PlannedSeconds is < 0 or > 86400 || f.ActualSeconds is < 0 or > 86400) { Err($"{at} has an invalid duration."); continue; }
            if (!existingFocus.Add(FocusKey(kind.ToString(), started))) { focusSkip++; continue; }
            var session = new FocusSession
            {
                Kind = kind, PlannedSeconds = f.PlannedSeconds ?? 0, ActualSeconds = f.ActualSeconds ?? 0,
                Completed = f.Completed ?? false, StartedAt = started, EndedAt = ended,
            };
            if (f.TaskId is int ft)
            {
                if (newTaskByFileId.TryGetValue(ft, out var nt)) session.Task = nt;
                else if (existingTaskByFileId.TryGetValue(ft, out var et)) session.TaskId = et;
                else warnings.Add($"{at}: its task is not in the file, so the session was imported without a task.");
            }
            newFocus.Add(session);
            focusAdd++;
        }

        if (errors.Count > 0) return Invalid(errors, warnings);

        var summary = new ImportSummary(true, [], warnings,
            new Tally(catAdd, catSkip), new Tally(taskAdd, taskSkip), new Tally(subAdd, subSkip),
            new Tally(tagAdd, tagSkip), new Tally(focusAdd, focusSkip));
        var result = new Plan { Summary = summary };
        result.NewCategories.AddRange(newCategories);
        result.NewTags.AddRange(newTags);
        result.NewTasks.AddRange(newTasks);
        result.NewFocus.AddRange(newFocus);
        return result;
    }

    /// <summary>Writes the plan in one transaction: either everything is imported or nothing is.</summary>
    public async Task ApplyAsync(Plan plan)
    {
        if (!plan.Summary.Valid) throw new InvalidOperationException("Cannot apply an invalid import plan.");
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        await StageAsync(plan);
        await tx.CommitAsync();
    }

    private async Task StageAsync(Plan plan)
    {
        db.Categories.AddRange(plan.NewCategories);
        db.Tags.AddRange(plan.NewTags);
        db.Tasks.AddRange(plan.NewTasks);
        db.FocusSessions.AddRange(plan.NewFocus);
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Replaces ALL data with the contents of <paramref name="snapshot"/>, atomically: the old rows are deleted and the
    /// snapshot inserted inside one transaction, and if the snapshot does not validate nothing changes at all.
    /// The caller must have taken a safety backup first.
    /// </summary>
    public async Task<(ImportSummary Summary, int Before, int After)> ReplaceAllAsync(ExportDocument snapshot)
    {
        var json = JsonSerializer.Serialize(snapshot, JsonOptions);
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var before = await db.Tasks.CountAsync();

        // Delete in dependency order. Activity, subtasks, reminders, attachments and task-tag links go with their task.
        await db.Notifications.ExecuteDeleteAsync();
        await db.FocusSessions.ExecuteDeleteAsync();
        await db.Tasks.ExecuteDeleteAsync();
        await db.RecurrenceRules.ExecuteDeleteAsync();
        await db.Tags.ExecuteDeleteAsync();
        await db.Categories.ExecuteDeleteAsync();
        db.ChangeTracker.Clear();

        var plan = await PlanFromJsonAsync(json);
        if (!plan.Summary.Valid)
        {
            await tx.RollbackAsync();
            return (plan.Summary, before, before);
        }
        await StageAsync(plan);
        var after = await db.Tasks.CountAsync();
        await tx.CommitAsync();
        return (plan.Summary, before, after);
    }

    /// <summary>Same title and creation instant means same task; occurrences of one series differ by number.</summary>
    private static string TaskKey(string title, DateTime createdUtc, int occurrence) =>
        title.Trim().ToLowerInvariant() + "|" + createdUtc.Ticks + "|" + occurrence;

    private static string FocusKey(string kind, DateTime startedUtc) => kind + "|" + startedUtc.Ticks;

    private static bool TryDate(string? s, out DateOnly? d)
    {
        d = null;
        if (string.IsNullOrWhiteSpace(s)) return true;
        if (!DateOnly.TryParseExact(s, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var v)) return false;
        d = v;
        return true;
    }

    /// <summary>Timestamps in a file are UTC; a value without an offset is taken to be UTC too.</summary>
    private static DateTime? Utc(DateTime? d) =>
        d is not { } v ? null
        : v.Kind == DateTimeKind.Local ? v.ToUniversalTime()
        : DateTime.SpecifyKind(v, DateTimeKind.Utc);

    private static string FirstLine(string s) => s.Split('\n')[0].Trim();

    private static Plan Invalid(string error) => Invalid([error], []);

    private static Plan Invalid(List<string> errors, List<string> warnings) => new()
    {
        Summary = new ImportSummary(false, errors, warnings, new(0, 0), new(0, 0), new(0, 0), new(0, 0), new(0, 0)),
    };
}
