namespace TaskFlow.Api.Models;

/// <summary>Fires once. Either relative to the due moment (MinutesBefore) or absolute (the stored RemindAt).</summary>
public class Reminder
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public int? MinutesBefore { get; set; }
    /// <summary>UTC instant at which the reminder becomes due. Recomputed when the task's due date/time changes.</summary>
    public DateTime RemindAt { get; set; }
    public DateTime? NotifiedAt { get; set; }
}

public enum NotificationKind { Reminder = 0, Overdue = 1, System = 2 }

public class AppNotification
{
    public int Id { get; set; }
    public int? TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public NotificationKind Kind { get; set; }
    public string Title { get; set; } = "";
    public string? Message { get; set; }
    /// <summary>Stops the same event notifying twice, e.g. "reminder:12" or "overdue:7:2026-10-30".</summary>
    public string DedupeKey { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }
    public DateTime? DismissedAt { get; set; }
}
