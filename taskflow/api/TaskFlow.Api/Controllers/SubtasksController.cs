using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Controllers;

[ApiController]
public class SubtasksController(TaskFlowDbContext db, TimeProvider time) : ControllerBase
{
    public const int MaxPerTask = 100;

    public static SubtaskDto ToDto(Subtask s) =>
        new(s.Id, s.TaskId, s.Title, s.IsCompleted, s.SortOrder, s.CreatedAt, s.CompletedAt);

    [HttpGet("api/tasks/{taskId:int}/subtasks")]
    public async Task<ActionResult<List<SubtaskDto>>> List(int taskId)
    {
        if (!await db.Tasks.AnyAsync(t => t.Id == taskId)) return NotFound();
        return (await db.Subtasks.Where(s => s.TaskId == taskId)
            .OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToListAsync()).Select(ToDto).ToList();
    }

    [HttpPost("api/tasks/{taskId:int}/subtasks")]
    public async Task<ActionResult<SubtaskDto>> Create(int taskId, SubtaskInput input)
    {
        // The parent must be a real task; a subtask can never be the parent of another subtask.
        if (!await db.Tasks.AnyAsync(t => t.Id == taskId)) return NotFound(new ProblemDetails { Title = "Task not found." });
        var title = input.Title.Trim();
        if (title.Length == 0) return Invalid("Title", "Title is required.");
        var siblings = db.Subtasks.Where(s => s.TaskId == taskId);
        if (await siblings.CountAsync() >= MaxPerTask) return Invalid("TaskId", $"A task can have at most {MaxPerTask} subtasks.");

        var now = time.GetUtcNow().UtcDateTime;
        var next = (await siblings.MaxAsync(s => (int?)s.SortOrder) ?? -1) + 1;
        var s = new Subtask
        {
            TaskId = taskId, Title = title, SortOrder = next, CreatedAt = now,
            IsCompleted = input.IsCompleted, CompletedAt = input.IsCompleted ? now : null,
        };
        db.Subtasks.Add(s);
        await Touch(taskId, now);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(List), new { taskId }, ToDto(s));
    }

    [HttpPut("api/subtasks/{id:int}")]
    public async Task<ActionResult<SubtaskDto>> Update(int id, SubtaskInput input)
    {
        var s = await db.Subtasks.FindAsync(id);
        if (s is null) return NotFound();
        var title = input.Title.Trim();
        if (title.Length == 0) return Invalid("Title", "Title is required.");
        var now = time.GetUtcNow().UtcDateTime;
        s.Title = title;
        if (input.IsCompleted != s.IsCompleted) s.CompletedAt = input.IsCompleted ? now : null;
        s.IsCompleted = input.IsCompleted;
        await Touch(s.TaskId, now);
        await db.SaveChangesAsync();
        return ToDto(s);
    }

    [HttpPatch("api/subtasks/{id:int}/toggle")]
    public async Task<ActionResult<SubtaskDto>> Toggle(int id)
    {
        var s = await db.Subtasks.FindAsync(id);
        if (s is null) return NotFound();
        var now = time.GetUtcNow().UtcDateTime;
        s.IsCompleted = !s.IsCompleted;
        s.CompletedAt = s.IsCompleted ? now : null;
        await Touch(s.TaskId, now);
        await db.SaveChangesAsync();
        return ToDto(s);
    }

    [HttpDelete("api/subtasks/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var s = await db.Subtasks.FindAsync(id);
        if (s is null) return NotFound();
        db.Subtasks.Remove(s);
        await Touch(s.TaskId, time.GetUtcNow().UtcDateTime);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private async Task Touch(int taskId, DateTime now)
    {
        var parent = await db.Tasks.FindAsync(taskId);
        if (parent is not null) parent.UpdatedAt = now;
    }

    private ActionResult Invalid(string field, string message)
    {
        ModelState.AddModelError(field, message);
        return ValidationProblem(ModelState);
    }
}
