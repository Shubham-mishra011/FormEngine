using System.ComponentModel.DataAnnotations;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Dtos;

public record SubtaskDto(
    int Id, int TaskId, string Title, bool IsCompleted, int SortOrder, DateTime CreatedAt, DateTime? CompletedAt);

public record TagRef(int Id, string Name, string Color);

public record RecurrenceDto(
    int Id, RecurrenceFrequency Frequency, int Interval, List<int> Weekdays, List<int> MonthDays,
    DateOnly AnchorDate, DateOnly? EndDate, int? MaxOccurrences, int OccurrencesGenerated, bool IsActive,
    DateOnly? NextDue);

public record ReminderDto(int Id, int TaskId, int? MinutesBefore, DateTime RemindAt, DateTime? NotifiedAt);

public record AttachmentDto(int Id, int TaskId, string FileName, string ContentType, long SizeBytes, DateTime CreatedAt);

public record TaskDto(
    int Id, string Title, string? Description, string? Notes, bool IsCompleted, WorkStatus Status, Priority Priority,
    DateOnly? StartDate, DateOnly? DueDate, TimeOnly? DueTime, int? EstimatedMinutes, int? ActualMinutes,
    bool IsPinned, bool IsFavorite, int SortOrder,
    int? CategoryId, string? CategoryName, string? CategoryColor,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? CompletedAt,
    List<SubtaskDto> Subtasks, int SubtaskTotal, int SubtaskDone,
    List<TagRef> Tags, RecurrenceDto? Recurrence, int OccurrenceNumber,
    List<ReminderDto> Reminders, int AttachmentCount, int FocusSeconds);

public class SubtaskInput
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; set; } = "";
    public bool IsCompleted { get; set; }
}

public class RecurrenceInput
{
    public RecurrenceFrequency Frequency { get; set; }
    [Range(1, 99)]
    public int Interval { get; set; } = 1;
    /// <summary>0 = Sunday … 6 = Saturday. Weekly only.</summary>
    public List<int>? Weekdays { get; set; }
    /// <summary>1–31, or -1 for the last day. Monthly only.</summary>
    public List<int>? MonthDays { get; set; }
    public DateOnly? EndDate { get; set; }
    [Range(1, 10000)]
    public int? MaxOccurrences { get; set; }
}

public class ReminderInput
{
    /// <summary>Minutes before the due moment (0 = at the due moment). Needs a due date.</summary>
    [Range(0, 525600)]
    public int? MinutesBefore { get; set; }
    /// <summary>An absolute instant (UTC). Use instead of MinutesBefore.</summary>
    public DateTime? At { get; set; }
}

public class TaskInput
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; set; } = "";
    [StringLength(4000)]
    public string? Description { get; set; }
    [StringLength(4000)]
    public string? Notes { get; set; }
    public Priority Priority { get; set; } = Priority.Medium;
    public DateOnly? StartDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public TimeOnly? DueTime { get; set; }
    [Range(1, 100000)]
    public int? EstimatedMinutes { get; set; }
    [Range(0, 100000)]
    public int? ActualMinutes { get; set; }
    public int? CategoryId { get; set; }
    public bool IsCompleted { get; set; }
    /// <summary>When given it wins over <see cref="IsCompleted"/>. Null keeps the current column.</summary>
    public WorkStatus? Status { get; set; }
    /// <summary>Null keeps the current value (so older clients cannot unpin by accident).</summary>
    public bool? IsPinned { get; set; }
    public bool? IsFavorite { get; set; }
    /// <summary>Null keeps the current tags; an empty list removes them all.</summary>
    public List<int>? TagIds { get; set; }
    /// <summary>Null keeps the current recurrence; use the stop endpoint to end it.</summary>
    public RecurrenceInput? Recurrence { get; set; }
    /// <summary>Null keeps the current reminders; an empty list removes them all.</summary>
    public List<ReminderInput>? Reminders { get; set; }
}

public class StatusInput
{
    public WorkStatus Status { get; set; }
    /// <summary>Zero-based index inside the target column. Omit to append.</summary>
    [Range(0, 100000)]
    public int? Position { get; set; }
}

public class RescheduleInput
{
    public DateOnly? DueDate { get; set; }
    public TimeOnly? DueTime { get; set; }
}

public class FlagsInput
{
    public bool? IsPinned { get; set; }
    public bool? IsFavorite { get; set; }
}

public class BulkInput
{
    [Required, MinLength(1), MaxLength(500)]
    public List<int> Ids { get; set; } = [];
    /// <summary>complete | reopen | delete | priority | category | addTag | removeTag | pin | unpin | favorite | unfavorite | status | dueDate</summary>
    [Required]
    public string Action { get; set; } = "";
    /// <summary>Argument for priority, category, addTag, removeTag, status and dueDate (JSON string/number/null).</summary>
    public System.Text.Json.JsonElement? Value { get; set; }
}

public record BulkResult(int Affected, int Missing);

public record CategoryDto(int Id, string Name, string Color, int TaskCount);

public class CategoryInput
{
    [Required, StringLength(50, MinimumLength = 1)]
    public string Name { get; set; } = "";
    [RegularExpression("^#[0-9a-fA-F]{6}$", ErrorMessage = "Color must be like #aabbcc.")]
    public string Color { get; set; } = "#6366f1";
}

public record TagDto(int Id, string Name, string Color, int TaskCount);

public class TagInput
{
    [Required, StringLength(30, MinimumLength = 1)]
    public string Name { get; set; } = "";
    [RegularExpression("^#[0-9a-fA-F]{6}$", ErrorMessage = "Color must be like #aabbcc.")]
    public string Color { get; set; } = "#8b5cf6";
}

public record StatsDto(int Total, int Completed, int Active, int Overdue, int DueToday, int Inbox, int Upcoming, int InProgress);

public record ActivityDto(int Id, int TaskId, string? TaskTitle, string Kind, string? Detail, DateTime At);

public record NotificationDto(
    int Id, int? TaskId, string Kind, string Title, string? Message, DateTime CreatedAt, DateTime? ReadAt);

public record NotificationList(List<NotificationDto> Items, int Unread);

public record UpcomingReminderDto(
    int ReminderId, int TaskId, string TaskTitle, DateTime RemindAt, int? MinutesBefore, DateOnly? DueDate, TimeOnly? DueTime);

public record UpcomingReminders(List<UpcomingReminderDto> Upcoming, List<TaskDto> OverdueTasks);

public class FocusSessionInput
{
    public FocusKind Kind { get; set; }
    public int? TaskId { get; set; }
    [Range(60, 14400)]
    public int PlannedSeconds { get; set; }
    [Range(0, 86400)]
    public int ActualSeconds { get; set; }
    public bool Completed { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime EndedAt { get; set; }
}

public record FocusSessionDto(
    int Id, int? TaskId, string? TaskTitle, FocusKind Kind, int PlannedSeconds, int ActualSeconds, bool Completed,
    DateTime StartedAt, DateTime EndedAt);

public record FocusDay(DateOnly Date, int Seconds, int Sessions);
public record FocusTaskStat(int TaskId, string Title, int Seconds, int Sessions);

public record FocusStatsDto(
    DateOnly Today, int TodaySeconds, int TodaySessions, int WeekSeconds, int TotalSeconds, int TotalSessions,
    int CurrentStreak, int BestStreak, double AverageSessionMinutes, List<FocusDay> Daily, List<FocusTaskStat> TopTasks);
