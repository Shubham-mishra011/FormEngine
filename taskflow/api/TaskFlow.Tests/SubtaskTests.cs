using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Controllers;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Tests;

public class SubtaskTests() : TestBase(new ApiFactory())
{
    [Fact]
    public async Task Add_list_edit_complete_reopen_delete_a_subtask()
    {
        var t = await CreateTask(new { title = "Parent" });
        var a = await CreateSubtask(t.Id, "  First  ");
        Assert.Equal("First", a.Title);
        Assert.False(a.IsCompleted);
        var b = await CreateSubtask(t.Id, "Second");

        var list = (await Http.GetFromJsonAsync<List<SubtaskDto>>($"/api/tasks/{t.Id}/subtasks", Json))!;
        Assert.Equal(["First", "Second"], list.Select(s => s.Title));
        Assert.Equal([0, 1], list.Select(s => s.SortOrder));

        var edited = await Read<SubtaskDto>(await Http.PutAsJsonAsync($"/api/subtasks/{a.Id}", new { title = "First (edited)", isCompleted = false }, Json));
        Assert.Equal("First (edited)", edited.Title);

        var done = await Read<SubtaskDto>(await Http.PatchAsync($"/api/subtasks/{a.Id}/toggle", null));
        Assert.True(done.IsCompleted);
        Assert.NotNull(done.CompletedAt);
        var reopened = await Read<SubtaskDto>(await Http.PatchAsync($"/api/subtasks/{a.Id}/toggle", null));
        Assert.False(reopened.IsCompleted);
        Assert.Null(reopened.CompletedAt);

        Assert.Equal(HttpStatusCode.NoContent, (await Http.DeleteAsync($"/api/subtasks/{b.Id}")).StatusCode);
        Assert.Single((await Http.GetFromJsonAsync<List<SubtaskDto>>($"/api/tasks/{t.Id}/subtasks", Json))!);
    }

    [Fact]
    public async Task Update_via_put_can_complete_and_reopen()
    {
        var t = await CreateTask(new { title = "P" });
        var s = await CreateSubtask(t.Id, "s");
        var done = await Read<SubtaskDto>(await Http.PutAsJsonAsync($"/api/subtasks/{s.Id}", new { title = "s", isCompleted = true }, Json));
        Assert.True(done.IsCompleted);
        Assert.NotNull(done.CompletedAt);
        var back = await Read<SubtaskDto>(await Http.PutAsJsonAsync($"/api/subtasks/{s.Id}", new { title = "s", isCompleted = false }, Json));
        Assert.Null(back.CompletedAt);
    }

    [Fact]
    public async Task Task_dto_carries_subtasks_and_progress_counts()
    {
        var t = await CreateTask(new { title = "Parent" });
        Assert.Equal(0, (await GetTask(t.Id)).SubtaskTotal);
        await CreateSubtask(t.Id, "a", done: true);
        await CreateSubtask(t.Id, "b", done: true);
        await CreateSubtask(t.Id, "c");

        foreach (var view in new[] { await GetTask(t.Id), (await Tasks()).Single() })
        {
            Assert.Equal(3, view.SubtaskTotal);
            Assert.Equal(2, view.SubtaskDone);
            Assert.Equal(["a", "b", "c"], view.Subtasks.Select(s => s.Title));
        }
    }

    [Fact]
    public async Task Completing_every_subtask_does_not_silently_complete_the_parent()
    {
        var t = await CreateTask(new { title = "Parent" });
        var s = await CreateSubtask(t.Id, "only");
        await Http.PatchAsync($"/api/subtasks/{s.Id}/toggle", null);
        Assert.False((await GetTask(t.Id)).IsCompleted);
    }

    [Fact]
    public async Task Toggling_the_parent_leaves_subtasks_untouched_and_keeps_them_in_the_response()
    {
        var t = await CreateTask(new { title = "Parent" });
        await CreateSubtask(t.Id, "x");
        var toggled = await Read<TaskDto>(await Http.PatchAsync($"/api/tasks/{t.Id}/toggle", null));
        Assert.True(toggled.IsCompleted);
        Assert.Single(toggled.Subtasks);
        Assert.False(toggled.Subtasks[0].IsCompleted);
        var updated = await Read<TaskDto>(await Http.PutAsJsonAsync($"/api/tasks/{t.Id}", new { title = "Renamed", isCompleted = true }, Json));
        Assert.Single(updated.Subtasks);
    }

    [Fact]
    public async Task Subtask_changes_bump_the_parent_updatedAt()
    {
        var clock = new FixedTimeProvider(new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero));
        using var f = new ApiFactory(clock: clock);
        using var http = f.CreateClient();
        var t = await Read<TaskDto>(await http.PostAsJsonAsync("/api/tasks", new { title = "P" }, Json));
        clock.Set(new DateTimeOffset(2026, 1, 2, 0, 0, 0, TimeSpan.Zero));
        await http.PostAsJsonAsync($"/api/tasks/{t.Id}/subtasks", new { title = "s" }, Json);
        var after = (await http.GetFromJsonAsync<TaskDto>($"/api/tasks/{t.Id}", Json))!;
        Assert.Equal(new DateTime(2026, 1, 2, 0, 0, 0, DateTimeKind.Utc), after.UpdatedAt);
    }

    // ---------- validation and invalid references ----------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_subtask_titles_are_rejected_on_create_and_update(string title)
    {
        var t = await CreateTask(new { title = "P" });
        var s = await CreateSubtask(t.Id, "ok");
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsJsonAsync($"/api/tasks/{t.Id}/subtasks", new { title }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PutAsJsonAsync($"/api/subtasks/{s.Id}", new { title }, Json)).StatusCode);
        Assert.Equal("ok", (await GetTask(t.Id)).Subtasks.Single().Title);
    }

    [Fact]
    public async Task Overlong_subtask_title_is_rejected_but_200_is_fine()
    {
        var t = await CreateTask(new { title = "P" });
        Assert.Equal(HttpStatusCode.Created, (await Http.PostAsJsonAsync($"/api/tasks/{t.Id}/subtasks", new { title = new string('a', 200) }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsJsonAsync($"/api/tasks/{t.Id}/subtasks", new { title = new string('a', 201) }, Json)).StatusCode);
    }

    [Theory]
    [InlineData(9999)]
    [InlineData(0)]
    [InlineData(-5)]
    public async Task Subtask_for_a_missing_task_is_404(int taskId)
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsJsonAsync($"/api/tasks/{taskId}/subtasks", new { title = "x" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.GetAsync($"/api/tasks/{taskId}/subtasks")).StatusCode);
    }

    [Fact]
    public async Task Operations_on_missing_subtasks_are_404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PutAsJsonAsync("/api/subtasks/999", new { title = "x" }, Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PatchAsync("/api/subtasks/999/toggle", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.DeleteAsync("/api/subtasks/999")).StatusCode);
    }

    [Fact]
    public async Task A_task_can_have_at_most_100_subtasks()
    {
        var t = await CreateTask(new { title = "P" });
        for (var i = 0; i < SubtasksController.MaxPerTask; i++) await CreateSubtask(t.Id, $"s{i}");
        var over = await Http.PostAsJsonAsync($"/api/tasks/{t.Id}/subtasks", new { title = "one too many" }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, over.StatusCode);
        Assert.Equal(100, (await GetTask(t.Id)).SubtaskTotal);
    }

    [Fact]
    public async Task Subtasks_cannot_be_nested_or_made_circular()
    {
        var t = await CreateTask(new { title = "P" });
        var s = await CreateSubtask(t.Id, "child");

        // There is no route that treats a subtask as a parent.
        var res = await Http.PostAsJsonAsync($"/api/subtasks/{s.Id}/subtasks", new { title = "grandchild" }, Json);
        Assert.True(res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed);

        // A parent reference supplied in the body is ignored: the URL decides the parent.
        var other = await CreateTask(new { title = "Other" });
        var created = await Read<SubtaskDto>(await Http.PostAsJsonAsync($"/api/tasks/{t.Id}/subtasks",
            new { title = "x", taskId = other.Id, parentId = s.Id }, Json));
        Assert.Equal(t.Id, created.TaskId);
        Assert.Empty((await GetTask(other.Id)).Subtasks);

        // Structural guarantee: the model has no self-reference on Subtask and its only FK points at Tasks.
        using var scope = Factory.Services.CreateScope();
        var model = scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>().Model;
        var entity = model.FindEntityType(typeof(Subtask))!;
        var fk = Assert.Single(entity.GetForeignKeys());
        Assert.Equal(typeof(TaskItem), fk.PrincipalEntityType.ClrType);
        Assert.DoesNotContain(entity.GetNavigations(), n => n.TargetEntityType.ClrType == typeof(Subtask));
    }

    [Fact]
    public async Task Deleting_a_task_removes_its_subtasks_and_nothing_else()
    {
        var a = await CreateTask(new { title = "A" });
        var b = await CreateTask(new { title = "B" });
        await CreateSubtask(a.Id, "a1");
        var b1 = await CreateSubtask(b.Id, "b1");
        await Http.DeleteAsync($"/api/tasks/{a.Id}");
        Assert.Equal("b1", (await GetTask(b.Id)).Subtasks.Single().Title);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PatchAsync($"/api/subtasks/{b1.Id + 1}/toggle", null)).StatusCode);
    }

    [Fact]
    public async Task Clearing_completed_tasks_also_clears_their_subtasks()
    {
        var done = await CreateTask(new { title = "done" });
        await CreateSubtask(done.Id, "x");
        await Http.PatchAsync($"/api/tasks/{done.Id}/toggle", null);
        var keep = await CreateTask(new { title = "keep" });
        await CreateSubtask(keep.Id, "y");
        await Http.DeleteAsync("/api/tasks/completed");
        var export = await Export();
        Assert.Equal("keep", Assert.Single(export.Tasks).Title);
        Assert.Equal("y", Assert.Single(export.Tasks[0].Subtasks).Title);
    }

    // ---------- persistence and migration ----------

    [Fact]
    public async Task Subtasks_survive_an_application_restart()
    {
        var path = Path.Combine(Path.GetTempPath(), $"taskflow-sub-restart-{Guid.NewGuid():N}.db");
        try
        {
            int taskId;
            using (var first = new ApiFactory(path))
            {
                var c = first.CreateClient();
                taskId = (await (await c.PostAsJsonAsync("/api/tasks", new { title = "Persistent" }, Json)).Content.ReadFromJsonAsync<TaskDto>(Json))!.Id;
                await c.PostAsJsonAsync($"/api/tasks/{taskId}/subtasks", new { title = "one", isCompleted = true }, Json);
                await c.PostAsJsonAsync($"/api/tasks/{taskId}/subtasks", new { title = "two" }, Json);
            }
            using var second = new ApiFactory(path);
            var t = (await second.CreateClient().GetFromJsonAsync<TaskDto>($"/api/tasks/{taskId}", Json))!;
            Assert.Equal(["one", "two"], t.Subtasks.Select(s => s.Title));
            Assert.Equal(1, t.SubtaskDone);
            Assert.NotNull(t.Subtasks[0].CompletedAt);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var s in new[] { "", "-wal", "-shm" }) try { File.Delete(path + s); } catch { }
        }
    }

    [Fact]
    public async Task The_subtasks_migration_preserves_every_existing_task_and_category()
    {
        var path = Path.Combine(Path.GetTempPath(), $"taskflow-sub-migrate-{Guid.NewGuid():N}.db");
        try
        {
            var options = new DbContextOptionsBuilder<TaskFlowDbContext>().UseSqlite($"Data Source={path};Pooling=False").Options;
            await using (var old = new TaskFlowDbContext(options))
            {
                // Stop at the migration just before AddSubtasks, i.e. the schema real users have today.
                var ids = old.GetService<IMigrationsAssembly>().Migrations.Keys.Order().ToList();
                var before = ids[ids.FindIndex(i => i.EndsWith("_AddSubtasks")) - 1];
                await old.GetService<IMigrator>().MigrateAsync(before);
                await old.Database.ExecuteSqlRawAsync("INSERT INTO Categories (Id, Name, Color) VALUES (1,'Work','#111111')");
                await old.Database.ExecuteSqlRawAsync(
                    "INSERT INTO Tasks (Title, Notes, IsCompleted, Priority, DueDate, CategoryId, CreatedAt, UpdatedAt, CompletedAt) VALUES " +
                    "('keep me','n',0,'High','2026-12-01',1,'2026-01-01 09:00:00','2026-01-02 09:00:00',NULL)," +
                    "('done',1,1,'Low',NULL,NULL,'2026-01-03 09:00:00','2026-01-04 09:00:00','2026-01-04 09:00:00')");
            }
            SqliteConnection.ClearAllPools();

            using var app = new ApiFactory(path);   // starts the real app => applies AddSubtasks
            var http = app.CreateClient();
            var tasks = (await http.GetFromJsonAsync<List<TaskDto>>("/api/tasks?sort=title", Json))!;
            Assert.Equal(["done", "keep me"], tasks.Select(t => t.Title));
            var keep = tasks.Single(t => t.Title == "keep me");
            Assert.Equal("Work", keep.CategoryName);
            Assert.Equal(Priority.High, keep.Priority);
            Assert.Equal(new DateOnly(2026, 12, 1), keep.DueDate);
            Assert.Equal(new DateTime(2026, 1, 1, 9, 0, 0, DateTimeKind.Utc), keep.CreatedAt);
            Assert.All(tasks, t => { Assert.Empty(t.Subtasks); Assert.Equal(0, t.SubtaskTotal); });

            // and subtasks can now be added to old rows
            var added = await http.PostAsJsonAsync($"/api/tasks/{keep.Id}/subtasks", new { title = "new" }, Json);
            Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var s in new[] { "", "-wal", "-shm" }) try { File.Delete(path + s); } catch { }
        }
    }
}
