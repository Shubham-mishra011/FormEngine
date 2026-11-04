using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api/activity")]
public class ActivityController(TaskService tasks) : ControllerBase
{
    /// <summary>Newest activity across all tasks.</summary>
    [HttpGet]
    public Task<List<ActivityDto>> Recent(int limit = 50) => tasks.ActivityAsync(null, limit);
}
