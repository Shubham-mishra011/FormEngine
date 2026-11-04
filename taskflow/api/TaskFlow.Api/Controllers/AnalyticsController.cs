using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Controllers;

public record DailyPoint(DateOnly Date, int Created, int Completed);
public record PriorityStat(string Priority, int Total, int Completed);
public record CategoryStat(int? CategoryId, string Name, string? Color, int Total, int Completed);
public record PeriodPoint(DateOnly Start, string Label, int Created, int Completed);
public record OverdueStats(int Count, int OldestDays, List<PriorityStat> ByPriority);

public record AnalyticsDto(
    DateOnly Today, DateOnly WeekStart, int Days,
    int CompletedToday, int CompletedThisWeek, int CreatedToday, int CreatedThisWeek,
    int Total, int Completed, int Active, int Overdue,
    double CompletionRate, double? AverageHoursToComplete,
    List<DailyPoint> Daily, List<PriorityStat> ByPriority, List<CategoryStat> ByCategory,
    int CompletedThisMonth = 0, int CreatedThisMonth = 0, int CurrentStreak = 0, int BestStreak = 0,
    List<PeriodPoint>? Weekly = null, List<PeriodPoint>? Monthly = null, OverdueStats? OverdueDetail = null,
    int AverageCompletedPerActiveDay = 0);

/// <summary>
/// Read-only statistics over persisted tasks. Timestamps are stored in UTC; "today" and the week are
/// calendar days in the server's local time zone, exactly like the due-date logic in the tasks API.
/// The week starts on Monday.
/// </summary>
[ApiController]
[Route("api/analytics")]
public class AnalyticsController(TaskFlowDbContext db, TimeProvider time) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<AnalyticsDto>> Get(int days = 30)
    {
        if (days is < 1 or > 365)
            return BadRequest(new ProblemDetails { Title = "days must be between 1 and 365." });

        var tz = time.LocalTimeZone;
        DateOnly LocalDay(DateTime utc) =>
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), tz));

        var today = DateOnly.FromDateTime(time.GetLocalNow().DateTime);
        var weekStart = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        var first = today.AddDays(-(days - 1));

        var tasks = await db.Tasks.AsNoTracking()
            .Select(t => new { t.IsCompleted, t.Priority, t.CategoryId, t.DueDate, t.CreatedAt, t.CompletedAt })
            .ToListAsync();
        var categories = await db.Categories.AsNoTracking().ToDictionaryAsync(c => c.Id);

        var created = tasks.GroupBy(t => LocalDay(t.CreatedAt)).ToDictionary(g => g.Key, g => g.Count());
        var completedDays = tasks.Where(t => t is { IsCompleted: true, CompletedAt: not null })
            .GroupBy(t => LocalDay(t.CompletedAt!.Value)).ToDictionary(g => g.Key, g => g.Count());

        int Sum(Dictionary<DateOnly, int> d, DateOnly from, DateOnly to) =>
            d.Where(kv => kv.Key >= from && kv.Key <= to).Sum(kv => kv.Value);

        var daily = Enumerable.Range(0, days).Select(i =>
        {
            var d = first.AddDays(i);
            return new DailyPoint(d, created.GetValueOrDefault(d), completedDays.GetValueOrDefault(d));
        }).ToList();

        var total = tasks.Count;
        var completed = tasks.Count(t => t.IsCompleted);
        var overdue = tasks.Count(t => !t.IsCompleted && t.DueDate < today);

        var durations = tasks.Where(t => t is { IsCompleted: true, CompletedAt: not null })
            .Select(t => (t.CompletedAt!.Value - t.CreatedAt).TotalHours).Where(h => h >= 0).ToList();

        var byPriority = Enum.GetValues<Priority>().OrderByDescending(p => p)
            .Select(p => new PriorityStat(p.ToString(),
                tasks.Count(t => t.Priority == p), tasks.Count(t => t.Priority == p && t.IsCompleted)))
            .ToList();

        var byCategory = tasks.GroupBy(t => t.CategoryId)
            .Select(g => new CategoryStat(
                g.Key,
                g.Key is int id && categories.TryGetValue(id, out var c) ? c.Name : "Uncategorised",
                g.Key is int id2 && categories.TryGetValue(id2, out var c2) ? c2.Color : null,
                g.Count(), g.Count(t => t.IsCompleted)))
            .OrderByDescending(c => c.Total).ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        // ---- weekly (Monday-based) and monthly trends, from the same persisted timestamps ----
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var weekly = Enumerable.Range(0, 12).Select(i =>
        {
            var start = weekStart.AddDays(-7 * (11 - i));
            var end = start.AddDays(6);
            return new PeriodPoint(start, start.ToString("MMM d"), Sum(created, start, end), Sum(completedDays, start, end));
        }).ToList();
        var monthly = Enumerable.Range(0, 12).Select(i =>
        {
            var start = monthStart.AddMonths(-(11 - i));
            var end = start.AddMonths(1).AddDays(-1);
            return new PeriodPoint(start, start.ToString("MMM yyyy"), Sum(created, start, end), Sum(completedDays, start, end));
        }).ToList();

        // A streak is consecutive local days on which at least one task was completed. It stays alive through today
        // until the day ends, so having not yet completed anything today does not zero it.
        var active = completedDays.Keys.OrderBy(d => d).ToList();
        int best = 0, run = 0; DateOnly? prev = null;
        foreach (var d in active)
        {
            run = prev is { } p && d.DayNumber - p.DayNumber == 1 ? run + 1 : 1;
            best = Math.Max(best, run);
            prev = d;
        }
        var cursor = completedDays.ContainsKey(today) ? today : today.AddDays(-1);
        var current = 0;
        while (completedDays.ContainsKey(cursor)) { current++; cursor = cursor.AddDays(-1); }

        var overdueTasks = tasks.Where(t => !t.IsCompleted && t.DueDate < today).ToList();
        var overdueDetail = new OverdueStats(
            overdueTasks.Count,
            overdueTasks.Count == 0 ? 0 : overdueTasks.Max(t => today.DayNumber - t.DueDate!.Value.DayNumber),
            Enum.GetValues<Priority>().OrderByDescending(p => p)
                .Select(p => new PriorityStat(p.ToString(), overdueTasks.Count(t => t.Priority == p), 0)).ToList());

        return new AnalyticsDto(
            today, weekStart, days,
            completedDays.GetValueOrDefault(today), Sum(completedDays, weekStart, today),
            created.GetValueOrDefault(today), Sum(created, weekStart, today),
            total, completed, total - completed, overdue,
            total == 0 ? 0 : (double)completed / total,
            durations.Count == 0 ? null : Math.Round(durations.Average(), 2),
            daily, byPriority, byCategory,
            Sum(completedDays, monthStart, today), Sum(created, monthStart, today), current, best,
            weekly, monthly, overdueDetail);
    }
}
