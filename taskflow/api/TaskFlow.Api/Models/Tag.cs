namespace TaskFlow.Api.Models;

public class Tag
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#8b5cf6";
    public List<TaskTag> TaskTags { get; set; } = [];
}

/// <summary>Join row. Deleting a tag or a task removes only these rows, never the other side.</summary>
public class TaskTag
{
    public int TaskId { get; set; }
    public TaskItem? Task { get; set; }
    public int TagId { get; set; }
    public Tag? Tag { get; set; }
}
