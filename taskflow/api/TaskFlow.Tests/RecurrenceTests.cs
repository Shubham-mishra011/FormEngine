using System.Net;
using System.Net.Http.Json;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Tests;

/// <summary>The date arithmetic on its own: no database, no clock beyond the "today" argument.</summary>
public class RecurrenceCalculatorTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    private static RecurrenceRule Rule(RecurrenceFrequency f, DateOnly anchor, int interval = 1,
        string? weekdays = null, string? monthDays = null, DateOnly? end = null) => new()
    {
        Frequency = f, AnchorDate = anchor, Interval = interval, Weekdays = weekdays, MonthDays = monthDays, EndDate = end,
    };

    [Fact]
    public void Daily_steps_by_the_interval_from_the_anchor()
    {
        var r = Rule(RecurrenceFrequency.Daily, D(2026, 10, 1), 3);
        Assert.Equal(D(2026, 10, 4), RecurrenceCalculator.NextAfter(r, D(2026, 10, 1), D(2026, 10, 1)));
        Assert.Equal(D(2026, 10, 7), RecurrenceCalculator.NextAfter(r, D(2026, 10, 4), D(2026, 10, 4)));
    }

    [Fact]
    public void Weekly_with_selected_weekdays_walks_through_the_week_then_wraps()
    {
        // Mon, Wed, Fri
        var r = Rule(RecurrenceFrequency.Weekly, D(2026, 10, 19), weekdays: "1,3,5");
        Assert.Equal(D(2026, 10, 21), RecurrenceCalculator.NextAfter(r, D(2026, 10, 19), D(2026, 10, 19)));
        Assert.Equal(D(2026, 10, 23), RecurrenceCalculator.NextAfter(r, D(2026, 10, 21), D(2026, 10, 21)));
        Assert.Equal(D(2026, 10, 26), RecurrenceCalculator.NextAfter(r, D(2026, 10, 23), D(2026, 10, 23)));
    }

    [Fact]
    public void Weekly_every_two_weeks_skips_the_off_week()
    {
        var r = Rule(RecurrenceFrequency.Weekly, D(2026, 10, 19), 2, "1");
        Assert.Equal(D(2026, 11, 2), RecurrenceCalculator.NextAfter(r, D(2026, 10, 19), D(2026, 10, 19)));
    }

    [Fact]
    public void Weekly_without_weekdays_repeats_on_the_anchors_weekday()
    {
        var r = Rule(RecurrenceFrequency.Weekly, D(2026, 10, 22)); // Thursday
        Assert.Equal(D(2026, 10, 29), RecurrenceCalculator.NextAfter(r, D(2026, 10, 22), D(2026, 10, 22)));
    }

    [Fact]
    public void Monthly_on_the_31st_uses_the_last_day_of_short_months_and_does_not_drift()
    {
        var r = Rule(RecurrenceFrequency.Monthly, D(2026, 1, 31));
        var feb = RecurrenceCalculator.NextAfter(r, D(2026, 1, 31), D(2026, 1, 31));
        Assert.Equal(D(2026, 2, 28), feb);
        var mar = RecurrenceCalculator.NextAfter(r, feb!.Value, feb.Value);
        Assert.Equal(D(2026, 3, 31), mar);   // back to the 31st, not stuck on the 28th
        Assert.Equal(D(2026, 4, 30), RecurrenceCalculator.NextAfter(r, mar!.Value, mar.Value));
    }

    [Fact]
    public void Monthly_on_the_29th_handles_leap_years()
    {
        var r = Rule(RecurrenceFrequency.Monthly, D(2027, 12, 29));
        Assert.Equal(D(2028, 1, 29), RecurrenceCalculator.NextAfter(r, D(2027, 12, 29), D(2027, 12, 29)));
        Assert.Equal(D(2028, 2, 29), RecurrenceCalculator.NextAfter(r, D(2028, 1, 29), D(2028, 1, 29)));
        Assert.Equal(D(2029, 2, 28), RecurrenceCalculator.NextAfter(r, D(2029, 1, 29), D(2029, 1, 29)));
    }

    [Fact]
    public void Monthly_with_several_days_and_with_last_day()
    {
        var r = Rule(RecurrenceFrequency.Monthly, D(2026, 10, 1), monthDays: "1,15");
        Assert.Equal(D(2026, 10, 15), RecurrenceCalculator.NextAfter(r, D(2026, 10, 1), D(2026, 10, 1)));
        Assert.Equal(D(2026, 11, 1), RecurrenceCalculator.NextAfter(r, D(2026, 10, 15), D(2026, 10, 15)));

        var last = Rule(RecurrenceFrequency.Monthly, D(2026, 1, 31), monthDays: "-1");
        Assert.Equal(D(2026, 2, 28), RecurrenceCalculator.NextAfter(last, D(2026, 1, 31), D(2026, 1, 31)));
    }

    [Fact]
    public void Monthly_every_three_months()
    {
        var r = Rule(RecurrenceFrequency.Monthly, D(2026, 10, 15), 3);
        Assert.Equal(D(2027, 1, 15), RecurrenceCalculator.NextAfter(r, D(2026, 10, 15), D(2026, 10, 15)));
    }

    [Fact]
    public void Yearly_on_feb_29_falls_back_to_feb_28_in_common_years()
    {
        var r = Rule(RecurrenceFrequency.Yearly, D(2028, 2, 29));
        Assert.Equal(D(2029, 2, 28), RecurrenceCalculator.NextAfter(r, D(2028, 2, 29), D(2028, 2, 29)));
        Assert.Equal(D(2032, 2, 29), RecurrenceCalculator.NextAfter(r, D(2031, 2, 28), D(2031, 2, 28)));
    }

    [Fact]
    public void Missed_occurrences_are_skipped_not_queued()
    {
        // Completed three weeks late: the next one is the first scheduled date on or after today, not a backlog.
        var r = Rule(RecurrenceFrequency.Daily, D(2026, 10, 1));
        Assert.Equal(D(2026, 10, 22), RecurrenceCalculator.NextAfter(r, D(2026, 10, 1), D(2026, 10, 22)));

        var weekly = Rule(RecurrenceFrequency.Weekly, D(2026, 10, 5), weekdays: "1"); // Mondays
        Assert.Equal(D(2026, 10, 26), RecurrenceCalculator.NextAfter(weekly, D(2026, 10, 5), D(2026, 10, 22)));
    }

    [Fact]
    public void Completing_early_still_moves_forward_from_the_due_date()
    {
        var r = Rule(RecurrenceFrequency.Daily, D(2026, 10, 10));
        Assert.Equal(D(2026, 10, 11), RecurrenceCalculator.NextAfter(r, D(2026, 10, 10), D(2026, 10, 1)));
    }

    [Fact]
    public void End_date_stops_the_series()
    {
        var r = Rule(RecurrenceFrequency.Daily, D(2026, 10, 1), end: D(2026, 10, 3));
        Assert.Equal(D(2026, 10, 3), RecurrenceCalculator.NextAfter(r, D(2026, 10, 2), D(2026, 10, 2)));
        Assert.Null(RecurrenceCalculator.NextAfter(r, D(2026, 10, 3), D(2026, 10, 3)));
    }

    [Fact]
    public void Max_occurrences_limit()
    {
        var r = new RecurrenceRule { MaxOccurrences = 3, OccurrencesGenerated = 2 };
        Assert.True(RecurrenceCalculator.HasRemaining(r));
        r.OccurrencesGenerated = 3;
        Assert.False(RecurrenceCalculator.HasRemaining(r));
        Assert.True(RecurrenceCalculator.HasRemaining(new RecurrenceRule { MaxOccurrences = null, OccurrencesGenerated = 999 }));
    }

    [Theory]
    [InlineData("1,3,5", new[] { 1, 3, 5 })]
    [InlineData("5, 1,1", new[] { 1, 5 })]
    [InlineData("", new int[0])]
    [InlineData(null, new int[0])]
    [InlineData("x,2", new[] { 2 })]
    public void List_parsing_is_forgiving_and_sorted(string? csv, int[] expected) =>
        Assert.Equal(expected, RecurrenceCalculator.ParseList(csv));
}

/// <summary>Recurrence through the real API with a controllable clock.</summary>
public class RecurrenceApiTests : TestBase
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 12, 0, 0, TimeSpan.Zero); // a Wednesday
    private readonly FixedTimeProvider _clock;

    public RecurrenceApiTests() : this(new FixedTimeProvider(Now)) { }
    private RecurrenceApiTests(FixedTimeProvider clock) : base(new ApiFactory(clock: clock)) => _clock = clock;

    private static string Day(int offset = 0) => DateOnly.FromDateTime(Now.UtcDateTime).AddDays(offset).ToString("yyyy-MM-dd");

    private async Task<TaskDto> Toggle(int id)
    {
        var res = await Http.PatchAsync($"/api/tasks/{id}/toggle", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await Read<TaskDto>(res);
    }

    private Task<List<TaskDto>> Series(int id) => Http.GetFromJsonAsync<List<TaskDto>>($"/api/tasks/{id}/occurrences", Json)!;

    [Fact]
    public async Task Completing_an_occurrence_creates_exactly_the_next_one()
    {
        var t = await CreateTask(new { title = "Water plants", dueDate = Day(), notes = "n", priority = "High", recurrence = new { frequency = "Daily" } });
        Assert.NotNull(t.Recurrence);
        Assert.Equal(1, t.OccurrenceNumber);
        Assert.Equal(Day(1), t.Recurrence!.NextDue!.Value.ToString("yyyy-MM-dd"));

        var done = await Toggle(t.Id);
        Assert.True(done.IsCompleted);

        var all = await Tasks();
        Assert.Equal(2, all.Count);
        var next = all.Single(x => x.Id != t.Id);
        Assert.Equal("Water plants", next.Title);
        Assert.Equal(Day(1), next.DueDate!.Value.ToString("yyyy-MM-dd"));
        Assert.Equal(2, next.OccurrenceNumber);
        Assert.False(next.IsCompleted);
        Assert.Equal(Priority.High, next.Priority);
        Assert.Equal(t.Recurrence.Id, next.Recurrence!.Id);
    }

    [Fact]
    public async Task Reopening_and_completing_again_never_duplicates_an_occurrence()
    {
        var t = await CreateTask(new { title = "Standup", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        await Toggle(t.Id);                 // complete -> occurrence 2 created
        await Toggle(t.Id);                 // reopen
        await Toggle(t.Id);                 // complete again
        await Toggle(t.Id);
        await Toggle(t.Id);
        Assert.Equal(2, (await Tasks()).Count);
        Assert.Equal([1, 2], (await Series(t.Id)).Select(x => x.OccurrenceNumber));
    }

    [Fact]
    public async Task Parallel_completions_still_create_one_next_occurrence()
    {
        var t = await CreateTask(new { title = "Race", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        // Two requests complete the same occurrence "at once"; whichever order they land in, only one next task may exist.
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Http.PatchAsync($"/api/tasks/{t.Id}/status", JsonContent.Create(new { status = "Done" }, options: Json))));
        Assert.All(results, r => Assert.True(r.IsSuccessStatusCode, r.StatusCode.ToString()));
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task Weekly_on_selected_weekdays()
    {
        // Wednesday 21st, repeating Mon/Wed/Fri.
        var t = await CreateTask(new { title = "Gym", dueDate = Day(), recurrence = new { frequency = "Weekly", weekdays = new[] { 1, 3, 5 } } });
        await Toggle(t.Id);
        var next = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal(Day(2), next.DueDate!.Value.ToString("yyyy-MM-dd")); // Friday
        Assert.Equal([1, 3, 5], next.Recurrence!.Weekdays);
    }

    [Fact]
    public async Task Missed_occurrences_do_not_pile_up_and_are_not_auto_completed()
    {
        var t = await CreateTask(new { title = "Report", dueDate = Day(-10), recurrence = new { frequency = "Daily" } });
        // Ten days overdue. Nothing is generated or completed until the user acts.
        Assert.Single(await Tasks());
        Assert.False((await GetTask(t.Id)).IsCompleted);

        await Toggle(t.Id);
        var next = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal(Day(0), next.DueDate!.Value.ToString("yyyy-MM-dd")); // today, not 9 days of backlog
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task Month_end_does_not_drift()
    {
        _clock.Set(new DateTimeOffset(2026, 1, 31, 8, 0, 0, TimeSpan.Zero));
        var t = await CreateTask(new { title = "Rent", dueDate = "2026-01-31", recurrence = new { frequency = "Monthly" } });
        var feb = (await Toggle(t.Id)); Assert.True(feb.IsCompleted);
        var second = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal("2026-02-28", second.DueDate!.Value.ToString("yyyy-MM-dd"));
        _clock.Set(new DateTimeOffset(2026, 2, 28, 8, 0, 0, TimeSpan.Zero));
        await Toggle(second.Id);
        var third = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal("2026-03-31", third.DueDate!.Value.ToString("yyyy-MM-dd"));
    }

    [Fact]
    public async Task Max_occurrences_ends_the_series()
    {
        var t = await CreateTask(new { title = "Twice", dueDate = Day(), recurrence = new { frequency = "Daily", maxOccurrences = 2 } });
        await Toggle(t.Id);
        var second = (await Tasks()).Single(x => !x.IsCompleted);
        await Toggle(second.Id);
        var all = await Tasks();
        Assert.Equal(2, all.Count);
        Assert.All(all, x => Assert.True(x.IsCompleted));
        Assert.False(all[0].Recurrence!.IsActive);
    }

    [Fact]
    public async Task End_date_ends_the_series()
    {
        var t = await CreateTask(new { title = "Short", dueDate = Day(), recurrence = new { frequency = "Daily", endDate = Day(1) } });
        await Toggle(t.Id);
        var second = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal(Day(1), second.DueDate!.Value.ToString("yyyy-MM-dd"));
        await Toggle(second.Id);
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task Stopping_recurrence_keeps_the_task_but_makes_no_more()
    {
        var t = await CreateTask(new { title = "Stoppable", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        var stopped = await Read<TaskDto>(await Http.PostAsync($"/api/tasks/{t.Id}/recurrence/stop", null));
        Assert.False(stopped.Recurrence!.IsActive);
        await Toggle(t.Id);
        Assert.Single(await Tasks());
    }

    [Fact]
    public async Task Stopping_a_non_repeating_task_is_a_400()
    {
        var t = await CreateTask(new { title = "Plain" });
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsync($"/api/tasks/{t.Id}/recurrence/stop", null)).StatusCode);
    }

    [Fact]
    public async Task Editing_a_task_without_a_recurrence_field_preserves_the_recurrence()
    {
        var t = await CreateTask(new { title = "Keep", dueDate = Day(), recurrence = new { frequency = "Weekly", interval = 2, weekdays = new[] { 2 } } });
        var res = await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Keep (renamed)", dueDate = Day() }, Json);
        var updated = await Read<TaskDto>(res);
        Assert.Equal("Keep (renamed)", updated.Title);
        Assert.Equal(RecurrenceFrequency.Weekly, updated.Recurrence!.Frequency);
        Assert.Equal(2, updated.Recurrence.Interval);
        Assert.Equal([2], updated.Recurrence.Weekdays);
        Assert.True(updated.Recurrence.IsActive);
    }

    [Fact]
    public async Task Editing_the_recurrence_changes_future_occurrences_and_can_restart_a_stopped_series()
    {
        var t = await CreateTask(new { title = "Edit me", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        await Http.PostAsync($"/api/tasks/{t.Id}/recurrence/stop", null);
        var res = await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Edit me", dueDate = Day(), recurrence = new { frequency = "Daily", interval = 3 } }, Json);
        var updated = await Read<TaskDto>(res);
        Assert.True(updated.Recurrence!.IsActive);
        Assert.Equal(3, updated.Recurrence.Interval);
        await Toggle(t.Id);
        Assert.Equal(Day(3), (await Tasks()).Single(x => !x.IsCompleted).DueDate!.Value.ToString("yyyy-MM-dd"));
    }

    [Fact]
    public async Task Next_occurrence_copies_tags_subtasks_as_unchecked_and_reminders()
    {
        var tag = await Read<TagDto>(await Http.PostAsJsonAsync("/api/tags", new { name = "home" }, Json));
        var t = await CreateTask(new
        {
            title = "Chores", dueDate = Day(), dueTime = "18:00", tagIds = new[] { tag.Id },
            reminders = new[] { new { minutesBefore = 30 } }, recurrence = new { frequency = "Daily" },
        });
        var sub = await CreateSubtask(t.Id, "Dishes", done: true);
        Assert.True(sub.IsCompleted);
        await Toggle(t.Id);

        var next = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal(["home"], next.Tags.Select(x => x.Name));
        var copied = Assert.Single(next.Subtasks);
        Assert.Equal("Dishes", copied.Title);
        Assert.False(copied.IsCompleted);
        Assert.Equal("18:00", next.DueTime!.Value.ToString("HH:mm"));
        var reminder = Assert.Single(next.Reminders);
        Assert.Equal(30, reminder.MinutesBefore);
        Assert.Equal(new DateTime(2026, 10, 22, 17, 30, 0, DateTimeKind.Utc), reminder.RemindAt);
    }

    [Fact]
    public async Task Completing_via_the_board_status_also_spawns_the_next_occurrence()
    {
        var t = await CreateTask(new { title = "Board", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        await Http.PatchAsJsonAsync($"/api/tasks/{t.Id}/status", new { status = "Done" }, Json);
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task Skip_moves_on_without_counting_as_completed()
    {
        var t = await CreateTask(new { title = "Skippable", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        var res = await Http.PostAsync($"/api/tasks/{t.Id}/skip", null);
        var next = await Read<TaskDto>(res);
        Assert.Equal(2, next.OccurrenceNumber);
        var all = await Tasks();
        Assert.Single(all);
        Assert.Equal(0, all.Count(x => x.IsCompleted));
    }

    [Fact]
    public async Task Deleting_the_only_open_occurrence_ends_the_series_but_keeps_history()
    {
        var t = await CreateTask(new { title = "Series", dueDate = Day(), recurrence = new { frequency = "Daily" } });
        await Toggle(t.Id);
        var open = (await Tasks()).Single(x => !x.IsCompleted);
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/tasks/{open.Id}")).StatusCode);
        var remaining = Assert.Single(await Tasks());
        Assert.True(remaining.IsCompleted);
        Assert.False(remaining.Recurrence!.IsActive);
    }

    [Theory]
    [InlineData("""{"title":"x","recurrence":{"frequency":"Hourly"}}""")]
    [InlineData("""{"title":"x","recurrence":{"frequency":"Daily","interval":0}}""")]
    [InlineData("""{"title":"x","recurrence":{"frequency":"Daily","weekdays":[1]}}""")]
    [InlineData("""{"title":"x","recurrence":{"frequency":"Weekly","weekdays":[7]}}""")]
    [InlineData("""{"title":"x","recurrence":{"frequency":"Monthly","monthDays":[32]}}""")]
    [InlineData("""{"title":"x","recurrence":{"frequency":"Daily","maxOccurrences":0}}""")]
    [InlineData("""{"title":"x","dueDate":"2026-10-21","recurrence":{"frequency":"Daily","endDate":"2026-10-01"}}""")]
    public async Task Invalid_recurrence_is_rejected(string body)
    {
        var res = await Http.PostAsync("/api/tasks", Raw(body));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Empty(await Tasks());
    }

    [Fact]
    public async Task A_recurring_task_with_no_due_date_anchors_on_today()
    {
        var t = await CreateTask(new { title = "Floating", recurrence = new { frequency = "Daily" } });
        Assert.Equal(Day(), t.Recurrence!.AnchorDate.ToString("yyyy-MM-dd"));
        await Toggle(t.Id);
        Assert.Equal(Day(1), (await Tasks()).Single(x => !x.IsCompleted).DueDate!.Value.ToString("yyyy-MM-dd"));
    }

    [Fact]
    public async Task Recurrence_survives_export_and_import()
    {
        var t = await CreateTask(new { title = "Exported", dueDate = Day(), recurrence = new { frequency = "Weekly", weekdays = new[] { 1, 4 }, interval = 2 } });
        await Toggle(t.Id);
        var json = await Http.GetStringAsync("/api/export");
        await Http.DeleteAsync("/api/tasks/completed");
        foreach (var x in await Tasks()) await Http.DeleteAsync($"/api/tasks/{x.Id}");

        var res = await Import(json);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var all = await Tasks();
        Assert.Equal(2, all.Count);
        Assert.Equal([1, 2], all.OrderBy(x => x.OccurrenceNumber).Select(x => x.OccurrenceNumber));
        var rule = all[0].Recurrence!;
        Assert.Equal(RecurrenceFrequency.Weekly, rule.Frequency);
        Assert.Equal([1, 4], rule.Weekdays);
        Assert.Equal(2, rule.Interval);
        Assert.Equal(all[0].Recurrence!.Id, all[1].Recurrence!.Id);
    }
}
