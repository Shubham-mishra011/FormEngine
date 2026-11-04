namespace TaskFlow.Api.Models;

/// <summary>
/// A checklist item belonging to exactly one task. Subtasks are one level deep by design: the table has
/// no self-reference, so cycles and "subtask of a subtask" cannot exist, and the parent is a real FK.
/// </summary>
public class Subtask
{
    public int Id { get; set; }
    public int TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public string Title { get; set; } = "";
    public bool IsCompleted { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
