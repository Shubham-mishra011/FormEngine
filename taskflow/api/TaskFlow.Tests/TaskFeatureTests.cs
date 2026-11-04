using System.Net;
using System.Net.Http.Json;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Tests;

/// <summary>Today is fixed at Wednesday 2026-10-21 so due-date filters are deterministic.</summary>
public class TaskFeatureTests : TestBase
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 12, 0, 0, TimeSpan.Zero);
    private readonly FixedTimeProvider _clock;

    public TaskFeatureTests() : this(new FixedTimeProvider(Now)) { }
    private TaskFeatureTests(FixedTimeProvider clock) : base(new ApiFactory(clock: clock)) => _clock = clock;

    private static string Day(int offset = 0) => DateOnly.FromDateTime(Now.UtcDateTime).AddDays(offset).ToString("yyyy-MM-dd");

    private async Task<TagDto> Tag(string name, string color = "#112233") =>
        await Read<TagDto>(await Http.PostAsJsonAsync("/api/tags", new { name, color }, Json));

    // ------------------------------------------------------------ rich fields

    [Fact]
    public async Task A_task_stores_every_new_field_and_returns_it()
    {
        var cat = await CreateCategory("Work");
        var tag = await Tag("urgent-fix");
        var t = await CreateTask(new
        {
            title = "Full", description = "Short desc", notes = "Long notes", priority = "Urgent",
            startDate = Day(-1), dueDate = Day(2), dueTime = "14:30", estimatedMinutes = 90, actualMinutes = 15,
            categoryId = cat.Id, tagIds = new[] { tag.Id }, isPinned = true, isFavorite = true,
        });
        Assert.Equal("Short desc", t.Description);
        Assert.Equal(Priority.Urgent, t.Priority);
        Assert.Equal(new DateOnly(2026, 10, 20), t.StartDate);
        Assert.Equal(new TimeOnly(14, 30), t.DueTime);
        Assert.Equal(90, t.EstimatedMinutes);
        Assert.Equal(15, t.ActualMinutes);
        Assert.True(t.IsPinned);
        Assert.True(t.IsFavorite);
        Assert.Equal(WorkStatus.Todo, t.Status);
        Assert.Equal(["urgent-fix"], t.Tags.Select(x => x.Name));

        var again = await GetTask(t.Id);
        Assert.Equal(t.DueTime, again.DueTime);
        Assert.Equal(t.EstimatedMinutes, again.EstimatedMinutes);
    }

    [Theory]
    [InlineData("""{"title":"x","dueTime":"10:00"}""")]                                   // time without a date
    [InlineData("""{"title":"x","startDate":"2026-10-22","dueDate":"2026-10-21"}""")]    // start after due
    [InlineData("""{"title":"x","estimatedMinutes":0}""")]
    [InlineData("""{"title":"x","estimatedMinutes":-5}""")]
    [InlineData("""{"title":"x","actualMinutes":-1}""")]
    [InlineData("""{"title":"x","tagIds":[999]}""")]
    [InlineData("""{"title":"x","status":"Blocked"}""")]
    [InlineData("""{"title":"x","reminders":[{"minutesBefore":10}]}""")]                 // relative reminder, no due date
    [InlineData("""{"title":"x","dueDate":"2026-10-21","reminders":[{}]}""")]
    [InlineData("""{"title":"x","dueDate":"2026-10-21","reminders":[{"minutesBefore":5,"at":"2026-10-21T10:00:00Z"}]}""")]
    [InlineData("""{"title":"x","dueTime":"25:99"}""")]
    public async Task Invalid_new_fields_are_rejected(string body)
    {
        var res = await Http.PostAsync("/api/tasks", Raw(body));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Empty(await Tasks());
    }

    [Fact]
    public async Task Updating_without_pin_or_favorite_fields_keeps_them()
    {
        var t = await CreateTask(new { title = "Pinned", isPinned = true, isFavorite = true });
        var u = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Pinned!" }, Json));
        Assert.True(u.IsPinned);
        Assert.True(u.IsFavorite);
        var flags = await Read<TaskDto>(await Http.PatchAsJsonAsync($"/api/tasks/{t.Id}/flags", new { isPinned = false }, Json));
        Assert.False(flags.IsPinned);
        Assert.True(flags.IsFavorite);
    }

    // ------------------------------------------------------------ status / completion invariant

    [Fact]
    public async Task Status_and_completion_stay_consistent_in_every_path()
    {
        var t = await CreateTask(new { title = "Board" });
        var doing = await Read<TaskDto>(await Http.PatchAsJsonAsync($"/api/tasks/{t.Id}/status", new { status = "InProgress" }, Json));
        Assert.Equal(WorkStatus.InProgress, doing.Status);
        Assert.False(doing.IsCompleted);

        var done = await Read<TaskDto>(await Http.PatchAsJsonAsync($"/api/tasks/{t.Id}/status", new { status = "Done" }, Json));
        Assert.True(done.IsCompleted);
        Assert.NotNull(done.CompletedAt);

        var reopened = await Read<TaskDto>(await Http.PatchAsync($"/api/tasks/{t.Id}/toggle", null));
        Assert.Equal(WorkStatus.Todo, reopened.Status);
        Assert.False(reopened.IsCompleted);
        Assert.Null(reopened.CompletedAt);

        // PUT with isCompleted keeps the invariant; an explicit status wins over it.
        var viaPut = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Board", isCompleted = true }, Json));
        Assert.Equal(WorkStatus.Done, viaPut.Status);
        var statusWins = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Board", isCompleted = true, status = "InProgress" }, Json));
        Assert.False(statusWins.IsCompleted);
        Assert.Equal(WorkStatus.InProgress, statusWins.Status);
    }

    [Fact]
    public async Task An_in_progress_task_stays_in_progress_when_edited_unchecked()
    {
        var t = await CreateTask(new { title = "Doing", status = "InProgress" });
        var u = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Doing 2" }, Json));
        Assert.Equal(WorkStatus.InProgress, u.Status);
    }

    [Fact]
    public async Task Moving_to_a_position_renumbers_the_column()
    {
        var a = await CreateTask(new { title = "a" });
        var b = await CreateTask(new { title = "b" });
        var c = await CreateTask(new { title = "c" });
        await Http.PatchAsJsonAsync($"/api/tasks/{c.Id}/status", new { status = "Todo", position = 0 }, Json);
        var ordered = await Tasks("?sort=manual&board=Todo");
        Assert.Equal(["c", "a", "b"], ordered.Select(t => t.Title));
        Assert.Equal([0, 1, 2], ordered.Select(t => t.SortOrder));
        Assert.NotEqual(0, a.Id + b.Id);
    }

    [Fact]
    public async Task Changing_status_in_the_database_survives_existing_completed_tasks_migration_default()
    {
        var t = await CreateTask(new { title = "Old done", isCompleted = true });
        Assert.Equal(WorkStatus.Done, t.Status);
    }

    // ------------------------------------------------------------ filters, search, sort

    [Fact]
    public async Task Search_covers_title_description_notes_category_tags_and_subtasks_and_ands_terms()
    {
        var cat = await CreateCategory("Finance");
        var tag = await Tag("quarterly");
        var byTitle = await CreateTask(new { title = "Alpha report" });
        await CreateTask(new { title = "b", description = "contains alpha text" });
        await CreateTask(new { title = "c", notes = "alpha in the notes" });
        await CreateTask(new { title = "d", categoryId = cat.Id });
        await CreateTask(new { title = "e", tagIds = new[] { tag.Id } });
        var withSub = await CreateTask(new { title = "f" });
        await CreateSubtask(withSub.Id, "call the bank");

        Assert.Equal(3, (await Tasks("?q=alpha")).Count);
        Assert.Equal(["d"], (await Tasks("?q=finance")).Select(t => t.Title));
        Assert.Equal(["e"], (await Tasks("?q=quarter")).Select(t => t.Title));
        Assert.Equal(["e"], (await Tasks("?q=%23quarterly")).Select(t => t.Title));      // #tag
        Assert.Empty(await Tasks("?q=%23quarter"));                                      // #tag is exact
        Assert.Equal(["f"], (await Tasks("?q=bank")).Select(t => t.Title));
        Assert.Equal([byTitle.Id], (await Tasks("?q=alpha report")).Select(t => t.Id));  // both words must match
        Assert.Empty(await Tasks("?q=alpha zzz"));
    }

    [Fact]
    public async Task Search_treats_percent_and_underscore_literally()
    {
        await CreateTask(new { title = "100% done" });
        await CreateTask(new { title = "1000 done" });
        Assert.Equal(["100% done"], (await Tasks("?q=100%25")).Select(t => t.Title));
        Assert.Equal(["a_b"], await CreateAndFind("a_b", "?q=a_b"));
    }

    private async Task<List<string>> CreateAndFind(string title, string query)
    {
        await CreateTask(new { title });
        await CreateTask(new { title = "axb" });
        return (await Tasks(query)).Select(t => t.Title).ToList();
    }

    [Fact]
    public async Task Views_today_upcoming_overdue_inbox()
    {
        var cat = await CreateCategory("C");
        await CreateTask(new { title = "overdue", dueDate = Day(-2) });
        await CreateTask(new { title = "today", dueDate = Day() });
        await CreateTask(new { title = "later", dueDate = Day(5) });
        await CreateTask(new { title = "inbox" });
        await CreateTask(new { title = "categorised", categoryId = cat.Id });
        await CreateTask(new { title = "done", dueDate = Day(3), isCompleted = true });

        Assert.Equal(["overdue"], (await Tasks("?status=overdue")).Select(t => t.Title));
        Assert.Equal(["today"], (await Tasks("?status=today")).Select(t => t.Title));
        Assert.Equal(["later"], (await Tasks("?status=upcoming")).Select(t => t.Title));
        Assert.Equal(["inbox"], (await Tasks("?status=inbox")).Select(t => t.Title));
        var stats = (await Http.GetFromJsonAsync<StatsDto>("/api/tasks/stats", Json))!;
        Assert.Equal((1, 1, 1, 1), (stats.Overdue, stats.DueToday, stats.Upcoming, stats.Inbox));
    }

    [Fact]
    public async Task Multi_criteria_filters_combine()
    {
        var a = await Tag("a");
        var b = await Tag("b");
        await CreateTask(new { title = "1", priority = "Urgent", tagIds = new[] { a.Id, b.Id }, isPinned = true });
        await CreateTask(new { title = "2", priority = "High", tagIds = new[] { a.Id } });
        await CreateTask(new { title = "3", priority = "Low", isFavorite = true });
        await CreateTask(new { title = "4", priority = "Low", status = "InProgress" });

        Assert.Equal(["1", "2"], (await Tasks($"?tagIds={a.Id}&sort=title")).Select(t => t.Title));
        Assert.Equal(["1"], (await Tasks($"?tagIds={a.Id},{b.Id}&tagMode=all")).Select(t => t.Title));
        Assert.Equal(["1", "2"], (await Tasks("?priorities=Urgent,High&sort=title")).Select(t => t.Title));
        Assert.Equal(["1"], (await Tasks("?pinned=true")).Select(t => t.Title));
        Assert.Equal(["3"], (await Tasks("?favorite=true")).Select(t => t.Title));
        Assert.Equal(["4"], (await Tasks("?board=InProgress")).Select(t => t.Title));
        Assert.Equal(["2"], (await Tasks($"?tagIds={a.Id}&priority=High")).Select(t => t.Title));
    }

    [Theory]
    [InlineData("?status=weird")]
    [InlineData("?sort=weird")]
    [InlineData("?priorities=Nope")]
    [InlineData("?tagIds=x")]
    [InlineData("?limit=0")]
    public async Task Bad_query_parameters_are_400s(string query) =>
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.GetAsync("/api/tasks" + query)).StatusCode);

    [Fact]
    public async Task Sorting_by_priority_due_updated_and_pinned_first()
    {
        await CreateTask(new { title = "low", priority = "Low", dueDate = Day(3) });
        await CreateTask(new { title = "urgent", priority = "Urgent", dueDate = Day(1) });
        await CreateTask(new { title = "med", priority = "Medium" });
        var pinned = await CreateTask(new { title = "pinned-low", priority = "Low", isPinned = true });

        Assert.Equal(["urgent", "med"], (await Tasks("?sort=priority")).Select(t => t.Title).Take(2));
        Assert.Equal("urgent", (await Tasks("?sort=priority")).First().Title);
        Assert.Equal(["urgent", "low"], (await Tasks("?sort=due")).Select(t => t.Title).Take(2));
        Assert.Equal("pinned-low", (await Tasks("?sort=title_desc&pinnedFirst=true")).First().Title);
        Assert.Equal(["med", "pinned-low"], (await Tasks("?sort=due")).Select(t => t.Title).Skip(2));   // undated sort last

        _clock.Set(Now.AddHours(1));
        await Http.PutAsJsonAsync($"/api/tasks/{pinned.Id}", new { title = "pinned-low touched" }, Json);
        Assert.Equal("pinned-low touched", (await Tasks("?sort=updated_desc&limit=1")).Single().Title);
    }

    [Fact]
    public async Task Calendar_range_query_returns_only_tasks_due_inside_the_range()
    {
        await CreateTask(new { title = "before", dueDate = "2026-09-30" });
        await CreateTask(new { title = "first", dueDate = "2026-10-01" });
        await CreateTask(new { title = "mid", dueDate = "2026-10-15", dueTime = "09:00" });
        await CreateTask(new { title = "last", dueDate = "2026-10-31" });
        await CreateTask(new { title = "after", dueDate = "2026-11-01" });
        await CreateTask(new { title = "undated" });
        Assert.Equal(["first", "mid", "last"], (await Tasks("?dueFrom=2026-10-01&dueTo=2026-10-31&sort=due")).Select(t => t.Title));
        Assert.Equal(["undated"], (await Tasks("?hasDue=false")).Select(t => t.Title));
    }

    [Fact]
    public async Task Rescheduling_moves_the_due_date_logs_it_and_keeps_the_time()
    {
        var t = await CreateTask(new { title = "Drag me", dueDate = Day(1), dueTime = "10:00", reminders = new[] { new { minutesBefore = 60 } } });
        var oldRemind = Assert.Single(t.Reminders).RemindAt;
        var moved = await Read<TaskDto>(await Http.PatchAsJsonAsync($"/api/tasks/{t.Id}/reschedule", new { dueDate = Day(4) }, Json));
        Assert.Equal(new DateOnly(2026, 10, 25), moved.DueDate);
        Assert.Equal(new TimeOnly(10, 0), moved.DueTime);
        Assert.Equal(oldRemind.AddDays(3), Assert.Single(moved.Reminders).RemindAt);

        var activity = (await Http.GetFromJsonAsync<List<ActivityDto>>($"/api/tasks/{t.Id}/activity", Json))!;
        Assert.Contains(activity, a => a.Kind == "Rescheduled");

        var cleared = await Read<TaskDto>(await Http.PatchAsJsonAsync($"/api/tasks/{t.Id}/reschedule", new { dueDate = (string?)null }, Json));
        Assert.Null(cleared.DueDate);
        Assert.Null(cleared.DueTime);
        Assert.Empty(cleared.Reminders);
    }

    // ------------------------------------------------------------ tags

    [Fact]
    public async Task Tag_crud_unique_names_colors_and_deleting_keeps_tasks()
    {
        var t = await Tag("Home", "#ff0000");
        Assert.Equal("Home", t.Name);
        Assert.Equal(HttpStatusCode.Conflict, (await Http.PostAsJsonAsync("/api/tags", new { name = "home" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsJsonAsync("/api/tags", new { name = "two words" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsJsonAsync("/api/tags", new { name = "x", color = "red" }, Json)).StatusCode);
        Assert.Equal("urgent", (await Tag("#urgent")).Name);   // leading # is stripped

        var other = await Tag("Work");
        var renamed = await Read<TagDto>(await Http.PutAsJsonAsync($"/api/tags/{t.Id}", new { name = "House", color = "#00ff00" }, Json));
        Assert.Equal(("House", "#00ff00"), (renamed.Name, renamed.Color));
        Assert.Equal(HttpStatusCode.Conflict, (await Http.PutAsJsonAsync($"/api/tags/{t.Id}", new { name = "work" }, Json)).StatusCode);

        var task = await CreateTask(new { title = "Keep me", tagIds = new[] { t.Id, other.Id } });
        Assert.Equal(["House", "Work"], task.Tags.Select(x => x.Name));
        Assert.Equal(1, (await Http.GetFromJsonAsync<List<TagDto>>("/api/tags", Json))!.Single(x => x.Id == t.Id).TaskCount);

        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/tags/{t.Id}")).StatusCode);
        var after = await GetTask(task.Id);
        Assert.Equal(["Work"], after.Tags.Select(x => x.Name));   // the task is still here, minus the tag
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync($"/api/tags/{t.Id}")).StatusCode);
    }

    [Fact]
    public async Task Editing_tags_replaces_them_and_omitting_keeps_them()
    {
        var a = await Tag("a"); var b = await Tag("b");
        var t = await CreateTask(new { title = "x", tagIds = new[] { a.Id } });
        var kept = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "x2" }, Json));
        Assert.Equal(["a"], kept.Tags.Select(x => x.Name));
        var swapped = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "x2", tagIds = new[] { b.Id, b.Id } }, Json));
        Assert.Equal(["b"], swapped.Tags.Select(x => x.Name));
        var cleared = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "x2", tagIds = Array.Empty<int>() }, Json));
        Assert.Empty(cleared.Tags);
    }

    // ------------------------------------------------------------ duplicate, bulk, delete, clear

    [Fact]
    public async Task Duplicate_copies_content_but_not_state()
    {
        var tag = await Tag("copyme");
        var src = await CreateTask(new { title = "Original", description = "d", priority = "High", dueDate = Day(2), tagIds = new[] { tag.Id }, isPinned = true, isCompleted = true });
        await CreateSubtask(src.Id, "step", done: true);
        var res = await Http.PostAsync($"/api/tasks/{src.Id}/duplicate", null);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var copy = await Read<TaskDto>(res);
        Assert.NotEqual(src.Id, copy.Id);
        Assert.Equal("Original (copy)", copy.Title);
        Assert.Equal("d", copy.Description);
        Assert.Equal(Priority.High, copy.Priority);
        Assert.Equal(src.DueDate, copy.DueDate);
        Assert.Equal(["copyme"], copy.Tags.Select(x => x.Name));
        Assert.False(copy.IsCompleted);
        Assert.False(copy.IsPinned);
        Assert.Null(copy.Recurrence);
        var s = Assert.Single(copy.Subtasks);
        Assert.False(s.IsCompleted);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/tasks/9999/duplicate", null)).StatusCode);
    }

    [Fact]
    public async Task Bulk_actions_apply_to_many_tasks_atomically()
    {
        var cat = await CreateCategory("Bulk");
        var tag = await Tag("bulk");
        var ids = new List<int>();
        for (var i = 0; i < 4; i++) ids.Add((await CreateTask(new { title = $"t{i}" })).Id);

        async Task<BulkResult> Do(string action, object? value = null, IEnumerable<int>? who = null) =>
            await Read<BulkResult>(await Http.PostAsJsonAsync("/api/tasks/bulk", new { ids = who ?? ids, action, value }, Json));

        Assert.Equal(4, (await Do("priority", "Urgent")).Affected);
        Assert.All(await Tasks(), t => Assert.Equal(Priority.Urgent, t.Priority));
        await Do("category", cat.Id);
        Assert.All(await Tasks(), t => Assert.Equal(cat.Id, t.CategoryId));
        await Do("category", null);
        Assert.All(await Tasks(), t => Assert.Null(t.CategoryId));
        await Do("addTag", tag.Id);
        await Do("addTag", tag.Id);                                            // idempotent
        Assert.All(await Tasks(), t => Assert.Single(t.Tags));
        await Do("removeTag", tag.Id);
        Assert.All(await Tasks(), t => Assert.Empty(t.Tags));
        await Do("pin");
        Assert.All(await Tasks(), t => Assert.True(t.IsPinned));
        await Do("dueDate", Day(7));
        Assert.All(await Tasks(), t => Assert.Equal(new DateOnly(2026, 10, 28), t.DueDate));
        await Do("status", "InProgress", ids.Take(2));
        Assert.Equal(2, (await Tasks("?board=InProgress")).Count);
        var r = await Do("complete", null, ids.Take(3).Append(9999));
        Assert.Equal((3, 1), (r.Affected, r.Missing));
        Assert.Equal(3, (await Tasks("?status=completed")).Count);
        await Do("reopen");
        Assert.Empty(await Tasks("?status=completed"));
        await Do("delete", null, ids.Take(2));
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Theory]
    [InlineData("""{"ids":[1],"action":"explode"}""")]
    [InlineData("""{"ids":[],"action":"complete"}""")]
    [InlineData("""{"ids":[1],"action":"priority","value":"Nope"}""")]
    [InlineData("""{"ids":[1],"action":"category","value":9999}""")]
    [InlineData("""{"ids":[1],"action":"addTag"}""")]
    [InlineData("""{"ids":[1],"action":"dueDate","value":"tomorrow"}""")]
    public async Task Bulk_rejects_bad_requests_without_changing_anything(string body)
    {
        var t = await CreateTask(new { title = "safe" });
        var res = await Http.PostAsync("/api/tasks/bulk", Raw(body));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(Priority.Medium, (await GetTask(t.Id)).Priority);
    }

    [Fact]
    public async Task Activity_history_records_what_happened()
    {
        var t = await CreateTask(new { title = "History" });
        await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "History 2", priority = "High" }, Json);
        await Http.PatchAsync($"/api/tasks/{t.Id}/toggle", null);
        await Http.PatchAsync($"/api/tasks/{t.Id}/toggle", null);
        var kinds = (await Http.GetFromJsonAsync<List<ActivityDto>>($"/api/tasks/{t.Id}/activity", Json))!.Select(a => a.Kind).ToList();
        Assert.Equal(["Reopened", "Completed", "Updated", "Created"], kinds);
        var update = (await Http.GetFromJsonAsync<List<ActivityDto>>($"/api/tasks/{t.Id}/activity", Json))!.Single(a => a.Kind == "Updated");
        Assert.Contains("title", update.Detail);
        Assert.Contains("priority", update.Detail);
        Assert.NotEmpty((await Http.GetFromJsonAsync<List<ActivityDto>>("/api/activity", Json))!);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync("/api/tasks/9999/activity")).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_task_removes_its_children_but_not_categories_or_tags()
    {
        var cat = await CreateCategory("Stay");
        var tag = await Tag("stay");
        var t = await CreateTask(new { title = "Go", categoryId = cat.Id, tagIds = new[] { tag.Id }, dueDate = Day(), reminders = new[] { new { minutesBefore = 5 } } });
        await CreateSubtask(t.Id, "s");
        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/tasks/{t.Id}")).StatusCode);
        Assert.Single(await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json) ?? []);
        Assert.Equal(0, (await Http.GetFromJsonAsync<List<TagDto>>("/api/tags", Json))!.Single().TaskCount);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync($"/api/tasks/{t.Id}")).StatusCode);
    }

    [Fact]
    public async Task Unknown_ids_return_404_for_every_task_action()
    {
        foreach (var (method, url) in new[]
        {
            ("PATCH", "/api/tasks/9999/toggle"), ("PATCH", "/api/tasks/9999/status"), ("PATCH", "/api/tasks/9999/reschedule"),
            ("PATCH", "/api/tasks/9999/flags"), ("POST", "/api/tasks/9999/skip"), ("POST", "/api/tasks/9999/recurrence/stop"),
            ("DELETE", "/api/tasks/9999"), ("GET", "/api/tasks/9999/occurrences"),
        })
        {
            var req = new HttpRequestMessage(new HttpMethod(method), url) { Content = JsonContent.Create(new { status = "Done" }, options: Json) };
            Assert.Equal(HttpStatusCode.NotFound, (await Http.SendAsync(req)).StatusCode);
        }
    }

    [Fact]
    public async Task Errors_use_problem_details_with_field_messages()
    {
        var res = await Http.PostAsync("/api/tasks", Raw("""{"title":"x","dueTime":"10:00"}"""));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadAsStringAsync();
        Assert.Contains("DueTime", body);
        Assert.Contains("application/problem+json", res.Content.Headers.ContentType!.ToString());
    }

    // ------------------------------------------------------------ larger data

    [Fact]
    public async Task A_few_thousand_tasks_list_and_search_quickly()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var items = Enumerable.Range(0, 1500).Select(i => new { title = $"Task number {i}", priority = i % 4 == 0 ? "High" : "Low", dueDate = Day(i % 60) });
        var import = new
        {
            schema = "taskflow-export", version = 2, categories = Array.Empty<object>(),
            tasks = items.Select(i => new { i.title, i.priority, i.dueDate, createdAt = Now.UtcDateTime.AddSeconds(1) }).Select((t, n) => new { t.title, t.priority, t.dueDate, createdAt = Now.UtcDateTime.AddSeconds(n) }),
        };
        var res = await Http.PostAsJsonAsync("/api/import", import, Json);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1500, (await Tasks()).Count);
        Assert.Single(await Tasks("?q=number 777"));
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(20), $"took {sw.Elapsed}");
    }
}
