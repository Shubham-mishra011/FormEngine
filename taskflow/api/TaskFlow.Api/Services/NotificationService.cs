using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

/// <summary>
/// Turns due reminders into in-app notifications. There is no background worker: the open web page calls
/// <see cref="SyncAsync"/> on a timer, so reminders only appear while TaskFlow is open in a browser tab
/// (a reminder that came due while the app was closed shows up the next time it is opened).
/// </summary>
public class NotificationService(TaskFlowDbContext db, TimeProvider time)
{
    private static NotificationDto ToDto(AppNotification n) =>
        new(n.Id, n.TaskId, n.Kind.ToString(), n.Title, n.Message, n.CreatedAt, n.ReadAt);

    /// <summary>Creates notifications for reminders that are due. Idempotent: running it twice adds nothing new.</summary>
    public async Task<int> SyncAsync(bool includeOverdue)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var local = time.GetLocalNow().DateTime;
        var today = DateOnly.FromDateTime(local);
        var created = 0;

        var due = await db.Reminders.Include(r => r.Task)
            .Where(r => r.NotifiedAt == null && r.RemindAt <= now).OrderBy(r => r.RemindAt).Take(200).ToListAsync();
        foreach (var r in due)
        {
            r.NotifiedAt = now;
            if (r.Task is null || r.Task.IsCompleted) continue; // nothing to remind about any more
            var key = $"reminder:{r.Id}";
            if (await db.Notifications.AnyAsync(n => n.DedupeKey == key)) continue;
            db.Notifications.Add(new AppNotification
            {
                TaskId = r.TaskId, Kind = NotificationKind.Reminder, DedupeKey = key, CreatedAt = now,
                Title = Truncate(r.Task.Title, 200),
                Message = DescribeDue(r.Task, today),
            });
            created++;
        }

        if (includeOverdue)
        {
            var overdueCount = await db.Tasks.CountAsync(t => !t.IsCompleted && t.DueDate < today);
            var digest = $"overdue-digest:{today:yyyy-MM-dd}";
            if (overdueCount > 0 && !await db.Notifications.AnyAsync(n => n.DedupeKey == digest))
            {
                db.Notifications.Add(new AppNotification
                {
                    Kind = NotificationKind.Overdue, DedupeKey = digest, CreatedAt = now,
                    Title = overdueCount == 1 ? "1 task is overdue" : $"{overdueCount} tasks are overdue",
                    Message = "Open Today or Upcoming to reschedule or finish them.",
                });
                created++;
            }

            // A timed task due today whose time has passed.
            var nowTime = TimeOnly.FromDateTime(local);
            var late = await db.Tasks.Where(t => !t.IsCompleted && t.DueDate == today && t.DueTime != null && t.DueTime < nowTime)
                .Take(50).ToListAsync();
            foreach (var t in late)
            {
                var key = $"overdue:{t.Id}:{today:yyyy-MM-dd}";
                if (await db.Notifications.AnyAsync(n => n.DedupeKey == key)) continue;
                db.Notifications.Add(new AppNotification
                {
                    TaskId = t.Id, Kind = NotificationKind.Overdue, DedupeKey = key, CreatedAt = now,
                    Title = Truncate(t.Title, 200), Message = $"This was due at {t.DueTime:HH:mm}.",
                });
                created++;
            }
        }

        await db.SaveChangesAsync();
        return created;
    }

    private static string DescribeDue(TaskItem t, DateOnly today)
    {
        if (t.DueDate is not { } d) return "Reminder";
        var when = d == today ? "today" : d == today.AddDays(1) ? "tomorrow" : d.ToString("MMM d");
        return t.DueTime is { } tm ? $"Due {when} at {tm:HH:mm}" : $"Due {when}";
    }

    private static string Truncate(string s, int n) => s.Length <= n ? s : s[..n];

    public async Task<NotificationList> ListAsync(bool includeDismissed, int limit)
    {
        limit = Math.Clamp(limit, 1, 200);
        var q = db.Notifications.AsQueryable();
        if (!includeDismissed) q = q.Where(n => n.DismissedAt == null);
        var items = await q.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Take(limit).ToListAsync();
        var unread = await db.Notifications.CountAsync(n => n.DismissedAt == null && n.ReadAt == null);
        return new NotificationList(items.Select(ToDto).ToList(), unread);
    }

    public async Task<NotificationDto> MarkReadAsync(int id, bool read)
    {
        var n = await db.Notifications.FindAsync(id) ?? throw ApiException.NotFound();
        n.ReadAt = read ? n.ReadAt ?? time.GetUtcNow().UtcDateTime : null;
        await db.SaveChangesAsync();
        return ToDto(n);
    }

    public async Task<int> MarkAllReadAsync()
    {
        var now = time.GetUtcNow().UtcDateTime;
        return await db.Notifications.Where(n => n.ReadAt == null && n.DismissedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now));
    }

    public async Task DismissAsync(int id)
    {
        var n = await db.Notifications.FindAsync(id) ?? throw ApiException.NotFound();
        n.DismissedAt ??= time.GetUtcNow().UtcDateTime;
        n.ReadAt ??= n.DismissedAt;
        await db.SaveChangesAsync();
    }

    public async Task<int> DismissAllAsync()
    {
        var now = time.GetUtcNow().UtcDateTime;
        return await db.Notifications.Where(n => n.DismissedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.DismissedAt, now).SetProperty(n => n.ReadAt, n => n.ReadAt ?? now));
    }

    /// <summary>Reminders that will fire within the next <paramref name="days"/> days, plus tasks already past due.</summary>
    public async Task<UpcomingReminders> UpcomingAsync(int days)
    {
        days = Math.Clamp(days, 1, 90);
        var now = time.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(time.GetLocalNow().DateTime);
        var upcoming = await db.Reminders
            .Where(r => r.NotifiedAt == null && !r.Task!.IsCompleted && r.RemindAt >= now && r.RemindAt <= now.AddDays(days))
            .OrderBy(r => r.RemindAt).Take(100)
            .Select(r => new UpcomingReminderDto(r.Id, r.TaskId, r.Task!.Title, r.RemindAt, r.MinutesBefore, r.Task.DueDate, r.Task.DueTime))
            .ToListAsync();

        var overdue = await db.Tasks.Include(t => t.Category).Include(t => t.Subtasks)
            .Include(t => t.TaskTags).ThenInclude(x => x.Tag).Include(t => t.RecurrenceRule).Include(t => t.Reminders).Include(t => t.Attachments)
            .AsSplitQuery()
            .Where(t => !t.IsCompleted && t.DueDate < today).OrderBy(t => t.DueDate).ThenBy(t => t.Id).Take(50).ToListAsync();
        return new UpcomingReminders(upcoming, overdue.Select(t => TaskMapper.ToDto(t, today)).ToList());
    }
}
