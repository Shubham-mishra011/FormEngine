using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Tests;

/// <summary>Spins up the real API against a throwaway SQLite file (under TEMP, which is on E:).</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public string DbPath { get; }
    private readonly bool _keepDb;

    /// <param name="dbPath">Reuse an existing file (to test restarts); the caller then owns cleanup.</param>
    public ApiFactory(string? dbPath = null)
    {
        DbPath = dbPath ?? Path.Combine(Path.GetTempPath(), $"taskflow-test-{Guid.NewGuid():N}.db");
        _keepDb = dbPath is not null;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.UseSetting("ConnectionStrings:Default", $"Data Source={DbPath}");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (_keepDb) return;
        foreach (var suffix in new[] { "", "-wal", "-shm" })
            try { File.Delete(DbPath + suffix); } catch { /* best effort */ }
    }
}

public class ApiTests : IDisposable
{
    private readonly ApiFactory _factory = new();
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public ApiTests() => _http = _factory.CreateClient();
    public void Dispose() { _http.Dispose(); _factory.Dispose(); }

    private async Task<TaskDto> CreateTask(object body)
    {
        var res = await _http.PostAsJsonAsync("/api/tasks", body, Json);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<TaskDto>(Json))!;
    }

    private async Task<List<TaskDto>> ListTasks(string query = "") =>
        (await _http.GetFromJsonAsync<List<TaskDto>>("/api/tasks" + query, Json))!;

    private async Task<CategoryDto> CreateCategory(string name, string color = "#112233")
    {
        var res = await _http.PostAsJsonAsync("/api/categories", new { name, color }, Json);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return (await res.Content.ReadFromJsonAsync<CategoryDto>(Json))!;
    }

    private static string Today(int offsetDays = 0) =>
        DateOnly.FromDateTime(DateTime.Now).AddDays(offsetDays).ToString("yyyy-MM-dd");

    [Fact]
    public async Task Database_is_created_as_a_real_sqlite_file()
    {
        await ListTasks();
        Assert.True(File.Exists(_factory.DbPath));
    }

    [Fact]
    public async Task Create_trims_title_and_applies_defaults()
    {
        var t = await CreateTask(new { title = "  Buy milk  " });
        Assert.Equal("Buy milk", t.Title);
        Assert.False(t.IsCompleted);
        Assert.Equal(Priority.Medium, t.Priority);
        Assert.Null(t.CompletedAt);
        Assert.True(t.Id > 0);
    }

    [Fact]
    public async Task Create_persists_all_fields_and_get_returns_them()
    {
        var cat = await CreateCategory("Work");
        var created = await CreateTask(new
        {
            title = "Ship it", notes = "details", priority = "High",
            dueDate = Today(3), categoryId = cat.Id,
        });
        var fetched = (await _http.GetFromJsonAsync<TaskDto>($"/api/tasks/{created.Id}", Json))!;
        Assert.Equal("details", fetched.Notes);
        Assert.Equal(Priority.High, fetched.Priority);
        Assert.Equal(Today(3), fetched.DueDate!.Value.ToString("yyyy-MM-dd"));
        Assert.Equal("Work", fetched.CategoryName);
        Assert.Equal("#112233", fetched.CategoryColor);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_rejects_blank_title(string title)
    {
        var res = await _http.PostAsJsonAsync("/api/tasks", new { title }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Create_rejects_overlong_title_and_unknown_category()
    {
        var long1 = await _http.PostAsJsonAsync("/api/tasks", new { title = new string('x', 201) }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, long1.StatusCode);
        var badCat = await _http.PostAsJsonAsync("/api/tasks", new { title = "a", categoryId = 999 }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, badCat.StatusCode);
    }

    [Fact]
    public async Task Update_changes_fields_and_sets_completion_timestamp()
    {
        var t = await CreateTask(new { title = "old" });
        var res = await _http.PutAsJsonAsync($"/api/tasks/{t.Id}",
            new { title = "new", priority = "Low", isCompleted = true }, Json);
        res.EnsureSuccessStatusCode();
        var u = (await res.Content.ReadFromJsonAsync<TaskDto>(Json))!;
        Assert.Equal("new", u.Title);
        Assert.Equal(Priority.Low, u.Priority);
        Assert.True(u.IsCompleted);
        Assert.NotNull(u.CompletedAt);
    }

    [Fact]
    public async Task Update_and_delete_missing_task_return_404()
    {
        Assert.Equal(HttpStatusCode.NotFound,
            (await _http.PutAsJsonAsync("/api/tasks/12345", new { title = "x" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.DeleteAsync("/api/tasks/12345")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.GetAsync("/api/tasks/12345")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _http.PatchAsync("/api/tasks/12345/toggle", null)).StatusCode);
    }

    [Fact]
    public async Task Toggle_flips_completion_both_ways()
    {
        var t = await CreateTask(new { title = "t" });
        var on = (await (await _http.PatchAsync($"/api/tasks/{t.Id}/toggle", null))
            .Content.ReadFromJsonAsync<TaskDto>(Json))!;
        Assert.True(on.IsCompleted);
        Assert.NotNull(on.CompletedAt);
        var off = (await (await _http.PatchAsync($"/api/tasks/{t.Id}/toggle", null))
            .Content.ReadFromJsonAsync<TaskDto>(Json))!;
        Assert.False(off.IsCompleted);
        Assert.Null(off.CompletedAt);
    }

    [Fact]
    public async Task Delete_removes_task()
    {
        var t = await CreateTask(new { title = "gone" });
        Assert.Equal(HttpStatusCode.NoContent, (await _http.DeleteAsync($"/api/tasks/{t.Id}")).StatusCode);
        Assert.Empty(await ListTasks());
    }

    [Fact]
    public async Task Filters_by_status()
    {
        var done = await CreateTask(new { title = "done", dueDate = Today(-1) });
        await _http.PatchAsync($"/api/tasks/{done.Id}/toggle", null);
        await CreateTask(new { title = "overdue", dueDate = Today(-2) });
        await CreateTask(new { title = "today", dueDate = Today() });
        await CreateTask(new { title = "later", dueDate = Today(5) });

        Assert.Equal(4, (await ListTasks()).Count);
        Assert.Equal(3, (await ListTasks("?status=active")).Count);
        Assert.Equal(["done"], (await ListTasks("?status=completed")).Select(t => t.Title));
        // A completed task is never "overdue", even with a past due date.
        Assert.Equal(["overdue"], (await ListTasks("?status=overdue")).Select(t => t.Title));
        Assert.Equal(["today"], (await ListTasks("?status=today")).Select(t => t.Title));
        Assert.Equal(HttpStatusCode.BadRequest, (await _http.GetAsync("/api/tasks?status=bogus")).StatusCode);
    }

    [Fact]
    public async Task Search_matches_title_and_notes_case_insensitively()
    {
        await CreateTask(new { title = "Write REPORT" });
        await CreateTask(new { title = "other", notes = "quarterly report draft" });
        await CreateTask(new { title = "unrelated" });
        Assert.Equal(2, (await ListTasks("?q=report")).Count);
        Assert.Empty(await ListTasks("?q=zzz"));
    }

    [Fact]
    public async Task Search_treats_percent_literally_enough_not_to_crash()
    {
        await CreateTask(new { title = "50% done" });
        var res = await _http.GetAsync("/api/tasks?q=%25");
        res.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Filters_by_category_and_priority()
    {
        var work = await CreateCategory("Work");
        await CreateTask(new { title = "a", categoryId = work.Id, priority = "High" });
        await CreateTask(new { title = "b", categoryId = work.Id, priority = "Low" });
        await CreateTask(new { title = "c", priority = "High" });
        Assert.Equal(2, (await ListTasks($"?categoryId={work.Id}")).Count);
        Assert.Equal(2, (await ListTasks("?priority=High")).Count);
        Assert.Equal(["a"], (await ListTasks($"?categoryId={work.Id}&priority=High")).Select(t => t.Title));
    }

    [Fact]
    public async Task Sorts_by_due_priority_and_title()
    {
        await CreateTask(new { title = "b", priority = "Low", dueDate = Today(2) });
        await CreateTask(new { title = "A", priority = "High" });
        await CreateTask(new { title = "c", priority = "Medium", dueDate = Today(1) });

        // Ascending due: soonest first, tasks without a date last.
        Assert.Equal(["c", "b", "A"], (await ListTasks("?sort=due")).Select(t => t.Title));
        // Priority: high first.
        Assert.Equal(["A", "c", "b"], (await ListTasks("?sort=priority")).Select(t => t.Title));
        Assert.Equal(["A", "b", "c"], (await ListTasks("?sort=title")).Select(t => t.Title));
        Assert.Equal(["c", "b", "A"], (await ListTasks("?sort=title_desc")).Select(t => t.Title));
    }

    [Fact]
    public async Task Default_sort_is_newest_first()
    {
        await CreateTask(new { title = "first" });
        await Task.Delay(15);
        await CreateTask(new { title = "second" });
        Assert.Equal(["second", "first"], (await ListTasks()).Select(t => t.Title));
    }

    [Fact]
    public async Task Stats_reflect_task_state()
    {
        var a = await CreateTask(new { title = "a", dueDate = Today(-1) });
        await CreateTask(new { title = "b", dueDate = Today() });
        var c = await CreateTask(new { title = "c" });
        await _http.PatchAsync($"/api/tasks/{c.Id}/toggle", null);
        var s = (await _http.GetFromJsonAsync<StatsDto>("/api/tasks/stats", Json))!;
        Assert.Equal(new StatsDto(3, 1, 2, 1, 1), s);
        Assert.NotNull(a);
    }

    [Fact]
    public async Task Clear_completed_only_removes_completed()
    {
        var a = await CreateTask(new { title = "a" });
        await CreateTask(new { title = "b" });
        await _http.PatchAsync($"/api/tasks/{a.Id}/toggle", null);
        Assert.Equal(HttpStatusCode.NoContent, (await _http.DeleteAsync("/api/tasks/completed")).StatusCode);
        Assert.Equal(["b"], (await ListTasks()).Select(t => t.Title));
    }

    [Fact]
    public async Task Categories_crud_and_duplicate_rules()
    {
        var work = await CreateCategory("Work");
        Assert.Equal(HttpStatusCode.Conflict,
            (await _http.PostAsJsonAsync("/api/categories", new { name = "Work" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _http.PostAsJsonAsync("/api/categories", new { name = "  " }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _http.PostAsJsonAsync("/api/categories", new { name = "X", color = "red" }, Json)).StatusCode);

        var home = await CreateCategory("Home");
        var clash = await _http.PutAsJsonAsync($"/api/categories/{home.Id}", new { name = "Work" }, Json);
        Assert.Equal(HttpStatusCode.Conflict, clash.StatusCode);
        var ok = await _http.PutAsJsonAsync($"/api/categories/{work.Id}", new { name = "Job", color = "#abcdef" }, Json);
        var updated = (await ok.Content.ReadFromJsonAsync<CategoryDto>(Json))!;
        Assert.Equal("Job", updated.Name);
        Assert.Equal("#abcdef", updated.Color);

        var all = (await _http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!;
        Assert.Equal(["Home", "Job"], all.Select(c => c.Name));
    }

    [Fact]
    public async Task Deleting_a_category_keeps_its_tasks_uncategorised()
    {
        var cat = await CreateCategory("Temp");
        var t = await CreateTask(new { title = "keep me", categoryId = cat.Id });
        Assert.Equal(HttpStatusCode.NoContent, (await _http.DeleteAsync($"/api/categories/{cat.Id}")).StatusCode);
        var after = (await _http.GetFromJsonAsync<TaskDto>($"/api/tasks/{t.Id}", Json))!;
        Assert.Null(after.CategoryId);
        Assert.Null(after.CategoryName);
    }

    [Fact]
    public async Task Category_task_count_is_reported()
    {
        var cat = await CreateCategory("Counted");
        await CreateTask(new { title = "1", categoryId = cat.Id });
        await CreateTask(new { title = "2", categoryId = cat.Id });
        var all = (await _http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!;
        Assert.Equal(2, all.Single().TaskCount);
    }
}
