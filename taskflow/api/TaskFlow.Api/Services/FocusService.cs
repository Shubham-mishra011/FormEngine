using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

/// <summary>
/// Stores finished timer runs and computes statistics from them. The countdown itself lives in the browser;
/// the server only ever sees a session once it has ended (completed or stopped early).
/// </summary>
public class FocusService(TaskFlowDbContext db, TimeProvider time)
{
    private static FocusSessionDto ToDto(FocusSession f, string? title) =>
        new(f.Id, f.TaskId, title, f.Kind, f.PlannedSeconds, f.ActualSeconds, f.Completed, f.StartedAt, f.EndedAt);

    public async Task<FocusSessionDto> RecordAsync(FocusSessionInput i)
    {
        if (!Enum.IsDefined(i.Kind)) throw ApiException.Invalid("Kind", "Unknown session kind.");
        var started = AsUtc(i.StartedAt);
        var ended = AsUtc(i.EndedAt);
        var now = time.GetUtcNow().UtcDateTime;
        if (ended < started) throw ApiException.Invalid("EndedAt", "The session ends before it starts.");
        if (ended > now.AddMinutes(5)) throw ApiException.Invalid("EndedAt", "The session ends in the future.");
        if (i.ActualSeconds > (ended - started).TotalSeconds + 5)
            throw ApiException.Invalid("ActualSeconds", "The session lasted longer than the time between its start and end.");
        string? title = null;
        if (i.TaskId is int tid)
        {
            title = await db.Tasks.Where(t => t.Id == tid).Select(t => t.Title).FirstOrDefaultAsync()
                ?? throw ApiException.Invalid("TaskId", "Task does not exist.");
        }
        var f = new FocusSession
        {
            Kind = i.Kind, TaskId = i.TaskId, PlannedSeconds = i.PlannedSeconds,
            ActualSeconds = i.ActualSeconds, Completed = i.Completed, StartedAt = started, EndedAt = ended,
        };
        db.FocusSessions.Add(f);
        if (i.TaskId is int id && i.Kind == FocusKind.Focus && i.ActualSeconds > 0)
            db.Activity.Add(new ActivityEntry
            {
                TaskId = id, Kind = "Focus", At = ended,
                Detail = $"{(i.ActualSeconds + 30) / 60} min focus session{(i.Completed ? "" : " (stopped early)")}",
            });
        await db.SaveChangesAsync();
        return ToDto(f, title);
    }

    private static DateTime AsUtc(DateTime d) =>
        d.Kind == DateTimeKind.Local ? d.ToUniversalTime() : DateTime.SpecifyKind(d, DateTimeKind.Utc);

    public async Task<List<FocusSessionDto>> ListAsync(int days, int limit)
    {
        days = Math.Clamp(days, 1, 3650);
        limit = Math.Clamp(limit, 1, 500);
        var since = time.GetUtcNow().UtcDateTime.AddDays(-days);
        return await db.FocusSessions.Where(f => f.StartedAt >= since)
            .OrderByDescending(f => f.StartedAt).ThenByDescending(f => f.Id).Take(limit)
            .Select(f => new FocusSessionDto(f.Id, f.TaskId, f.Task!.Title, f.Kind, f.PlannedSeconds, f.ActualSeconds,
                f.Completed, f.StartedAt, f.EndedAt)).ToListAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var f = await db.FocusSessions.FindAsync(id) ?? throw ApiException.NotFound();
        db.FocusSessions.Remove(f);
        await db.SaveChangesAsync();
    }

    public async Task<FocusStatsDto> StatsAsync(int days)
    {
        days = Math.Clamp(days, 1, 365);
        var tz = time.LocalTimeZone;
        DateOnly Local(DateTime utc) =>
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz));
        var today = DateOnly.FromDateTime(time.GetLocalNow().DateTime);
        var weekStart = RecurrenceCalculator.MondayOf(today);

        var rows = await db.FocusSessions.AsNoTracking().Where(f => f.Kind == FocusKind.Focus)
            .Select(f => new { f.TaskId, f.ActualSeconds, f.Completed, f.StartedAt, Title = f.Task!.Title }).ToListAsync();
        var items = rows.Select(r => (r.TaskId, r.ActualSeconds, r.Completed, Day: Local(r.StartedAt), r.Title)).ToList();

        var byDay = items.GroupBy(x => x.Day).ToDictionary(g => g.Key, g => (Sec: g.Sum(x => x.ActualSeconds), N: g.Count(x => x.Completed)));
        var first = today.AddDays(-(days - 1));
        var daily = Enumerable.Range(0, days).Select(i =>
        {
            var d = first.AddDays(i);
            return byDay.TryGetValue(d, out var v) ? new FocusDay(d, v.Sec, v.N) : new FocusDay(d, 0, 0);
        }).ToList();

        // A streak is consecutive days with at least one *completed* focus session.
        var activeDays = items.Where(x => x.Completed).Select(x => x.Day).Distinct().Order().ToList();
        var best = 0; var run = 0; DateOnly? prev = null;
        foreach (var d in activeDays)
        {
            run = prev is { } p && d.DayNumber - p.DayNumber == 1 ? run + 1 : 1;
            best = Math.Max(best, run);
            prev = d;
        }
        var set = activeDays.ToHashSet();
        var cursor = set.Contains(today) ? today : today.AddDays(-1); // a streak is still alive until the day ends
        var current = 0;
        while (set.Contains(cursor)) { current++; cursor = cursor.AddDays(-1); }

        var completed = items.Where(x => x.Completed).ToList();
        var top = items.Where(x => x.TaskId != null)
            .GroupBy(x => x.TaskId!.Value)
            .Select(g => new FocusTaskStat(g.Key, g.First().Title ?? "(deleted task)", g.Sum(x => x.ActualSeconds), g.Count(x => x.Completed)))
            .OrderByDescending(x => x.Seconds).Take(5).ToList();

        return new FocusStatsDto(
            today,
            byDay.TryGetValue(today, out var t) ? t.Sec : 0, byDay.TryGetValue(today, out var t2) ? t2.N : 0,
            items.Where(x => x.Day >= weekStart && x.Day <= today).Sum(x => x.ActualSeconds),
            items.Sum(x => x.ActualSeconds), completed.Count, current, best,
            completed.Count == 0 ? 0 : Math.Round(completed.Average(x => x.ActualSeconds) / 60.0, 1),
            daily, top);
    }
}
