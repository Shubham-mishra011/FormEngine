using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

/// <summary>HTTP surface for tasks. All rules live in <see cref="TaskService"/>.</summary>
[ApiController]
[Route("api/tasks")]
public class TasksController(TaskService tasks, RecurrenceService recurrence, TaskFlowDbContext db) : ControllerBase
{
    [HttpGet]
    public Task<List<TaskDto>> List([FromQuery] TaskQueryParams query) => tasks.ListAsync(query);

    [HttpGet("{id:int}")]
    public Task<TaskDto> Get(int id) => tasks.GetAsync(id);

    [HttpGet("stats")]
    public Task<StatsDto> Stats() => tasks.StatsAsync();

    [HttpGet("{id:int}/activity")]
    public Task<List<ActivityDto>> Activity(int id, int limit = 100) => tasks.ActivityAsync(id, limit);

    [HttpGet("{id:int}/occurrences")]
    public Task<List<TaskDto>> Occurrences(int id) => tasks.OccurrencesAsync(id);

    [HttpPost]
    public async Task<ActionResult<TaskDto>> Create(TaskInput input)
    {
        var t = await tasks.CreateAsync(input);
        return CreatedAtAction(nameof(Get), new { id = t.Id }, t);
    }

    [HttpPut("{id:int}")]
    public Task<TaskDto> Update(int id, TaskInput input) => tasks.UpdateAsync(id, input);

    [HttpPatch("{id:int}/toggle")]
    public Task<TaskDto> Toggle(int id) => tasks.ToggleAsync(id);

    [HttpPatch("{id:int}/status")]
    public Task<TaskDto> SetStatus(int id, StatusInput input) => tasks.SetStatusAsync(id, input);

    [HttpPatch("{id:int}/reschedule")]
    public Task<TaskDto> Reschedule(int id, RescheduleInput input) => tasks.RescheduleAsync(id, input);

    [HttpPatch("{id:int}/flags")]
    public Task<TaskDto> Flags(int id, FlagsInput input) => tasks.SetFlagsAsync(id, input);

    [HttpPost("{id:int}/duplicate")]
    public async Task<ActionResult<TaskDto>> Duplicate(int id)
    {
        var t = await tasks.DuplicateAsync(id);
        return CreatedAtAction(nameof(Get), new { id = t.Id }, t);
    }

    [HttpPost("{id:int}/recurrence/stop")]
    public async Task<TaskDto> StopRecurrence(int id)
    {
        var t = await db.Tasks.FindAsync(id) ?? throw ApiException.NotFound();
        await recurrence.StopAsync(t);
        return await tasks.GetAsync(id);
    }

    /// <summary>Moves a repeating task on to its next occurrence without marking this one done.</summary>
    [HttpPost("{id:int}/skip")]
    public async Task<ActionResult<TaskDto>> Skip(int id)
    {
        var next = await tasks.SkipAsync(id);
        return next is null ? NoContent() : next;
    }

    [HttpPost("bulk")]
    public Task<BulkResult> Bulk(BulkInput input) => tasks.BulkAsync(input);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await tasks.DeleteAsync(id);
        return NoContent();
    }

    [HttpDelete("completed")]
    public async Task<IActionResult> ClearCompleted()
    {
        await tasks.ClearCompletedAsync();
        return NoContent();
    }
}
