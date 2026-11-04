using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Tests;

public class ReminderTests : TestBase
{
    private static readonly DateTimeOffset Start = new(2026, 10, 21, 12, 0, 0, TimeSpan.Zero);
    private readonly FixedTimeProvider _clock;

    public ReminderTests() : this(new FixedTimeProvider(Start)) { }
    private ReminderTests(FixedTimeProvider clock) : base(new ApiFactory(clock: clock)) => _clock = clock;

    private async Task<NotificationList> Notes() => (await Http.GetFromJsonAsync<NotificationList>("/api/notifications", Json))!;
    private async Task<int> Sync(bool overdue = false) =>
        (await Http.PostAsync($"/api/notifications/sync?overdue={overdue.ToString().ToLowerInvariant()}", null)).IsSuccessStatusCode
            ? (await Notes()).Items.Count : -1;

    [Fact]
    public async Task A_relative_reminder_is_computed_from_the_due_date_and_time()
    {
        var t = await CreateTask(new { title = "Call", dueDate = "2026-10-21", dueTime = "14:00", reminders = new[] { new { minutesBefore = 60 }, new { minutesBefore = 1440 } } });
        Assert.Equal(2, t.Reminders.Count);
        Assert.Equal(new DateTime(2026, 10, 20, 14, 0, 0, DateTimeKind.Utc), t.Reminders.Min(r => r.RemindAt));
        Assert.Equal(new DateTime(2026, 10, 21, 13, 0, 0, DateTimeKind.Utc), t.Reminders.Max(r => r.RemindAt));
    }

    [Fact]
    public async Task A_date_only_task_measures_from_nine_in_the_morning()
    {
        var t = await CreateTask(new { title = "All day", dueDate = "2026-10-22", reminders = new[] { new { minutesBefore = 0 } } });
        Assert.Equal(new DateTime(2026, 10, 22, 9, 0, 0, DateTimeKind.Utc), Assert.Single(t.Reminders).RemindAt);
    }

    [Fact]
    public async Task Due_reminders_notify_once_and_only_when_due()
    {
        await CreateTask(new { title = "Pay rent", dueDate = "2026-10-21", dueTime = "14:00", reminders = new[] { new { minutesBefore = 60 } } });
        Assert.Equal(0, await Sync());                   // 12:00 — reminder is at 13:00
        _clock.Set(Start.AddMinutes(90));               // 13:30
        Assert.Equal(1, await Sync());
        Assert.Equal(1, await Sync());                   // idempotent
        var list = await Notes();
        var n = Assert.Single(list.Items);
        Assert.Equal("Pay rent", n.Title);
        Assert.Contains("14:00", n.Message);
        Assert.Equal(1, list.Unread);
    }

    [Fact]
    public async Task Multiple_reminders_each_notify_and_absolute_times_work()
    {
        await CreateTask(new
        {
            title = "Multi", dueDate = "2026-10-21", dueTime = "18:00",
            reminders = new object[] { new { minutesBefore = 360 }, new { minutesBefore = 120 }, new { at = "2026-10-21T13:00:00Z" } },
        });
        _clock.Set(Start.AddHours(2));                   // 14:00
        Assert.Equal(2, await Sync());                   // 12:00 (360) and 13:00 (absolute); 16:00 not yet
        _clock.Set(Start.AddHours(5));
        Assert.Equal(3, await Sync());
    }

    [Fact]
    public async Task Completed_tasks_do_not_notify_and_changing_the_due_date_moves_the_reminder()
    {
        var done = await CreateTask(new { title = "Done already", dueDate = "2026-10-21", dueTime = "13:00", reminders = new[] { new { minutesBefore = 0 } } });
        await Http.PatchAsync($"/api/tasks/{done.Id}/toggle", null);
        var moved = await CreateTask(new { title = "Moved", dueDate = "2026-10-21", dueTime = "13:00", reminders = new[] { new { minutesBefore = 0 } } });
        await Http.PutAsJsonAsync($"/api/tasks/{moved.Id}", new { title = "Moved", dueDate = "2026-10-25", dueTime = "13:00" }, Json);
        _clock.Set(Start.AddHours(3));
        Assert.Equal(0, await Sync());
        var after = await GetTask(moved.Id);
        Assert.Equal(new DateTime(2026, 10, 25, 13, 0, 0, DateTimeKind.Utc), Assert.Single(after.Reminders).RemindAt);
    }

    [Fact]
    public async Task Editing_keeps_a_fired_reminder_from_firing_again()
    {
        var t = await CreateTask(new { title = "Once", dueDate = "2026-10-21", dueTime = "12:30", reminders = new[] { new { minutesBefore = 10 } } });
        _clock.Set(Start.AddMinutes(25));
        Assert.Equal(1, await Sync());
        await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Once (edited)", dueDate = "2026-10-21", dueTime = "12:30", reminders = new[] { new { minutesBefore = 10 } } }, Json);
        Assert.Equal(1, await Sync());
    }

    [Fact]
    public async Task Mark_read_dismiss_and_read_all()
    {
        await CreateTask(new { title = "A", dueDate = "2026-10-21", dueTime = "12:00", reminders = new[] { new { minutesBefore = 0 } } });
        await CreateTask(new { title = "B", dueDate = "2026-10-21", dueTime = "12:00", reminders = new[] { new { minutesBefore = 0 } } });
        await CreateTask(new { title = "C", dueDate = "2026-10-21", dueTime = "12:00", reminders = new[] { new { minutesBefore = 0 } } });
        _clock.Set(Start.AddMinutes(1));
        await Sync();
        var list = await Notes();
        Assert.Equal(3, list.Unread);

        var read = await Read<NotificationDto>(await Http.PatchAsync($"/api/notifications/{list.Items[0].Id}/read", null));
        Assert.NotNull(read.ReadAt);
        Assert.Equal(2, (await Notes()).Unread);
        var unread = await Read<NotificationDto>(await Http.PatchAsync($"/api/notifications/{list.Items[0].Id}/read?read=false", null));
        Assert.Null(unread.ReadAt);

        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/notifications/{list.Items[1].Id}")).StatusCode);
        var afterDismiss = await Notes();
        Assert.Equal(2, afterDismiss.Items.Count);
        Assert.Equal(2, afterDismiss.Unread);
        Assert.Equal(3, (await Http.GetFromJsonAsync<NotificationList>("/api/notifications?includeDismissed=true", Json))!.Items.Count);

        await Http.PostAsync("/api/notifications/read-all", null);
        Assert.Equal(0, (await Notes()).Unread);
        await Http.DeleteAsync("/api/notifications");
        Assert.Empty((await Notes()).Items);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync("/api/notifications/9999")).StatusCode);
    }

    [Fact]
    public async Task Overdue_digest_is_once_per_day_and_can_be_switched_off()
    {
        await CreateTask(new { title = "Late 1", dueDate = "2026-10-19" });
        await CreateTask(new { title = "Late 2", dueDate = "2026-10-20" });
        await Http.PostAsync("/api/notifications/sync?overdue=false", null);
        Assert.Empty((await Notes()).Items);

        await Http.PostAsync("/api/notifications/sync?overdue=true", null);
        await Http.PostAsync("/api/notifications/sync?overdue=true", null);
        var n = Assert.Single((await Notes()).Items);
        Assert.Equal("2 tasks are overdue", n.Title);

        _clock.Set(Start.AddDays(1));
        await Http.PostAsync("/api/notifications/sync?overdue=true", null);
        Assert.Equal(2, (await Notes()).Items.Count);   // a new day, a new digest
    }

    [Fact]
    public async Task A_timed_task_that_passes_its_time_today_is_reported_overdue_once()
    {
        await CreateTask(new { title = "Timed", dueDate = "2026-10-21", dueTime = "11:00" });
        await Http.PostAsync("/api/notifications/sync?overdue=true", null);
        await Http.PostAsync("/api/notifications/sync?overdue=true", null);
        var n = Assert.Single((await Notes()).Items, x => x.TaskId is not null);
        Assert.Equal("Timed", n.Title);
        Assert.Equal("Overdue", n.Kind);
    }

    [Fact]
    public async Task Upcoming_reminders_list_future_ones_and_overdue_tasks()
    {
        await CreateTask(new { title = "Soon", dueDate = "2026-10-22", dueTime = "10:00", reminders = new[] { new { minutesBefore = 30 } } });
        await CreateTask(new { title = "Far", dueDate = "2026-12-22", dueTime = "10:00", reminders = new[] { new { minutesBefore = 30 } } });
        await CreateTask(new { title = "Late", dueDate = "2026-10-01" });
        var up = (await Http.GetFromJsonAsync<UpcomingReminders>("/api/reminders/upcoming?days=7", Json))!;
        Assert.Equal(["Soon"], up.Upcoming.Select(u => u.TaskTitle));
        Assert.Equal(["Late"], up.OverdueTasks.Select(t => t.Title));
    }

    [Fact]
    public async Task Too_many_reminders_are_rejected()
    {
        var many = Enumerable.Range(0, 11).Select(i => new { minutesBefore = i }).ToArray();
        var res = await Http.PostAsJsonAsync("/api/tasks", new { title = "x", dueDate = "2026-10-22", reminders = many }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }
}

public class FocusTests : TestBase
{
    private static readonly DateTimeOffset Start = new(2026, 10, 21, 12, 0, 0, TimeSpan.Zero);
    private readonly FixedTimeProvider _clock;

    public FocusTests() : this(new FixedTimeProvider(Start)) { }
    private FocusTests(FixedTimeProvider clock) : base(new ApiFactory(clock: clock)) => _clock = clock;

    private Task<HttpResponseMessage> Record(object body) => Http.PostAsJsonAsync("/api/focus/sessions", body, Json);

    private object Session(int minutes, bool completed = true, int? taskId = null, int daysAgo = 0, string kind = "Focus")
    {
        var end = Start.UtcDateTime.AddDays(-daysAgo).AddMinutes(-5);
        return new
        {
            kind, taskId, plannedSeconds = minutes * 60, actualSeconds = completed ? minutes * 60 : minutes * 30, completed,
            startedAt = end.AddMinutes(-minutes), endedAt = end,
        };
    }

    [Fact]
    public async Task Record_list_and_stats()
    {
        var t = await CreateTask(new { title = "Deep work" });
        Assert.Equal(HttpStatusCode.Created, (await Record(Session(25, taskId: t.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Record(Session(25, completed: false, taskId: t.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Record(Session(5, kind: "ShortBreak"))).StatusCode);

        var list = (await Http.GetFromJsonAsync<List<FocusSessionDto>>("/api/focus/sessions", Json))!;
        Assert.Equal(3, list.Count);
        Assert.Equal("Deep work", list.First(s => s.TaskId == t.Id).TaskTitle);

        var stats = (await Http.GetFromJsonAsync<FocusStatsDto>("/api/focus/stats", Json))!;
        Assert.Equal(25 * 60 + 25 * 30, stats.TodaySeconds);       // breaks are not focus time
        Assert.Equal(1, stats.TodaySessions);                      // only completed sessions count as sessions
        Assert.Equal(stats.TodaySeconds, stats.WeekSeconds);
        Assert.Equal(1, stats.TotalSessions);
        Assert.Equal(t.Id, Assert.Single(stats.TopTasks).TaskId);
        Assert.Equal(14, stats.Daily.Count);
        Assert.Equal(stats.TodaySeconds, stats.Daily[^1].Seconds);
        Assert.Equal((await GetTask(t.Id)).FocusSeconds, stats.TodaySeconds);
    }

    [Fact]
    public async Task Streaks_count_consecutive_days_and_survive_a_day_without_a_session_yet()
    {
        foreach (var d in new[] { 1, 2, 3, 6, 7 }) await Record(Session(25, daysAgo: d));   // yesterday back to 3 days ago, plus an older run
        var stats = (await Http.GetFromJsonAsync<FocusStatsDto>("/api/focus/stats", Json))!;
        Assert.Equal(3, stats.CurrentStreak);       // today has none yet, but the streak is alive through yesterday
        Assert.Equal(3, stats.BestStreak);

        await Record(Session(25));                  // today
        Assert.Equal(4, (await Http.GetFromJsonAsync<FocusStatsDto>("/api/focus/stats", Json))!.CurrentStreak);
    }

    [Fact]
    public async Task A_broken_streak_resets_the_current_but_keeps_the_best()
    {
        foreach (var d in new[] { 5, 6, 7 }) await Record(Session(25, daysAgo: d));
        var stats = (await Http.GetFromJsonAsync<FocusStatsDto>("/api/focus/stats", Json))!;
        Assert.Equal(0, stats.CurrentStreak);
        Assert.Equal(3, stats.BestStreak);
    }

    [Fact]
    public async Task Invalid_sessions_are_rejected()
    {
        var end = Start.UtcDateTime.AddMinutes(-5);
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(new { kind = "Focus", plannedSeconds = 30, actualSeconds = 30, completed = true, startedAt = end.AddMinutes(-1), endedAt = end })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(new { kind = "Focus", plannedSeconds = 1500, actualSeconds = 1500, completed = true, startedAt = end, endedAt = end.AddMinutes(-3) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(new { kind = "Focus", plannedSeconds = 1500, actualSeconds = 1500, completed = true, startedAt = end.AddHours(1), endedAt = end.AddHours(2) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(new { kind = "Focus", plannedSeconds = 1500, actualSeconds = 1500, completed = true, startedAt = end, endedAt = end.AddMinutes(1) })).StatusCode); // lasted longer than the span
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(Session(25, taskId: 9999))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Record(Session(25, kind: "Nap"))).StatusCode);
        Assert.Empty((await Http.GetFromJsonAsync<List<FocusSessionDto>>("/api/focus/sessions", Json))!);
    }

    [Fact]
    public async Task Deleting_a_task_keeps_its_focus_history()
    {
        var t = await CreateTask(new { title = "Gone soon" });
        await Record(Session(25, taskId: t.Id));
        await Http.DeleteAsync($"/api/tasks/{t.Id}");
        var s = Assert.Single((await Http.GetFromJsonAsync<List<FocusSessionDto>>("/api/focus/sessions", Json))!);
        Assert.Null(s.TaskId);
        var stats = (await Http.GetFromJsonAsync<FocusStatsDto>("/api/focus/stats", Json))!;
        Assert.Equal(25 * 60, stats.TotalSeconds);
    }

    [Fact]
    public async Task A_session_can_be_deleted()
    {
        var s = await Read<FocusSessionDto>(await Record(Session(25)));
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/focus/sessions/{s.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync($"/api/focus/sessions/{s.Id}")).StatusCode);
    }

    [Fact]
    public async Task Focus_sessions_are_logged_on_the_task_activity()
    {
        var t = await CreateTask(new { title = "Logged" });
        await Record(Session(25, taskId: t.Id));
        var act = (await Http.GetFromJsonAsync<List<ActivityDto>>($"/api/tasks/{t.Id}/activity", Json))!;
        Assert.Contains(act, a => a.Kind == "Focus" && a.Detail!.StartsWith("25 min"));
        Assert.NotNull(_clock);
    }
}

public class AttachmentTests : TestBase
{
    public AttachmentTests() : base(new ApiFactory()) { }

    private static MultipartFormDataContent File(string name, byte[] bytes)
    {
        var form = new MultipartFormDataContent();
        var part = new ByteArrayContent(bytes);
        part.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(part, "file", name);
        return form;
    }

    [Fact]
    public async Task Upload_list_download_and_delete()
    {
        var t = await CreateTask(new { title = "With file" });
        var res = await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File("notes.txt", "hello"u8.ToArray()));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var a = await Read<AttachmentDto>(res);
        Assert.Equal("notes.txt", a.FileName);
        Assert.Equal(5, a.SizeBytes);
        Assert.Equal(1, (await GetTask(t.Id)).AttachmentCount);

        var dl = await Http.GetAsync($"/api/attachments/{a.Id}");
        Assert.Equal(HttpStatusCode.OK, dl.StatusCode);
        Assert.Equal("hello", await dl.Content.ReadAsStringAsync());
        Assert.Equal("attachment", dl.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("nosniff", dl.Headers.GetValues("X-Content-Type-Options").Single());

        var stored = Directory.GetFiles(Factory.AttachDir);
        Assert.Single(stored);
        Assert.StartsWith(Path.GetFullPath(Factory.AttachDir), Path.GetFullPath(stored[0]));

        Assert.Single((await Http.GetFromJsonAsync<List<AttachmentDto>>($"/api/tasks/{t.Id}/attachments", Json))!);
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/attachments/{a.Id}")).StatusCode);
        Assert.Empty(Directory.GetFiles(Factory.AttachDir));
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync($"/api/attachments/{a.Id}")).StatusCode);
    }

    [Theory]
    [InlineData("evil.html")]
    [InlineData("evil.svg")]
    [InlineData("evil.exe")]
    [InlineData("evil.js")]
    [InlineData("noextension")]
    [InlineData("evil.txt.exe")]
    public async Task Dangerous_or_unknown_file_types_are_refused(string name)
    {
        var t = await CreateTask(new { title = "x" });
        var res = await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File(name, "<script>alert(1)</script>"u8.ToArray()));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.False(Directory.Exists(Factory.AttachDir) && Directory.GetFiles(Factory.AttachDir).Length > 0);
    }

    [Fact]
    public async Task Path_tricks_in_the_file_name_cannot_escape_the_folder()
    {
        var t = await CreateTask(new { title = "x" });
        var res = await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File("..\\..\\..\\windows\\evil.txt", "x"u8.ToArray()));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var a = await Read<AttachmentDto>(res);
        Assert.Equal("evil.txt", a.FileName);
        var file = Assert.Single(Directory.GetFiles(Factory.AttachDir));
        Assert.Matches("^[0-9a-f]{32}\\.txt$", Path.GetFileName(file));
    }

    [Fact]
    public async Task Empty_oversized_and_orphan_uploads_fail_cleanly()
    {
        var t = await CreateTask(new { title = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File("empty.txt", []))).StatusCode);
        Assert.Equal((HttpStatusCode)413, (await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File("big.txt", new byte[10 * 1024 * 1024 + 1]))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/tasks/9999/attachments", File("a.txt", "x"u8.ToArray()))).StatusCode);
        Assert.False(Directory.Exists(Factory.AttachDir) && Directory.GetFiles(Factory.AttachDir).Length > 0);
    }

    [Fact]
    public async Task Deleting_a_task_or_clearing_completed_removes_the_files()
    {
        var t1 = await CreateTask(new { title = "one" });
        var t2 = await CreateTask(new { title = "two", isCompleted = true });
        await Http.PostAsync($"/api/tasks/{t1.Id}/attachments", File("a.txt", "a"u8.ToArray()));
        await Http.PostAsync($"/api/tasks/{t2.Id}/attachments", File("b.txt", "b"u8.ToArray()));
        Assert.Equal(2, Directory.GetFiles(Factory.AttachDir).Length);
        await Http.DeleteAsync("/api/tasks/completed");
        Assert.Single(Directory.GetFiles(Factory.AttachDir));
        await Http.DeleteAsync($"/api/tasks/{t1.Id}");
        Assert.Empty(Directory.GetFiles(Factory.AttachDir));
    }

    [Fact]
    public async Task A_task_has_at_most_twenty_attachments()
    {
        var t = await CreateTask(new { title = "x" });
        for (var i = 0; i < 20; i++)
            Assert.Equal(HttpStatusCode.Created, (await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File($"f{i}.txt", "x"u8.ToArray()))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsync($"/api/tasks/{t.Id}/attachments", File("one-too-many.txt", "x"u8.ToArray()))).StatusCode);
    }
}
