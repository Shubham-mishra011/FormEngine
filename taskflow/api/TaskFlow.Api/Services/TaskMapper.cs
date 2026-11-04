using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

public static class TaskMapper
{
    public static SubtaskDto ToDto(Subtask s) =>
        new(s.Id, s.TaskId, s.Title, s.IsCompleted, s.SortOrder, s.CreatedAt, s.CompletedAt);

    public static RecurrenceDto? ToDto(RecurrenceRule? r, TaskItem t, DateOnly today)
    {
        if (r is null) return null;
        DateOnly? next = null;
        if (r.IsActive && RecurrenceCalculator.HasRemaining(r))
            next = RecurrenceCalculator.NextAfter(r, t.DueDate ?? today, today);
        return new RecurrenceDto(
            r.Id, r.Frequency, r.Interval, RecurrenceCalculator.ParseList(r.Weekdays),
            RecurrenceCalculator.ParseList(r.MonthDays), r.AnchorDate, r.EndDate, r.MaxOccurrences,
            r.OccurrencesGenerated, r.IsActive, next);
    }

    public static TaskDto ToDto(TaskItem t, DateOnly today, int focusSeconds = 0)
    {
        var subs = t.Subtasks.OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToList();
        return new TaskDto(
            t.Id, t.Title, t.Description, t.Notes, t.IsCompleted, t.Status, t.Priority,
            t.StartDate, t.DueDate, t.DueTime, t.EstimatedMinutes, t.ActualMinutes,
            t.IsPinned, t.IsFavorite, t.SortOrder,
            t.CategoryId, t.Category?.Name, t.Category?.Color,
            t.CreatedAt, t.UpdatedAt, t.CompletedAt,
            subs.Select(ToDto).ToList(), subs.Count, subs.Count(s => s.IsCompleted),
            t.TaskTags.Where(x => x.Tag is not null).Select(x => new TagRef(x.Tag!.Id, x.Tag.Name, x.Tag.Color))
                .OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList(),
            ToDto(t.RecurrenceRule, t, today), t.OccurrenceNumber,
            t.Reminders.OrderBy(r => r.RemindAt).Select(ToDto).ToList(), t.Attachments.Count, focusSeconds);
    }

    public static ReminderDto ToDto(Reminder r) => new(r.Id, r.TaskId, r.MinutesBefore, r.RemindAt, r.NotifiedAt);

    public static AttachmentDto ToDto(Attachment a) =>
        new(a.Id, a.TaskId, a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt);
}

public static class ReminderTime
{
    /// <summary>Date-only tasks are treated as due at 09:00 local time when measuring reminders.</summary>
    public static readonly TimeOnly DefaultDueTime = new(9, 0);

    public static DateTime? DueInstantUtc(DateOnly? due, TimeOnly? time, TimeZoneInfo tz)
    {
        if (due is null) return null;
        var local = due.Value.ToDateTime(time ?? DefaultDueTime, DateTimeKind.Unspecified);
        if (tz.IsInvalidTime(local)) local = local.AddHours(1); // skipped by a DST jump
        return TimeZoneInfo.ConvertTimeToUtc(local, tz);
    }
}
