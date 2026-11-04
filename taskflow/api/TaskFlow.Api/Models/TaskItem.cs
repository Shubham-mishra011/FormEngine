namespace TaskFlow.Api.Models;

public enum Priority { Low = 0, Medium = 1, High = 2, Urgent = 3 }

/// <summary>Board column. Invariant: <see cref="TaskItem.IsCompleted"/> is true exactly when Status is Done.</summary>
public enum WorkStatus { Todo = 0, InProgress = 1, Done = 2 }

public class TaskItem
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string? Notes { get; set; }
    public bool IsCompleted { get; set; }
    public WorkStatus Status { get; set; } = WorkStatus.Todo;
    public Priority Priority { get; set; } = Priority.Medium;
    public DateOnly? StartDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public TimeOnly? DueTime { get; set; }
    public int? EstimatedMinutes { get; set; }
    public int? ActualMinutes { get; set; }
    public bool IsPinned { get; set; }
    public bool IsFavorite { get; set; }
    public int SortOrder { get; set; }
    public int? CategoryId { get; set; }
    public Category? Category { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    public int? RecurrenceRuleId { get; set; }
    public RecurrenceRule? RecurrenceRule { get; set; }
    /// <summary>1-based position of this task within its recurrence series.</summary>
    public int OccurrenceNumber { get; set; } = 1;

    public List<Subtask> Subtasks { get; set; } = [];
    public List<TaskTag> TaskTags { get; set; } = [];
    public List<Reminder> Reminders { get; set; } = [];
    public List<Attachment> Attachments { get; set; } = [];
    public List<ActivityEntry> Activity { get; set; } = [];
}
