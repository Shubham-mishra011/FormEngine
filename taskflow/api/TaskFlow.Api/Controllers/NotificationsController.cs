using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api")]
public class NotificationsController(NotificationService notifications) : ControllerBase
{
    /// <summary>Creates notifications for reminders that have come due. The web app calls this on a timer.</summary>
    [HttpPost("notifications/sync")]
    public async Task<object> Sync(bool overdue = true) => new { created = await notifications.SyncAsync(overdue) };

    [HttpGet("notifications")]
    public Task<NotificationList> List(bool includeDismissed = false, int limit = 50) =>
        notifications.ListAsync(includeDismissed, limit);

    [HttpPatch("notifications/{id:int}/read")]
    public Task<NotificationDto> Read(int id, bool read = true) => notifications.MarkReadAsync(id, read);

    [HttpPost("notifications/read-all")]
    public async Task<object> ReadAll() => new { updated = await notifications.MarkAllReadAsync() };

    [HttpDelete("notifications/{id:int}")]
    public async Task<IActionResult> Dismiss(int id)
    {
        await notifications.DismissAsync(id);
        return NoContent();
    }

    [HttpDelete("notifications")]
    public async Task<object> DismissAll() => new { dismissed = await notifications.DismissAllAsync() };

    [HttpGet("reminders/upcoming")]
    public Task<UpcomingReminders> Upcoming(int days = 7) => notifications.UpcomingAsync(days);
}
