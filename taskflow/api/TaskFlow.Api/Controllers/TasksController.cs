using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api/tasks")]
public class TasksController(TaskFlowDbContext db) : ControllerBase
{
    private const string LikeEscape = "\\";

    /// <summary>Makes %, _ and \ match literally in a LIKE pattern.</summary>
    private static string EscapeLike(string s) =>
        s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static TaskDto ToDto(TaskItem t) => new(
        t.Id, t.Title, t.Notes, t.IsCompleted, t.Priority, t.DueDate, t.CategoryId,
        t.Category?.Name, t.Category?.Color, t.CreatedAt, t.UpdatedAt, t.CompletedAt);

    /// <param name="status">all | active | completed | overdue | today</param>
    /// <param name="sort">due | priority | created | title (append "_desc" to reverse)</param>
    [HttpGet]
    public async Task<ActionResult<List<TaskDto>>> List(
        string? status, string? q, int? categoryId, Priority? priority, string? sort)
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var query = db.Tasks.Include(t => t.Category).AsQueryable();

        switch ((status ?? "all").ToLowerInvariant())
        {
            case "all": break;
            case "active": query = query.Where(t => !t.IsCompleted); break;
            case "completed": query = query.Where(t => t.IsCompleted); break;
            case "overdue": query = query.Where(t => !t.IsCompleted && t.DueDate < today); break;
            case "today": query = query.Where(t => !t.IsCompleted && t.DueDate == today); break;
            default: return BadRequest(new ProblemDetails { Title = "Unknown status filter." });
        }
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{EscapeLike(q.Trim())}%";
            query = query.Where(t => EF.Functions.Like(t.Title, pattern, LikeEscape) ||
                                     (t.Notes != null && EF.Functions.Like(t.Notes, pattern, LikeEscape)));
        }
        if (categoryId is not null) query = query.Where(t => t.CategoryId == categoryId);
        if (priority is not null) query = query.Where(t => t.Priority == priority);

        var s = (sort ?? "created_desc").ToLowerInvariant();
        var desc = s.EndsWith("_desc");
        var key = desc ? s[..^5] : s;
        if (key is not ("created" or "due" or "priority" or "title"))
            return BadRequest(new ProblemDetails { Title = "Unknown sort key." });
        // A personal task list is small; sorting in memory gives predictable semantics for
        // nullable dates and enum priority without depending on SQLite collation/type quirks.
        var items = await query.ToListAsync();
        IOrderedEnumerable<TaskItem> ordered = key switch
        {
            "due" => desc
                ? items.OrderByDescending(t => t.DueDate ?? DateOnly.MinValue)
                : items.OrderBy(t => t.DueDate ?? DateOnly.MaxValue),
            "priority" => desc ? items.OrderBy(t => t.Priority) : items.OrderByDescending(t => t.Priority),
            "title" => desc
                ? items.OrderByDescending(t => t.Title, StringComparer.OrdinalIgnoreCase)
                : items.OrderBy(t => t.Title, StringComparer.OrdinalIgnoreCase),
            _ => desc ? items.OrderByDescending(t => t.CreatedAt) : items.OrderBy(t => t.CreatedAt),
        };
        return ordered.ThenBy(t => t.Id).Select(ToDto).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<TaskDto>> Get(int id)
    {
        var t = await db.Tasks.Include(x => x.Category).FirstOrDefaultAsync(x => x.Id == id);
        return t is null ? NotFound() : ToDto(t);
    }

    [HttpGet("stats")]
    public async Task<StatsDto> Stats()
    {
        var today = DateOnly.FromDateTime(DateTime.Now);
        var total = await db.Tasks.CountAsync();
        var completed = await db.Tasks.CountAsync(t => t.IsCompleted);
        var overdue = await db.Tasks.CountAsync(t => !t.IsCompleted && t.DueDate < today);
        var dueToday = await db.Tasks.CountAsync(t => !t.IsCompleted && t.DueDate == today);
        return new StatsDto(total, completed, total - completed, overdue, dueToday);
    }

    [HttpPost]
    public async Task<ActionResult<TaskDto>> Create(TaskInput input)
    {
        var bad = await Validate(input);
        if (bad is not null) return bad;
        var now = DateTime.UtcNow;
        var t = new TaskItem { CreatedAt = now };
        Apply(t, input, now);
        db.Tasks.Add(t);
        await db.SaveChangesAsync();
        await db.Entry(t).Reference(x => x.Category).LoadAsync();
        return CreatedAtAction(nameof(Get), new { id = t.Id }, ToDto(t));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<TaskDto>> Update(int id, TaskInput input)
    {
        var t = await db.Tasks.FindAsync(id);
        if (t is null) return NotFound();
        var bad = await Validate(input);
        if (bad is not null) return bad;
        Apply(t, input, DateTime.UtcNow);
        await db.SaveChangesAsync();
        await db.Entry(t).Reference(x => x.Category).LoadAsync();
        return ToDto(t);
    }

    [HttpPatch("{id:int}/toggle")]
    public async Task<ActionResult<TaskDto>> Toggle(int id)
    {
        var t = await db.Tasks.Include(x => x.Category).FirstOrDefaultAsync(x => x.Id == id);
        if (t is null) return NotFound();
        var now = DateTime.UtcNow;
        t.IsCompleted = !t.IsCompleted;
        t.CompletedAt = t.IsCompleted ? now : null;
        t.UpdatedAt = now;
        await db.SaveChangesAsync();
        return ToDto(t);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var t = await db.Tasks.FindAsync(id);
        if (t is null) return NotFound();
        db.Tasks.Remove(t);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("completed")]
    public async Task<IActionResult> ClearCompleted()
    {
        await db.Tasks.Where(t => t.IsCompleted).ExecuteDeleteAsync();
        return NoContent();
    }

    private async Task<ActionResult?> Validate(TaskInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title))
            ModelState.AddModelError(nameof(input.Title), "Title is required.");
        else if (!Enum.IsDefined(input.Priority))
            ModelState.AddModelError(nameof(input.Priority), "Invalid priority.");
        else if (input.CategoryId is not null && !await db.Categories.AnyAsync(c => c.Id == input.CategoryId))
            ModelState.AddModelError(nameof(input.CategoryId), "Category does not exist.");
        return ModelState.IsValid ? null : ValidationProblem(ModelState);
    }

    private static void Apply(TaskItem t, TaskInput i, DateTime now)
    {
        t.Title = i.Title.Trim();
        t.Notes = string.IsNullOrWhiteSpace(i.Notes) ? null : i.Notes.Trim();
        t.Priority = i.Priority;
        t.DueDate = i.DueDate;
        t.CategoryId = i.CategoryId;
        if (i.IsCompleted != t.IsCompleted) t.CompletedAt = i.IsCompleted ? now : null;
        t.IsCompleted = i.IsCompleted;
        t.UpdatedAt = now;
    }
}
