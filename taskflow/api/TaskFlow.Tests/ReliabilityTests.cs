using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Tests;

/// <summary>Edge cases, malformed input, persistence across restarts and migration safety.</summary>
public class ReliabilityTests : IDisposable
{
    private readonly ApiFactory _factory = new();
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public ReliabilityTests() => _http = _factory.CreateClient();
    public void Dispose() { _http.Dispose(); _factory.Dispose(); }

    private static StringContent Raw(string body) => new(body, Encoding.UTF8, "application/json");

    [Theory]
    [InlineData("{ not json")]
    [InlineData("")]
    [InlineData("[]")]
    [InlineData("{\"title\":\"x\",\"priority\":\"Urgent\"}")]
    [InlineData("{\"title\":\"x\",\"priority\":99}")]
    [InlineData("{\"title\":\"x\",\"dueDate\":\"2026-13-45\"}")]
    [InlineData("{\"title\":\"x\",\"dueDate\":\"not a date\"}")]
    [InlineData("{\"title\":\"x\",\"categoryId\":\"abc\"}")]
    [InlineData("{\"title\":123}")]
    public async Task Malformed_task_payloads_return_400_not_500(string body)
    {
        var res = await _http.PostAsync("/api/tasks", Raw(body));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Missing_content_type_is_rejected_cleanly()
    {
        var res = await _http.PostAsync("/api/tasks", new StringContent("{\"title\":\"x\"}", Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, res.StatusCode);
    }

    [Fact]
    public async Task Title_at_exactly_200_chars_is_accepted_and_notes_over_4000_rejected()
    {
        var ok = await _http.PostAsJsonAsync("/api/tasks", new { title = new string('a', 200) }, Json);
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        var bad = await _http.PostAsJsonAsync("/api/tasks", new { title = "t", notes = new string('n', 4001) }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Theory]
    [InlineData("/api/tasks/abc")]
    [InlineData("/api/tasks/-1")]
    [InlineData("/api/tasks/0")]
    [InlineData("/api/categories/abc")]
    public async Task Invalid_ids_are_404_or_400_never_500(string url)
    {
        var res = await _http.GetAsync(url);
        // Categories have no GET-by-id, so that route answers 405; the point is that nothing returns 5xx.
        Assert.True(res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest or HttpStatusCode.MethodNotAllowed,
            res.StatusCode.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await _http.DeleteAsync(url)).StatusCode);
    }

    [Theory]
    [InlineData("?priority=bogus")]
    [InlineData("?sort=bogus")]
    [InlineData("?status=bogus")]
    [InlineData("?categoryId=abc")]
    public async Task Invalid_query_values_return_400(string query)
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _http.GetAsync("/api/tasks" + query)).StatusCode);
    }

    [Fact]
    public async Task Update_can_clear_due_date_notes_and_category()
    {
        var cat = (await (await _http.PostAsJsonAsync("/api/categories", new { name = "C" }, Json))
            .Content.ReadFromJsonAsync<CategoryDto>(Json))!;
        var t = (await (await _http.PostAsJsonAsync("/api/tasks",
            new { title = "t", notes = "n", dueDate = "2026-12-01", categoryId = cat.Id }, Json))
            .Content.ReadFromJsonAsync<TaskDto>(Json))!;
        var res = await _http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "t" }, Json);
        var u = (await res.Content.ReadFromJsonAsync<TaskDto>(Json))!;
        Assert.Null(u.DueDate);
        Assert.Null(u.Notes);
        Assert.Null(u.CategoryId);
    }

    [Fact]
    public async Task Update_to_missing_category_is_400_and_leaves_task_unchanged()
    {
        var t = (await (await _http.PostAsJsonAsync("/api/tasks", new { title = "keep" }, Json))
            .Content.ReadFromJsonAsync<TaskDto>(Json))!;
        var res = await _http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "changed", categoryId = 404 }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var after = (await _http.GetFromJsonAsync<TaskDto>($"/api/tasks/{t.Id}", Json))!;
        Assert.Equal("keep", after.Title);
    }

    [Fact]
    public async Task Search_wildcards_percent_and_underscore_match_literally()
    {
        foreach (var title in new[] { "100% done", "1000 done", "a_b", "axb" })
            await _http.PostAsJsonAsync("/api/tasks", new { title }, Json);

        var pct = (await _http.GetFromJsonAsync<List<TaskDto>>("/api/tasks?q=100%25", Json))!;
        Assert.Equal(["100% done"], pct.Select(t => t.Title));
        var us = (await _http.GetFromJsonAsync<List<TaskDto>>("/api/tasks?q=a_b", Json))!;
        Assert.Equal(["a_b"], us.Select(t => t.Title));
    }

    [Fact]
    public async Task Category_names_are_unique_ignoring_case()
    {
        Assert.Equal(HttpStatusCode.Created,
            (await _http.PostAsJsonAsync("/api/categories", new { name = "Work" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await _http.PostAsJsonAsync("/api/categories", new { name = "work" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await _http.PostAsJsonAsync("/api/categories", new { name = "  WORK  " }, Json)).StatusCode);
    }

    [Fact]
    public async Task Renaming_a_category_to_its_own_name_with_different_case_is_allowed()
    {
        var c = (await (await _http.PostAsJsonAsync("/api/categories", new { name = "work" }, Json))
            .Content.ReadFromJsonAsync<CategoryDto>(Json))!;
        var res = await _http.PutAsJsonAsync($"/api/categories/{c.Id}", new { name = "Work" }, Json);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Unknown_route_is_404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await _http.GetAsync("/api/nope")).StatusCode);
    }

    [Fact]
    public async Task Data_survives_an_application_restart()
    {
        var path = Path.Combine(Path.GetTempPath(), $"taskflow-restart-{Guid.NewGuid():N}.db");
        try
        {
            using (var first = new ApiFactory(path))
            {
                var c = first.CreateClient();
                var cat = (await (await c.PostAsJsonAsync("/api/categories", new { name = "Persist", color = "#123456" }, Json))
                    .Content.ReadFromJsonAsync<CategoryDto>(Json))!;
                await c.PostAsJsonAsync("/api/tasks",
                    new { title = "survives", priority = "High", dueDate = "2026-11-11", categoryId = cat.Id }, Json);
            }

            using var second = new ApiFactory(path);
            var c2 = second.CreateClient();
            var tasks = (await c2.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Json))!;
            var t = Assert.Single(tasks);
            Assert.Equal("survives", t.Title);
            Assert.Equal(Priority.High, t.Priority);
            Assert.Equal("2026-11-11", t.DueDate!.Value.ToString("yyyy-MM-dd"));
            Assert.Equal("Persist", t.CategoryName);
            Assert.Equal("#123456", t.CategoryColor);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var s in new[] { "", "-wal", "-shm" }) try { File.Delete(path + s); } catch { }
        }
    }

    [Fact]
    public async Task Migrating_an_existing_database_preserves_data_and_resolves_case_duplicates()
    {
        // Build a database at the *previous* schema (InitialCreate only), fill it, then start the real app on it.
        var path = Path.Combine(Path.GetTempPath(), $"taskflow-migrate-{Guid.NewGuid():N}.db");
        try
        {
            var options = new DbContextOptionsBuilder<TaskFlowDbContext>().UseSqlite($"Data Source={path}").Options;
            await using (var old = new TaskFlowDbContext(options))
            {
                var migrator = old.GetService<IMigrator>();
                var initial = old.GetService<IMigrationsAssembly>().Migrations.Keys.Order().First();
                await migrator.MigrateAsync(initial);
                await old.Database.ExecuteSqlRawAsync(
                    "INSERT INTO Categories (Id, Name, Color) VALUES (1,'Work','#111111'), (2,'work','#222222'), (3,'Home','#333333')");
                await old.Database.ExecuteSqlRawAsync(
                    "INSERT INTO Tasks (Title, IsCompleted, Priority, CategoryId, CreatedAt, UpdatedAt) VALUES " +
                    "('t1',0,'High',1,'2026-01-01','2026-01-01'), ('t2',1,'Low',2,'2026-01-02','2026-01-02'), ('t3',0,'Medium',NULL,'2026-01-03','2026-01-03')");
            }
            SqliteConnection.ClearAllPools();

            using var app = new ApiFactory(path);
            var c = app.CreateClient();
            var tasks = (await c.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Json))!;
            Assert.Equal(3, tasks.Count);
            Assert.Equal("Work", tasks.Single(t => t.Title == "t1").CategoryName);
            Assert.Equal("#222222", tasks.Single(t => t.Title == "t2").CategoryColor); // still linked to its category
            var cats = (await c.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!;
            Assert.Equal(3, cats.Count);
            Assert.Contains(cats, x => x.Name == "Work");
            Assert.Contains(cats, x => x.Name == "work (2)");
            Assert.Equal(HttpStatusCode.Conflict,
                (await c.PostAsJsonAsync("/api/categories", new { name = "HOME" }, Json)).StatusCode);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var s in new[] { "", "-wal", "-shm" }) try { File.Delete(path + s); } catch { }
        }
    }

    [Fact]
    public async Task Concurrent_creates_all_succeed()
    {
        var results = await Task.WhenAll(Enumerable.Range(0, 20)
            .Select(i => _http.PostAsJsonAsync("/api/tasks", new { title = $"t{i}" }, Json)));
        Assert.All(results, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
        var all = (await _http.GetFromJsonAsync<List<TaskDto>>("/api/tasks", Json))!;
        Assert.Equal(20, all.Count);
    }
}
