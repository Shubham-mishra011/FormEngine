namespace TaskFlow.Api.Dtos;

/// <summary>
/// The JSON backup format. Bump <see cref="ExportFormat.Version"/> only for changes older readers cannot ignore.
/// Version 2 adds tags, rich task fields, recurrence, reminders, attachment records and focus sessions.
/// Version 1 files (categories, tasks, subtasks) are still read; every newer field is optional.
/// </summary>
public static class ExportFormat
{
    public const string Schema = "taskflow-export";
    public const int Version = 2;
    public const int MinSupportedVersion = 1;
    public const int MaxTasks = 10_000;
    public const int MaxCategories = 1_000;
    public const int MaxTags = 1_000;
    public const int MaxSubtasksPerTask = 100;
    public const int MaxRemindersPerTask = 10;
    public const int MaxFocusSessions = 50_000;
    public const int MaxErrorsReported = 50;
    public const int MaxBodyBytes = 40_000_000;
}

// ---- what we write ----
public record ExportCategory(int Id, string Name, string Color);

public record ExportTag(int Id, string Name, string Color);

public record ExportSubtask(string Title, bool IsCompleted, DateTime CreatedAt, DateTime? CompletedAt);

public record ExportRecurrence(
    int Id, string Frequency, int Interval, List<int> Weekdays, List<int> MonthDays, string AnchorDate,
    string? EndDate, int? MaxOccurrences, int OccurrencesGenerated, bool IsActive);

public record ExportReminder(int? MinutesBefore, DateTime RemindAt, bool Notified);

public record ExportAttachment(string FileName, string StoredName, string ContentType, long SizeBytes, DateTime CreatedAt);

public record ExportTask(
    int Id, string Title, string? Notes, bool IsCompleted, string Priority, string? DueDate,
    int? CategoryId, DateTime CreatedAt, DateTime UpdatedAt, DateTime? CompletedAt,
    List<ExportSubtask> Subtasks,
    string? Description = null, string? Status = null, string? StartDate = null, string? DueTime = null,
    int? EstimatedMinutes = null, int? ActualMinutes = null, bool IsPinned = false, bool IsFavorite = false,
    int SortOrder = 0, List<int>? TagIds = null, int? RecurrenceRuleId = null, int OccurrenceNumber = 1,
    List<ExportReminder>? Reminders = null, List<ExportAttachment>? Attachments = null);

public record ExportFocusSession(
    int? TaskId, string Kind, int PlannedSeconds, int ActualSeconds, bool Completed, DateTime StartedAt, DateTime EndedAt);

public record ExportDocument(
    string Schema, int Version, DateTime ExportedAt,
    List<ExportCategory> Categories, List<ExportTask> Tasks,
    List<ExportTag>? Tags = null, List<ExportRecurrence>? RecurrenceRules = null,
    List<ExportFocusSession>? FocusSessions = null);

// ---- what we accept: everything nullable so we can report precise errors instead of crashing ----
public class ImportDocument
{
    public string? Schema { get; set; }
    public int? Version { get; set; }
    public List<ImportCategory?>? Categories { get; set; }
    public List<ImportTag?>? Tags { get; set; }
    public List<ImportRecurrence?>? RecurrenceRules { get; set; }
    public List<ImportTask?>? Tasks { get; set; }
    public List<ImportFocus?>? FocusSessions { get; set; }
}

public class ImportCategory
{
    public int? Id { get; set; }
    public string? Name { get; set; }
    public string? Color { get; set; }
}

public class ImportTag
{
    public int? Id { get; set; }
    public string? Name { get; set; }
    public string? Color { get; set; }
}

public class ImportRecurrence
{
    public int? Id { get; set; }
    public string? Frequency { get; set; }
    public int? Interval { get; set; }
    public List<int>? Weekdays { get; set; }
    public List<int>? MonthDays { get; set; }
    public string? AnchorDate { get; set; }
    public string? EndDate { get; set; }
    public int? MaxOccurrences { get; set; }
    public int? OccurrencesGenerated { get; set; }
    public bool? IsActive { get; set; }
}

public class ImportSubtask
{
    public string? Title { get; set; }
    public bool? IsCompleted { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class ImportReminder
{
    public int? MinutesBefore { get; set; }
    public DateTime? RemindAt { get; set; }
    public bool? Notified { get; set; }
}

public class ImportAttachment
{
    public string? FileName { get; set; }
    public string? StoredName { get; set; }
    public string? ContentType { get; set; }
    public long? SizeBytes { get; set; }
    public DateTime? CreatedAt { get; set; }
}

public class ImportTask
{
    public int? Id { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Notes { get; set; }
    public bool? IsCompleted { get; set; }
    public string? Status { get; set; }
    public string? Priority { get; set; }
    public string? StartDate { get; set; }
    public string? DueDate { get; set; }
    public string? DueTime { get; set; }
    public int? EstimatedMinutes { get; set; }
    public int? ActualMinutes { get; set; }
    public bool? IsPinned { get; set; }
    public bool? IsFavorite { get; set; }
    public int? SortOrder { get; set; }
    public int? CategoryId { get; set; }
    public List<int>? TagIds { get; set; }
    public int? RecurrenceRuleId { get; set; }
    public int? OccurrenceNumber { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public List<ImportSubtask?>? Subtasks { get; set; }
    public List<ImportReminder?>? Reminders { get; set; }
    public List<ImportAttachment?>? Attachments { get; set; }
}

public class ImportFocus
{
    public int? TaskId { get; set; }
    public string? Kind { get; set; }
    public int? PlannedSeconds { get; set; }
    public int? ActualSeconds { get; set; }
    public bool? Completed { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
}

public record Tally(int Add, int Skip);

public record ImportSummary(
    bool Valid, List<string> Errors, List<string> Warnings,
    Tally Categories, Tally Tasks, Tally Subtasks,
    Tally? Tags = null, Tally? FocusSessions = null);

public record ImportResult(ImportSummary Summary, string? SafetyBackup);

public record RestoreResult(ImportSummary Summary, string SafetyBackup, int TasksBefore, int TasksAfter);

public record BackupInfo(string Name, long SizeBytes, DateTime CreatedAt);
