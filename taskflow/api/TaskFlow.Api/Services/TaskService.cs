using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

public class TaskQueryParams
{
    /// <summary>all | active | completed | overdue | today | upcoming | inbox</summary>
    public string? Status { get; set; }
    /// <summary>Space-separated terms, all of which must match title, description, notes, category, tags or
    /// subtasks. A term starting with # must equal a tag name.</summary>
    public string? Q { get; set; }
    public int? CategoryId { get; set; }
    public Priority? Priority { get; set; }
    /// <summary>Comma-separated priorities (any of).</summary>
    public string? Priorities { get; set; }
    /// <summary>Comma-separated tag ids.</summary>
    public string? TagIds { get; set; }
    /// <summary>any (default) or all.</summary>
    public string? TagMode { get; set; }
    public bool? Pinned { get; set; }
    public bool? Favorite { get; set; }
    public WorkStatus? Board { get; set; }
    public DateOnly? DueFrom { get; set; }
    public DateOnly? DueTo { get; set; }
    public bool? HasDue { get; set; }
    public bool? Recurring { get; set; }
    /// <summary>created | due | priority | title | updated | manual | status; append _desc to reverse.</summary>
    public string? Sort { get; set; }
    public bool PinnedFirst { get; set; }
    public int? Limit { get; set; }
}

/// <summary>All task business rules. Controllers only translate HTTP to calls on this class.</summary>
public class TaskService(
    TaskFlowDbContext db, TimeProvider time, RecurrenceService recurrence, AttachmentService attachments)
{
    private const string LikeEscape = "\\";
    public const int MaxReminders = 10;
    public const int MaxTags = 20;

    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private DateOnly Today => DateOnly.FromDateTime(time.GetLocalNow().DateTime);
    private DateTime Now => time.GetUtcNow().UtcDateTime;

    private IQueryable<TaskItem> WithAll() => db.Tasks
        .Include(t => t.Category).Include(t => t.Subtasks)
        .Include(t => t.TaskTags).ThenInclude(x => x.Tag)
        .Include(t => t.RecurrenceRule).Include(t => t.Reminders).Include(t => t.Attachments)
        .AsSplitQuery();

    private async Task<Dictionary<int, int>> FocusSecondsAsync(IReadOnlyCollection<int>? ids = null)
    {
        var q = db.FocusSessions.Where(f => f.Kind == FocusKind.Focus && f.TaskId != null);
        if (ids is not null) q = q.Where(f => ids.Contains(f.TaskId!.Value));
        return await q.GroupBy(f => f.TaskId!.Value).Select(g => new { g.Key, S = g.Sum(f => f.ActualSeconds) })
            .ToDictionaryAsync(x => x.Key, x => x.S);
    }

    private async Task<TaskDto> DtoAsync(TaskItem t)
    {
        var focus = await FocusSecondsAsync([t.Id]);
        return TaskMapper.ToDto(t, Today, focus.GetValueOrDefault(t.Id));
    }

    // ---------------------------------------------------------------- queries

    public async Task<List<TaskDto>> ListAsync(TaskQueryParams p)
    {
        var today = Today;
        var query = WithAll();

        switch ((p.Status ?? "all").ToLowerInvariant())
        {
            case "all": break;
            case "active": query = query.Where(t => !t.IsCompleted); break;
            case "completed": query = query.Where(t => t.IsCompleted); break;
            case "overdue": query = query.Where(t => !t.IsCompleted && t.DueDate < today); break;
            case "today": query = query.Where(t => !t.IsCompleted && t.DueDate == today); break;
            case "upcoming": query = query.Where(t => !t.IsCompleted && t.DueDate > today); break;
            case "inbox": query = query.Where(t => !t.IsCompleted && t.CategoryId == null && t.DueDate == null); break;
            default: throw ApiException.Invalid("Status", "Unknown status filter.");
        }

        foreach (var term in (p.Q ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(8))
        {
            if (term.Length > 1 && term[0] == '#')
            {
                var tag = term[1..];
                query = query.Where(t => t.TaskTags.Any(x => x.Tag!.Name == tag));
                continue;
            }
            var pattern = $"%{EscapeLike(term)}%";
            query = query.Where(t =>
                EF.Functions.Like(t.Title, pattern, LikeEscape) ||
                (t.Description != null && EF.Functions.Like(t.Description, pattern, LikeEscape)) ||
                (t.Notes != null && EF.Functions.Like(t.Notes, pattern, LikeEscape)) ||
                (t.Category != null && EF.Functions.Like(t.Category.Name, pattern, LikeEscape)) ||
                t.TaskTags.Any(x => EF.Functions.Like(x.Tag!.Name, pattern, LikeEscape)) ||
                t.Subtasks.Any(s => EF.Functions.Like(s.Title, pattern, LikeEscape)));
        }

        if (p.CategoryId is not null) query = query.Where(t => t.CategoryId == p.CategoryId);
        if (p.Priority is not null) query = query.Where(t => t.Priority == p.Priority);
        if (!string.IsNullOrWhiteSpace(p.Priorities))
        {
            var set = new List<Priority>();
            foreach (var s in p.Priorities.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (!Enum.TryParse<Priority>(s, true, out var pr) || !Enum.IsDefined(pr))
                    throw ApiException.Invalid("Priorities", $"Unknown priority \"{s}\".");
                set.Add(pr);
            }
            query = query.Where(t => set.Contains(t.Priority));
        }
        var tagIds = ParseIds(p.TagIds, "TagIds");
        if (tagIds.Count > 0)
        {
            if (string.Equals(p.TagMode, "all", StringComparison.OrdinalIgnoreCase))
                foreach (var id in tagIds) { var tid = id; query = query.Where(t => t.TaskTags.Any(x => x.TagId == tid)); }
            else
                query = query.Where(t => t.TaskTags.Any(x => tagIds.Contains(x.TagId)));
        }
        if (p.Pinned is not null) query = query.Where(t => t.IsPinned == p.Pinned);
        if (p.Favorite is not null) query = query.Where(t => t.IsFavorite == p.Favorite);
        if (p.Board is not null) query = query.Where(t => t.Status == p.Board);
        if (p.DueFrom is not null) query = query.Where(t => t.DueDate >= p.DueFrom);
        if (p.DueTo is not null) query = query.Where(t => t.DueDate <= p.DueTo);
        if (p.HasDue is not null) query = query.Where(t => (t.DueDate != null) == p.HasDue);
        if (p.Recurring is not null) query = query.Where(t => (t.RecurrenceRuleId != null) == p.Recurring);

        var s2 = (p.Sort ?? "created_desc").ToLowerInvariant();
        var desc = s2.EndsWith("_desc");
        var key = desc ? s2[..^5] : s2;
        if (key is not ("created" or "due" or "priority" or "title" or "updated" or "manual" or "status"))
            throw ApiException.Invalid("Sort", "Unknown sort key.");
        if (p.Limit is < 1 or > 5000) throw ApiException.Invalid("Limit", "limit must be between 1 and 5000.");

        // A personal task list is small; sorting in memory gives predictable semantics for nullable dates
        // and enum priority without depending on SQLite collation/type quirks. Filtering stays in SQL.
        var items = await query.ToListAsync();
        IEnumerable<TaskItem> src = p.PinnedFirst ? items.OrderByDescending(t => t.IsPinned) : items.OrderBy(_ => 0);
        var ordered = (IOrderedEnumerable<TaskItem>)src;
        ordered = key switch
        {
            "due" => desc
                ? ordered.ThenByDescending(t => t.DueDate ?? DateOnly.MinValue).ThenByDescending(t => t.DueTime ?? TimeOnly.MinValue)
                : ordered.ThenBy(t => t.DueDate ?? DateOnly.MaxValue).ThenBy(t => t.DueTime ?? TimeOnly.MaxValue),
            "priority" => desc ? ordered.ThenBy(t => t.Priority) : ordered.ThenByDescending(t => t.Priority),
            "title" => desc
                ? ordered.ThenByDescending(t => t.Title, StringComparer.OrdinalIgnoreCase)
                : ordered.ThenBy(t => t.Title, StringComparer.OrdinalIgnoreCase),
            "updated" => desc ? ordered.ThenByDescending(t => t.UpdatedAt) : ordered.ThenBy(t => t.UpdatedAt),
            "manual" => desc ? ordered.ThenByDescending(t => t.SortOrder) : ordered.ThenBy(t => t.SortOrder),
            "status" => desc ? ordered.ThenByDescending(t => t.Status) : ordered.ThenBy(t => t.Status),
            _ => desc ? ordered.ThenByDescending(t => t.CreatedAt) : ordered.ThenBy(t => t.CreatedAt),
        };
        var result = ordered.ThenBy(t => t.Id).AsEnumerable();
        if (p.Limit is int limit) result = result.Take(limit);
        var page = result.ToList();
        var focus = await FocusSecondsAsync();
        return page.Select(t => TaskMapper.ToDto(t, today, focus.GetValueOrDefault(t.Id))).ToList();
    }

    private static List<int> ParseIds(string? csv, string field)
    {
        var ids = new List<int>();
        foreach (var s in (csv ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!int.TryParse(s, out var id)) throw ApiException.Invalid(field, $"\"{s}\" is not a valid id.");
            ids.Add(id);
        }
        return ids;
    }

    public async Task<TaskDto> GetAsync(int id)
    {
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        return await DtoAsync(t);
    }

    public async Task<StatsDto> StatsAsync()
    {
        var today = Today;
        var total = await db.Tasks.CountAsync();
        var completed = await db.Tasks.CountAsync(t => t.IsCompleted);
        var overdue = await db.Tasks.CountAsync(t => !t.IsCompleted && t.DueDate < today);
        var dueToday = await db.Tasks.CountAsync(t => !t.IsCompleted && t.DueDate == today);
        var upcoming = await db.Tasks.CountAsync(t => !t.IsCompleted && t.DueDate > today);
        var inbox = await db.Tasks.CountAsync(t => !t.IsCompleted && t.CategoryId == null && t.DueDate == null);
        var inProgress = await db.Tasks.CountAsync(t => t.Status == WorkStatus.InProgress);
        return new StatsDto(total, completed, total - completed, overdue, dueToday, inbox, upcoming, inProgress);
    }

    public async Task<List<ActivityDto>> ActivityAsync(int? taskId, int limit)
    {
        limit = Math.Clamp(limit, 1, 500);
        if (taskId is int id && !await db.Tasks.AnyAsync(t => t.Id == id)) throw ApiException.NotFound();
        var q = db.Activity.AsQueryable();
        if (taskId is not null) q = q.Where(a => a.TaskId == taskId);
        return await q.OrderByDescending(a => a.At).ThenByDescending(a => a.Id).Take(limit)
            .Select(a => new ActivityDto(a.Id, a.TaskId, a.Task!.Title, a.Kind, a.Detail, a.At)).ToListAsync();
    }

    public async Task<List<TaskDto>> OccurrencesAsync(int id)
    {
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        if (t.RecurrenceRuleId is not int rid) return [await GetAsync(id)];
        var ids = await db.Tasks.Where(x => x.RecurrenceRuleId == rid).OrderBy(x => x.OccurrenceNumber).Select(x => x.Id).ToListAsync();
        var items = await WithAll().Where(x => x.RecurrenceRuleId == rid).ToListAsync();
        var today = Today;
        return items.OrderBy(x => x.OccurrenceNumber).Select(x => TaskMapper.ToDto(x, today)).ToList();
    }

    // ---------------------------------------------------------------- validation

    private sealed record Resolved(List<Tag> Tags);

    private async Task<Resolved> ValidateAsync(TaskInput i, TaskItem? existing)
    {
        if (string.IsNullOrWhiteSpace(i.Title)) throw ApiException.Invalid("Title", "Title is required.");
        if (!Enum.IsDefined(i.Priority)) throw ApiException.Invalid("Priority", "Invalid priority.");
        if (i.Status is { } st && !Enum.IsDefined(st)) throw ApiException.Invalid("Status", "Invalid status.");
        if (i.CategoryId is not null && !await db.Categories.AnyAsync(c => c.Id == i.CategoryId))
            throw ApiException.Invalid("CategoryId", "Category does not exist.");
        if (i.DueTime is not null && i.DueDate is null)
            throw ApiException.Invalid("DueTime", "A due time needs a due date.");
        if (i.StartDate is { } s && i.DueDate is { } d && s > d)
            throw ApiException.Invalid("StartDate", "The start date is after the due date.");

        var tags = new List<Tag>();
        if (i.TagIds is not null)
        {
            var ids = i.TagIds.Distinct().ToList();
            if (ids.Count > MaxTags) throw ApiException.Invalid("TagIds", $"A task can have at most {MaxTags} tags.");
            tags = await db.Tags.Where(t => ids.Contains(t.Id)).ToListAsync();
            if (tags.Count != ids.Count) throw ApiException.Invalid("TagIds", "One or more tags do not exist.");
        }

        if (i.Reminders is not null)
        {
            if (i.Reminders.Count > MaxReminders) throw ApiException.Invalid("Reminders", $"At most {MaxReminders} reminders per task.");
            foreach (var r in i.Reminders)
            {
                if ((r.MinutesBefore is null) == (r.At is null))
                    throw ApiException.Invalid("Reminders", "Each reminder needs exactly one of minutesBefore or at.");
                if (r.MinutesBefore is not null && i.DueDate is null)
                    throw ApiException.Invalid("Reminders", "A relative reminder needs a due date.");
            }
        }
        else if (existing is null && i.Recurrence is null) { /* nothing */ }

        if (i.Recurrence is { } rec)
        {
            var anchor = i.DueDate ?? existing?.RecurrenceRule?.AnchorDate ?? Today;
            RecurrenceService.Validate(rec, anchor);
            if (existing is not null && rec.MaxOccurrences is { } max && max < existing.OccurrenceNumber)
                throw ApiException.Invalid("Recurrence", "The occurrence limit is below the current occurrence number.");
        }
        return new Resolved(tags);
    }

    // ---------------------------------------------------------------- create / update

    public async Task<TaskDto> CreateAsync(TaskInput input)
    {
        var resolved = await ValidateAsync(input, null);
        var now = Now;
        var t = new TaskItem { CreatedAt = now };
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var finished = Apply(t, input, now, resolved, isNew: true);
        t.SortOrder = (await db.Tasks.Where(x => x.Status == t.Status).MaxAsync(x => (int?)x.SortOrder) ?? -1) + 1;
        t.Activity.Add(new ActivityEntry { Kind = "Created", At = now });
        db.Tasks.Add(t);
        await db.SaveChangesAsync();
        if (finished) await recurrence.SpawnNextAsync(t);
        await tx.CommitAsync();
        return await GetAsync(t.Id);
    }

    public async Task<TaskDto> UpdateAsync(int id, TaskInput input)
    {
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        var resolved = await ValidateAsync(input, t);
        var now = Now;
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var before = Snapshot(t);
        var finished = Apply(t, input, now, resolved, isNew: false);
        var changed = Diff(before, Snapshot(t));
        if (changed.Count > 0) t.Activity.Add(new ActivityEntry { Kind = "Updated", At = now, Detail = "Changed " + string.Join(", ", changed) });
        await db.SaveChangesAsync();
        if (finished) await recurrence.SpawnNextAsync(t);
        await tx.CommitAsync();
        return await GetAsync(t.Id);
    }

    private static Dictionary<string, string?> Snapshot(TaskItem t) => new()
    {
        ["title"] = t.Title, ["description"] = t.Description, ["notes"] = t.Notes,
        ["priority"] = t.Priority.ToString(), ["start date"] = t.StartDate?.ToString("o"),
        ["due date"] = t.DueDate?.ToString("o"), ["due time"] = t.DueTime?.ToString("HH:mm"),
        ["estimate"] = t.EstimatedMinutes?.ToString(), ["time spent"] = t.ActualMinutes?.ToString(),
        ["category"] = t.CategoryId?.ToString(),
        ["tags"] = string.Join(',', t.TaskTags.Select(x => x.TagId).Order()),
        ["pinned"] = t.IsPinned.ToString(), ["favorite"] = t.IsFavorite.ToString(),
        ["reminders"] = string.Join(',', t.Reminders.Select(r => $"{r.MinutesBefore}/{r.RemindAt:o}").Order()),
    };

    private static List<string> Diff(Dictionary<string, string?> a, Dictionary<string, string?> b) =>
        b.Where(kv => a[kv.Key] != kv.Value).Select(kv => kv.Key).ToList();

    /// <summary>Copies input onto the entity. Returns true when this call moved the task into Done.</summary>
    private bool Apply(TaskItem t, TaskInput i, DateTime now, Resolved resolved, bool isNew)
    {
        t.Title = i.Title.Trim();
        t.Description = Blank(i.Description);
        t.Notes = Blank(i.Notes);
        t.Priority = i.Priority;
        t.StartDate = i.StartDate;
        var dueChanged = t.DueDate != i.DueDate || t.DueTime != i.DueTime;
        t.DueDate = i.DueDate;
        t.DueTime = i.DueDate is null ? null : i.DueTime;
        t.EstimatedMinutes = i.EstimatedMinutes;
        t.ActualMinutes = i.ActualMinutes;
        t.CategoryId = i.CategoryId;
        if (i.IsPinned is bool pin) t.IsPinned = pin;
        if (i.IsFavorite is bool fav) t.IsFavorite = fav;
        t.UpdatedAt = now;

        if (i.TagIds is not null)
        {
            var want = resolved.Tags.Select(x => x.Id).ToHashSet();
            foreach (var x in t.TaskTags.Where(x => !want.Contains(x.TagId)).ToList()) t.TaskTags.Remove(x);
            foreach (var tag in resolved.Tags.Where(g => t.TaskTags.All(x => x.TagId != g.Id)))
                t.TaskTags.Add(new TaskTag { TagId = tag.Id });
        }

        // Completion / board column. The explicit Status wins; otherwise IsCompleted decides.
        var target = i.Status ?? (i.IsCompleted ? WorkStatus.Done : t.IsCompleted ? WorkStatus.Todo : t.Status);
        var finished = Transition(t, target, now, isNew);

        if (i.Recurrence is { } rec)
        {
            var anchor = t.DueDate ?? t.RecurrenceRule?.AnchorDate ?? DateOnly.FromDateTime(time.GetLocalNow().DateTime);
            if (t.RecurrenceRule is { } rule)
            {
                RecurrenceService.Fill(rule, rec, anchor);
                t.Activity.Add(new ActivityEntry { Kind = "RecurrenceChanged", At = now, Detail = "Recurrence updated." });
            }
            else
            {
                t.RecurrenceRule = RecurrenceService.NewRule(rec, anchor, now);
                t.OccurrenceNumber = 1;
                t.RecurrenceRule.OccurrencesGenerated = 1;
            }
        }

        SyncReminders(t, i.Reminders, dueChanged, now);
        return finished;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>
    /// The one place that moves a task between Todo / InProgress / Done and keeps IsCompleted and CompletedAt
    /// consistent with it. Returns true when the task has just been completed.
    /// </summary>
    private static bool Transition(TaskItem t, WorkStatus target, DateTime now, bool isNew)
    {
        var finished = false;
        if (target == WorkStatus.Done && !t.IsCompleted)
        {
            t.IsCompleted = true;
            t.CompletedAt = now;
            finished = true;
            if (!isNew) t.Activity.Add(new ActivityEntry { Kind = "Completed", At = now });
        }
        else if (target != WorkStatus.Done && t.IsCompleted)
        {
            t.IsCompleted = false;
            t.CompletedAt = null;
            t.Activity.Add(new ActivityEntry { Kind = "Reopened", At = now });
        }
        else if (!isNew && target != t.Status)
        {
            t.Activity.Add(new ActivityEntry { Kind = "StatusChanged", At = now, Detail = $"{t.Status} → {target}" });
        }
        t.Status = target;
        return finished;
    }

    private void SyncReminders(TaskItem t, List<ReminderInput>? wanted, bool dueChanged, DateTime now)
    {
        var tz = time.LocalTimeZone;
        var dueUtc = ReminderTime.DueInstantUtc(t.DueDate, t.DueTime, tz);

        if (wanted is null)
        {
            // Keep the reminders, but follow the due date if it moved (and let them fire again).
            if (!dueChanged) return;
            foreach (var r in t.Reminders.Where(r => r.MinutesBefore is not null).ToList())
            {
                if (dueUtc is null) { t.Reminders.Remove(r); continue; }
                var at = dueUtc.Value.AddMinutes(-r.MinutesBefore!.Value);
                if (at != r.RemindAt) { r.RemindAt = at; r.NotifiedAt = null; }
            }
            return;
        }

        var keep = new HashSet<Reminder>();
        foreach (var w in wanted)
        {
            var at = w.MinutesBefore is int m ? dueUtc!.Value.AddMinutes(-m) : DateTime.SpecifyKind(w.At!.Value, DateTimeKind.Utc);
            var existing = t.Reminders.FirstOrDefault(r => !keep.Contains(r) && r.MinutesBefore == w.MinutesBefore && r.RemindAt == at)
                ?? t.Reminders.FirstOrDefault(r => !keep.Contains(r) && w.MinutesBefore is not null && r.MinutesBefore == w.MinutesBefore);
            if (existing is not null)
            {
                if (existing.RemindAt != at) { existing.RemindAt = at; existing.NotifiedAt = null; }
                keep.Add(existing);
            }
            else
            {
                var added = new Reminder { MinutesBefore = w.MinutesBefore, RemindAt = at };
                t.Reminders.Add(added);
                keep.Add(added);
            }
        }
        foreach (var r in t.Reminders.Where(r => !keep.Contains(r)).ToList()) t.Reminders.Remove(r);
    }

    // ---------------------------------------------------------------- actions

    public async Task<TaskDto> ToggleAsync(int id)
    {
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        return await SetStatusCore(t, t.IsCompleted ? WorkStatus.Todo : WorkStatus.Done, null);
    }

    public async Task<TaskDto> SetStatusAsync(int id, StatusInput input)
    {
        if (!Enum.IsDefined(input.Status)) throw ApiException.Invalid("Status", "Invalid status.");
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        return await SetStatusCore(t, input.Status, input.Position);
    }

    private async Task<TaskDto> SetStatusCore(TaskItem t, WorkStatus target, int? position)
    {
        var now = Now;
        var previous = t.Status;
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var finished = Transition(t, target, now, false);
        t.UpdatedAt = now;

        if (position is null)
        {
            // Appending needs one scalar query, not the whole column (the Done column can be large).
            if (target != previous || t.SortOrder == 0)
                t.SortOrder = (await db.Tasks.Where(x => x.Status == target && x.Id != t.Id).MaxAsync(x => (int?)x.SortOrder) ?? -1) + 1;
        }
        else
        {
            // Insert at an exact spot and renumber 0..n so the order is stable and gap-free.
            var column = await db.Tasks.Where(x => x.Status == target && x.Id != t.Id)
                .OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToListAsync();
            column.Insert(Math.Clamp(position.Value, 0, column.Count), t);
            for (var n = 0; n < column.Count; n++)
                if (column[n].SortOrder != n) column[n].SortOrder = n;
        }

        await db.SaveChangesAsync();
        if (finished) await recurrence.SpawnNextAsync(t);
        await tx.CommitAsync();
        return await GetAsync(t.Id);
    }

    public async Task<TaskDto> RescheduleAsync(int id, RescheduleInput input)
    {
        if (input.DueTime is not null && input.DueDate is null)
            throw ApiException.Invalid("DueTime", "A due time needs a due date.");
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        if (input.DueDate is { } d && t.StartDate is { } s && s > d)
            throw ApiException.Invalid("DueDate", "The due date is before the start date.");
        var now = Now;
        var old = t.DueDate?.ToString("yyyy-MM-dd") ?? "no date";
        var timeChanged = input.DueDate != t.DueDate || (input.DueTime ?? t.DueTime) != t.DueTime;
        t.DueDate = input.DueDate;
        t.DueTime = input.DueDate is null ? null : input.DueTime ?? t.DueTime;
        t.UpdatedAt = now;
        SyncReminders(t, null, timeChanged, now);
        t.Activity.Add(new ActivityEntry
        {
            Kind = "Rescheduled", At = now,
            Detail = $"{old} → {t.DueDate?.ToString("yyyy-MM-dd") ?? "no date"}",
        });
        await db.SaveChangesAsync();
        return await GetAsync(id);
    }

    public async Task<TaskDto> SetFlagsAsync(int id, FlagsInput input)
    {
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        var now = Now;
        if (input.IsPinned is bool p && p != t.IsPinned)
        {
            t.IsPinned = p;
            t.Activity.Add(new ActivityEntry { Kind = p ? "Pinned" : "Unpinned", At = now });
        }
        if (input.IsFavorite is bool f && f != t.IsFavorite)
        {
            t.IsFavorite = f;
            t.Activity.Add(new ActivityEntry { Kind = f ? "Favorited" : "Unfavorited", At = now });
        }
        t.UpdatedAt = now;
        await db.SaveChangesAsync();
        return await GetAsync(id);
    }

    public async Task<TaskDto> DuplicateAsync(int id)
    {
        var src = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        var now = Now;
        var title = src.Title.Length > 190 ? src.Title[..190] : src.Title;
        var copy = new TaskItem
        {
            Title = title + " (copy)", Description = src.Description, Notes = src.Notes,
            Priority = src.Priority, Status = WorkStatus.Todo, IsCompleted = false,
            StartDate = src.StartDate, DueDate = src.DueDate, DueTime = src.DueTime,
            EstimatedMinutes = src.EstimatedMinutes, CategoryId = src.CategoryId,
            CreatedAt = now, UpdatedAt = now,
            SortOrder = (await db.Tasks.Where(x => x.Status == WorkStatus.Todo).MaxAsync(x => (int?)x.SortOrder) ?? -1) + 1,
        };
        foreach (var x in src.TaskTags) copy.TaskTags.Add(new TaskTag { TagId = x.TagId });
        var i = 0;
        foreach (var s in src.Subtasks.OrderBy(s => s.SortOrder).ThenBy(s => s.Id))
            copy.Subtasks.Add(new Subtask { Title = s.Title, SortOrder = i++, CreatedAt = now });
        var dueUtc = ReminderTime.DueInstantUtc(copy.DueDate, copy.DueTime, time.LocalTimeZone);
        foreach (var r in src.Reminders.Where(r => r.MinutesBefore is not null && dueUtc is not null))
            copy.Reminders.Add(new Reminder { MinutesBefore = r.MinutesBefore, RemindAt = dueUtc!.Value.AddMinutes(-r.MinutesBefore!.Value) });
        copy.Activity.Add(new ActivityEntry { Kind = "Created", At = now, Detail = $"Duplicated from \"{src.Title}\"." });
        db.Tasks.Add(copy);
        await db.SaveChangesAsync();
        return await GetAsync(copy.Id);
    }

    public async Task DeleteAsync(int id)
    {
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        var files = t.Attachments.Select(a => a.StoredName).ToList();
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        await EndSeriesIfLastOpenAsync(t);
        db.Tasks.Remove(t);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        attachments.DeleteFiles(files);
    }

    /// <summary>Deleting the only open occurrence of a series leaves nothing to continue from, so the series ends.</summary>
    private async Task EndSeriesIfLastOpenAsync(TaskItem t)
    {
        if (t.IsCompleted || t.RecurrenceRule is not { IsActive: true } rule) return;
        var otherOpen = await db.Tasks.AnyAsync(x => x.RecurrenceRuleId == rule.Id && x.Id != t.Id && !x.IsCompleted);
        if (!otherOpen) { rule.IsActive = false; rule.StoppedAt = Now; }
    }

    /// <summary>"Skip this one": moves a recurring task on to its next occurrence without counting it as done.</summary>
    public async Task<TaskDto?> SkipAsync(int id)
    {
        var t = await WithAll().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound();
        if (t.RecurrenceRule is not { IsActive: true }) throw ApiException.Invalid("Recurrence", "Only a repeating task can be skipped.");
        if (t.IsCompleted) throw ApiException.Invalid("Recurrence", "That occurrence is already completed.");
        var files = t.Attachments.Select(a => a.StoredName).ToList();
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var next = await recurrence.SpawnNextAsync(t);
        db.Tasks.Remove(t);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        attachments.DeleteFiles(files);
        return next is null ? null : await GetAsync(next.Id);
    }

    public async Task<int> ClearCompletedAsync()
    {
        var files = await db.Attachments.Where(a => a.Task!.IsCompleted).Select(a => a.StoredName).ToListAsync();
        var n = await db.Tasks.Where(t => t.IsCompleted).ExecuteDeleteAsync();
        attachments.DeleteFiles(files);
        return n;
    }

    // ---------------------------------------------------------------- bulk

    public async Task<BulkResult> BulkAsync(BulkInput input)
    {
        var ids = input.Ids.Distinct().ToList();
        var tasks = await WithAll().Where(t => ids.Contains(t.Id)).ToListAsync();
        var missing = ids.Count - tasks.Count;
        var action = input.Action.Trim().ToLowerInvariant();
        var now = Now;
        var v = input.Value is { ValueKind: not (System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined) } e ? e : (System.Text.Json.JsonElement?)null;

        Priority? priority = null; int? refId = null; WorkStatus? status = null; DateOnly? due = null;
        switch (action)
        {
            case "priority":
                if (v is null || v.Value.ValueKind != System.Text.Json.JsonValueKind.String || !Enum.TryParse<Priority>(v.Value.GetString(), true, out var pr) || !Enum.IsDefined(pr))
                    throw ApiException.Invalid("Value", "A valid priority is required.");
                priority = pr; break;
            case "category":
                if (v is not null)
                {
                    if (v.Value.ValueKind != System.Text.Json.JsonValueKind.Number || !v.Value.TryGetInt32(out var cid)) throw ApiException.Invalid("Value", "A category id is required.");
                    if (!await db.Categories.AnyAsync(c => c.Id == cid)) throw ApiException.Invalid("Value", "Category does not exist.");
                    refId = cid;
                }
                break;
            case "addtag" or "removetag":
                if (v is null || v.Value.ValueKind != System.Text.Json.JsonValueKind.Number || !v.Value.TryGetInt32(out var tid)) throw ApiException.Invalid("Value", "A tag id is required.");
                if (!await db.Tags.AnyAsync(g => g.Id == tid)) throw ApiException.Invalid("Value", "Tag does not exist.");
                refId = tid; break;
            case "status":
                if (v is null || v.Value.ValueKind != System.Text.Json.JsonValueKind.String || !Enum.TryParse<WorkStatus>(v.Value.GetString(), true, out var ws) || !Enum.IsDefined(ws))
                    throw ApiException.Invalid("Value", "A valid status is required.");
                status = ws; break;
            case "duedate":
                if (v is not null)
                {
                    if (v.Value.ValueKind != System.Text.Json.JsonValueKind.String || !DateOnly.TryParseExact(v.Value.GetString(), "yyyy-MM-dd", out var dd))
                        throw ApiException.Invalid("Value", "A date like 2026-12-31 (or null) is required.");
                    due = dd;
                }
                break;
            case "complete" or "reopen" or "delete" or "pin" or "unpin" or "favorite" or "unfavorite": break;
            default: throw ApiException.Invalid("Action", "Unknown bulk action.");
        }

        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        var finished = new List<TaskItem>();
        var files = new List<string>();
        foreach (var t in tasks)
        {
            switch (action)
            {
                case "complete": if (Transition(t, WorkStatus.Done, now, false)) finished.Add(t); break;
                case "reopen": if (t.IsCompleted) Transition(t, WorkStatus.Todo, now, false); break;
                case "status": if (Transition(t, status!.Value, now, false)) finished.Add(t); break;
                case "delete":
                    await EndSeriesIfLastOpenAsync(t);
                    files.AddRange(t.Attachments.Select(a => a.StoredName));
                    db.Tasks.Remove(t); break;
                case "priority": t.Priority = priority!.Value; break;
                case "category": t.CategoryId = refId; break;
                case "addtag": if (t.TaskTags.All(x => x.TagId != refId)) t.TaskTags.Add(new TaskTag { TagId = refId!.Value }); break;
                case "removetag": foreach (var x in t.TaskTags.Where(x => x.TagId == refId).ToList()) t.TaskTags.Remove(x); break;
                case "pin": t.IsPinned = true; break;
                case "unpin": t.IsPinned = false; break;
                case "favorite": t.IsFavorite = true; break;
                case "unfavorite": t.IsFavorite = false; break;
                case "duedate":
                    if (due is { } nd && t.StartDate is { } sd && sd > nd) break; // keep start <= due
                    var moved = t.DueDate != due;
                    t.DueDate = due;
                    if (due is null) t.DueTime = null;
                    SyncReminders(t, null, moved, now);
                    break;
            }
            if (action != "delete")
            {
                t.UpdatedAt = now;
                t.Activity.Add(new ActivityEntry { Kind = "Bulk", At = now, Detail = BulkLabel(action) });
            }
        }
        await db.SaveChangesAsync();
        foreach (var t in finished) await recurrence.SpawnNextAsync(t);
        await tx.CommitAsync();
        attachments.DeleteFiles(files);
        return new BulkResult(tasks.Count, missing);
    }

    private static string BulkLabel(string action) => action switch
    {
        "complete" => "Completed in bulk", "reopen" => "Reopened in bulk", "status" => "Status changed in bulk",
        "priority" => "Priority changed in bulk", "category" => "Category changed in bulk",
        "addtag" => "Tag added in bulk", "removetag" => "Tag removed in bulk", "duedate" => "Due date changed in bulk",
        _ => "Changed in bulk",
    };
}
