namespace TaskFlow.Api.Models;

public enum FocusKind { Focus = 0, ShortBreak = 1, LongBreak = 2 }

public class FocusSession
{
    public int Id { get; set; }
    public int? TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public FocusKind Kind { get; set; }
    public int PlannedSeconds { get; set; }
    public int ActualSeconds { get; set; }
    /// <summary>True when the timer ran to zero; false when the user stopped it early.</summary>
    public bool Completed { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime EndedAt { get; set; }
}

public class ActivityEntry
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public string Kind { get; set; } = "";
    public string? Detail { get; set; }
    public DateTime At { get; set; }
}

public class Attachment
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public TaskItem? Task { get; set; }
    /// <summary>The name the user uploaded (display only; never used to build a path).</summary>
    public string FileName { get; set; } = "";
    /// <summary>Server-generated file name inside the attachments folder.</summary>
    public string StoredName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
}
