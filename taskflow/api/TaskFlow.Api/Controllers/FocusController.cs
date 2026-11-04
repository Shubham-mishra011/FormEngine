using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api/focus")]
public class FocusController(FocusService focus) : ControllerBase
{
    [HttpGet("sessions")]
    public Task<List<FocusSessionDto>> List(int days = 30, int limit = 100) => focus.ListAsync(days, limit);

    [HttpPost("sessions")]
    public async Task<ActionResult<FocusSessionDto>> Record(FocusSessionInput input) =>
        CreatedAtAction(nameof(List), await focus.RecordAsync(input));

    [HttpDelete("sessions/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await focus.DeleteAsync(id);
        return NoContent();
    }

    [HttpGet("stats")]
    public Task<FocusStatsDto> Stats(int days = 14) => focus.StatsAsync(days);
}
