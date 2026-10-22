using System.ComponentModel.DataAnnotations;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Dtos;

public record TaskDto(
    int Id, string Title, string? Notes, bool IsCompleted, Priority Priority,
    DateOnly? DueDate, int? CategoryId, string? CategoryName, string? CategoryColor,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? CompletedAt);

public class TaskInput
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; set; } = "";
    [StringLength(4000)]
    public string? Notes { get; set; }
    public Priority Priority { get; set; } = Priority.Medium;
    public DateOnly? DueDate { get; set; }
    public int? CategoryId { get; set; }
    public bool IsCompleted { get; set; }
}

public record CategoryDto(int Id, string Name, string Color, int TaskCount);

public class CategoryInput
{
    [Required, StringLength(50, MinimumLength = 1)]
    public string Name { get; set; } = "";
    [RegularExpression("^#[0-9a-fA-F]{6}$", ErrorMessage = "Color must be like #aabbcc.")]
    public string Color { get; set; } = "#6366f1";
}

public record StatsDto(int Total, int Completed, int Active, int Overdue, int DueToday);
