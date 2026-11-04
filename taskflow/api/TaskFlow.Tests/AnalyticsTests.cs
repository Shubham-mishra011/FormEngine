using System.Net;
using System.Net.Http.Json;
using TaskFlow.Api.Controllers;
using TaskFlow.Api.Dtos;

namespace TaskFlow.Tests;

/// <summary>Wednesday 2026-10-21 12:00 UTC, so the Monday-based week started on 2026-10-19.</summary>
public class AnalyticsTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 12, 0, 0, TimeSpan.Zero);
    private readonly FixedTimeProvider _clock;
    private readonly ApiFactory _factory;
    private readonly HttpClient _http;

    public AnalyticsTests() : this(null) { }

    private AnalyticsTests(TimeZoneInfo? zone)
    {
        _clock = new FixedTimeProvider(Now, zone);
        _factory = new ApiFactory(clock: _clock);
        _http = _factory.CreateClient();
    }

    public void Dispose() { _http.Dispose(); _factory.Dispose(); }

    private async Task<TaskDto> Create(object body, DateTimeOffset? at = null)
    {
        if (at is not null) _clock.Set(at.Value);
        var res = await _http.PostAsJsonAsync("/api/tasks", body, TestBase.Json);
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<TaskDto>(TestBase.Json))!;
    }

    private async Task Complete(TaskDto t, DateTimeOffset at)
    {
        _clock.Set(at);
        (await _http.PatchAsync($"/api/tasks/{t.Id}/toggle", null)).EnsureSuccessStatusCode();
    }

    private async Task<AnalyticsDto> Get(string query = "")
    {
        _clock.Set(Now);
        return (await _http.GetFromJsonAsync<AnalyticsDto>("/api/analytics" + query, TestBase.Json))!;
    }

    [Fact]
    public async Task Empty_database_gives_zeros_and_a_full_zero_filled_series()
    {
        var a = await Get();
        Assert.Equal(new DateOnly(2026, 10, 21), a.Today);
        Assert.Equal(new DateOnly(2026, 10, 19), a.WeekStart);
        Assert.Equal(0, a.Total);
        Assert.Equal(0, a.CompletedToday);
        Assert.Equal(0, a.CompletionRate);
        Assert.Null(a.AverageHoursToComplete);
        Assert.Equal(30, a.Daily.Count);
        Assert.All(a.Daily, d => { Assert.Equal(0, d.Created); Assert.Equal(0, d.Completed); });
        Assert.Equal(new DateOnly(2026, 9, 22), a.Daily[0].Date);
        Assert.Equal(a.Today, a.Daily[^1].Date);
        Assert.Equal(4, a.ByPriority.Count);
        Assert.Empty(a.ByCategory);
    }

    [Fact]
    public async Task Counts_completed_today_and_this_week_using_calendar_days()
    {
        var t1 = await Create(new { title = "today" }, Now.AddDays(-5));
        var t2 = await Create(new { title = "monday" });
        var t3 = await Create(new { title = "last sunday" });
        var t4 = await Create(new { title = "open" });
        await Complete(t1, new DateTimeOffset(2026, 10, 21, 0, 0, 1, TimeSpan.Zero));      // today, just after midnight
        await Complete(t2, new DateTimeOffset(2026, 10, 19, 23, 59, 59, TimeSpan.Zero));   // Monday = start of week
        await Complete(t3, new DateTimeOffset(2026, 10, 18, 23, 59, 59, TimeSpan.Zero));   // Sunday = previous week

        var a = await Get();
        Assert.Equal(1, a.CompletedToday);
        Assert.Equal(2, a.CompletedThisWeek);
        Assert.Equal(4, a.Total);
        Assert.Equal(3, a.Completed);
        Assert.Equal(1, a.Active);
        Assert.Equal(0.75, a.CompletionRate, 5);
        Assert.NotNull(t4);
    }

    [Fact]
    public async Task Reopening_a_task_removes_it_from_the_completed_counts()
    {
        var t = await Create(new { title = "x" });
        await Complete(t, Now);
        Assert.Equal(1, (await Get()).CompletedToday);
        await Complete(t, Now.AddMinutes(1)); // toggle back
        var a = await Get();
        Assert.Equal(0, a.CompletedToday);
        Assert.Equal(0, a.Completed);
    }

    [Fact]
    public async Task Daily_series_puts_created_and_completed_on_the_right_days()
    {
        var a1 = await Create(new { title = "a" }, new DateTimeOffset(2026, 10, 19, 8, 0, 0, TimeSpan.Zero));
        await Create(new { title = "b" }, new DateTimeOffset(2026, 10, 19, 9, 0, 0, TimeSpan.Zero));
        await Complete(a1, new DateTimeOffset(2026, 10, 20, 10, 0, 0, TimeSpan.Zero));

        var a = await Get("?days=7");
        Assert.Equal(7, a.Daily.Count);
        Assert.Equal(new DateOnly(2026, 10, 15), a.Daily[0].Date);
        var mon = a.Daily.Single(d => d.Date == new DateOnly(2026, 10, 19));
        var tue = a.Daily.Single(d => d.Date == new DateOnly(2026, 10, 20));
        Assert.Equal((2, 0), (mon.Created, mon.Completed));
        Assert.Equal((0, 1), (tue.Created, tue.Completed));
        Assert.Equal(2, a.CreatedThisWeek);
        Assert.Equal(0, a.CreatedToday);
    }

    [Fact]
    public async Task Days_outside_the_window_are_excluded_from_the_series_but_not_from_totals()
    {
        var old = await Create(new { title = "old" }, Now.AddDays(-100));
        await Complete(old, Now.AddDays(-99));
        var a = await Get("?days=7");
        Assert.All(a.Daily, d => Assert.Equal(0, d.Completed));
        Assert.Equal(1, a.Completed);
        Assert.Equal(1, a.Total);
    }

    [Fact]
    public async Task Breakdown_by_priority_and_category_uses_all_tasks_and_includes_uncategorised()
    {
        var work = (await (await _http.PostAsJsonAsync("/api/categories", new { name = "Work", color = "#aa0000" }, TestBase.Json))
            .Content.ReadFromJsonAsync<CategoryDto>(TestBase.Json))!;
        var h = await Create(new { title = "h", priority = "High", categoryId = work.Id });
        await Create(new { title = "h2", priority = "High", categoryId = work.Id });
        await Create(new { title = "l", priority = "Low" });
        await Complete(h, Now);

        var a = await Get();
        Assert.Equal(["Urgent", "High", "Medium", "Low"], a.ByPriority.Select(p => p.Priority));
        Assert.Equal((2, 1), (a.ByPriority[1].Total, a.ByPriority[1].Completed));
        Assert.Equal((0, 0), (a.ByPriority[2].Total, a.ByPriority[2].Completed));
        Assert.Equal((1, 0), (a.ByPriority[3].Total, a.ByPriority[3].Completed));

        Assert.Equal(["Work", "Uncategorised"], a.ByCategory.Select(c => c.Name));
        Assert.Equal((2, 1, "#aa0000"), (a.ByCategory[0].Total, a.ByCategory[0].Completed, a.ByCategory[0].Color));
        Assert.Null(a.ByCategory[1].CategoryId);
        Assert.Null(a.ByCategory[1].Color);
    }

    [Fact]
    public async Task Average_time_to_complete_is_measured_in_hours()
    {
        var a1 = await Create(new { title = "a" }, new DateTimeOffset(2026, 10, 20, 8, 0, 0, TimeSpan.Zero));
        var b1 = await Create(new { title = "b" }, new DateTimeOffset(2026, 10, 20, 8, 0, 0, TimeSpan.Zero));
        await Complete(a1, new DateTimeOffset(2026, 10, 20, 10, 0, 0, TimeSpan.Zero));   // 2 h
        await Complete(b1, new DateTimeOffset(2026, 10, 20, 16, 0, 0, TimeSpan.Zero));   // 8 h
        Assert.Equal(5.0, (await Get()).AverageHoursToComplete!.Value, 2);
    }

    [Fact]
    public async Task Overdue_matches_the_tasks_stats_endpoint()
    {
        await Create(new { title = "late", dueDate = "2026-10-20" }, Now);
        await Create(new { title = "today", dueDate = "2026-10-21" });
        _clock.Set(Now);
        var stats = (await _http.GetFromJsonAsync<StatsDto>("/api/tasks/stats", TestBase.Json))!;
        var a = await Get();
        Assert.Equal(stats.Overdue, a.Overdue);
        Assert.Equal(1, a.Overdue);
        Assert.Equal(stats.Total, a.Total);
        Assert.Equal(stats.Completed, a.Completed);
    }

    [Theory]
    [InlineData("?days=0")]
    [InlineData("?days=-1")]
    [InlineData("?days=366")]
    [InlineData("?days=abc")]
    public async Task Invalid_day_windows_are_rejected(string query)
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _http.GetAsync("/api/analytics" + query)).StatusCode);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(365)]
    public async Task Window_limits_are_accepted(int days)
    {
        Assert.Equal(days, (await Get($"?days={days}")).Daily.Count);
    }

    [Fact]
    public async Task Local_time_zone_decides_which_day_a_completion_belongs_to()
    {
        // UTC+10: the instant 2026-10-20T20:00Z is already 06:00 on 21 October locally.
        var zone = TimeZoneInfo.CreateCustomTimeZone("test+10", TimeSpan.FromHours(10), "test+10", "test+10");
        using var t = new AnalyticsTests(zone);
        var task = await t.Create(new { title = "x" }, new DateTimeOffset(2026, 10, 20, 1, 0, 0, TimeSpan.Zero));
        await t.Complete(task, new DateTimeOffset(2026, 10, 20, 20, 0, 0, TimeSpan.Zero));

        t._clock.Set(new DateTimeOffset(2026, 10, 21, 3, 0, 0, TimeSpan.Zero)); // 13:00 local on the 21st
        var a = (await t._http.GetFromJsonAsync<AnalyticsDto>("/api/analytics", TestBase.Json))!;
        Assert.Equal(new DateOnly(2026, 10, 21), a.Today);
        Assert.Equal(1, a.CompletedToday);
        Assert.Equal(1, a.Daily.Single(d => d.Date == new DateOnly(2026, 10, 21)).Completed);
        Assert.Equal(0, a.Daily.Single(d => d.Date == new DateOnly(2026, 10, 20)).Completed);
    }

    [Fact]
    public async Task Week_starts_on_monday_even_when_today_is_sunday()
    {
        var sunday = new DateTimeOffset(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);
        var t = await Create(new { title = "x" }, new DateTimeOffset(2026, 10, 19, 0, 0, 0, TimeSpan.Zero));
        await Complete(t, new DateTimeOffset(2026, 10, 19, 1, 0, 0, TimeSpan.Zero));
        _clock.Set(sunday);
        var a = (await _http.GetFromJsonAsync<AnalyticsDto>("/api/analytics", TestBase.Json))!;
        Assert.Equal(new DateOnly(2026, 10, 19), a.WeekStart);
        Assert.Equal(1, a.CompletedThisWeek);
    }

    [Fact]
    public async Task Results_reflect_real_persisted_data_not_a_cache()
    {
        Assert.Equal(0, (await Get()).Total);
        await Create(new { title = "one" }, Now);
        Assert.Equal(1, (await Get()).Total);
        await _http.DeleteAsync("/api/tasks/1");
        Assert.Equal(0, (await Get()).Total);
    }
}
