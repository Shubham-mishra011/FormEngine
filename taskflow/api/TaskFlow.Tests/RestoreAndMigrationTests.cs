using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Tests;

public class RestoreTests : TestBase
{
    private static readonly DateTimeOffset Start = new(2026, 10, 21, 12, 0, 0, TimeSpan.Zero);
    public RestoreTests() : base(new ApiFactory(clock: new FixedTimeProvider(Start))) { }

    private async Task<BackupInfo> Backup() => await Read<BackupInfo>(await Http.PostAsync("/api/backups", null));

    private async Task SeedRich()
    {
        var cat = await CreateCategory("Work", "#aa0000");
        var tag = await Read<TagDto>(await Http.PostAsJsonAsync("/api/tags", new { name = "deep", color = "#00aa00" }, Json));
        var t = await CreateTask(new
        {
            title = "Rich", description = "d", notes = "n", priority = "Urgent", categoryId = cat.Id, tagIds = new[] { tag.Id },
            startDate = "2026-10-20", dueDate = "2026-10-25", dueTime = "09:30", estimatedMinutes = 45, isPinned = true,
            reminders = new[] { new { minutesBefore = 15 } }, recurrence = new { frequency = "Weekly", weekdays = new[] { 1, 3 } },
        });
        await CreateSubtask(t.Id, "step 1", done: true);
        await CreateSubtask(t.Id, "step 2");
        await Http.PostAsJsonAsync("/api/focus/sessions", new
        {
            kind = "Focus", taskId = t.Id, plannedSeconds = 1500, actualSeconds = 1500, completed = true,
            startedAt = Start.UtcDateTime.AddMinutes(-40), endedAt = Start.UtcDateTime.AddMinutes(-15),
        }, Json);
    }

    [Fact]
    public async Task Export_v2_round_trips_every_feature_through_a_wipe()
    {
        await SeedRich();
        var before = await Tasks();
        var json = await Http.GetStringAsync("/api/export");

        foreach (var t in before) await Http.DeleteAsync($"/api/tasks/{t.Id}");
        // Deleting a task keeps its focus history (unlinked), so clear that too for a true wipe.
        foreach (var f in (await Http.GetFromJsonAsync<List<FocusSessionDto>>("/api/focus/sessions", Json))!)
            await Http.DeleteAsync($"/api/focus/sessions/{f.Id}");
        var res = await Import(json);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var after = Assert.Single(await Tasks());
        var was = Assert.Single(before);
        Assert.Equal(was.Title, after.Title);
        Assert.Equal(was.Description, after.Description);
        Assert.Equal(was.Priority, after.Priority);
        Assert.Equal(was.StartDate, after.StartDate);
        Assert.Equal(was.DueDate, after.DueDate);
        Assert.Equal(was.DueTime, after.DueTime);
        Assert.Equal(was.EstimatedMinutes, after.EstimatedMinutes);
        Assert.True(after.IsPinned);
        Assert.Equal("Work", after.CategoryName);
        Assert.Equal(["deep"], after.Tags.Select(x => x.Name));
        Assert.Equal(["step 1", "step 2"], after.Subtasks.Select(s => s.Title));
        Assert.Equal(was.Reminders.Single().RemindAt, after.Reminders.Single().RemindAt);
        Assert.Equal([1, 3], after.Recurrence!.Weekdays);
        Assert.Equal(1500, after.FocusSeconds);                       // focus session re-linked to the task
    }

    [Fact]
    public async Task Importing_twice_adds_nothing_the_second_time()
    {
        await SeedRich();
        var json = await Http.GetStringAsync("/api/export");
        var summary = await Preview(json);
        Assert.True(summary.Valid);
        Assert.Equal(0, summary.Tasks.Add);
        Assert.Equal(1, summary.Tasks.Skip);
        Assert.Equal(0, summary.Tags!.Add);
        Assert.Equal(0, summary.FocusSessions!.Add);
        await Import(json);
        Assert.Single(await Tasks());
    }

    [Fact]
    public async Task Version_1_files_still_import()
    {
        var v1 = """{"schema":"taskflow-export","version":1,"categories":[{"id":1,"name":"Old","color":"#112233"}],"tasks":[{"id":1,"title":"legacy","priority":"High","categoryId":1,"isCompleted":true,"subtasks":[{"title":"s"}]}]}""";
        var res = await Import(v1);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var t = Assert.Single(await Tasks());
        Assert.Equal(WorkStatus.Done, t.Status);
        Assert.Equal("Old", t.CategoryName);
        Assert.Single(t.Subtasks);
    }

    [Fact]
    public async Task Future_versions_are_refused_with_a_helpful_message()
    {
        var s = await Preview("""{"schema":"taskflow-export","version":3,"tasks":[]}""");
        Assert.False(s.Valid);
        Assert.Contains("newer TaskFlow", s.Errors[0]);
    }

    [Theory]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[{"title":"x","status":"Blocked"}]}""", "status must be")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[{"title":"x","tagIds":[5]}]}""", "tagIds")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[{"title":"x","recurrenceRuleId":5}]}""", "recurrenceRuleId")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[{"title":"x","dueTime":"noon","dueDate":"2026-01-01"}]}""", "dueTime")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[{"title":"x","estimatedMinutes":0}]}""", "estimatedMinutes")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[{"title":"x","attachments":[{"fileName":"a.txt","storedName":"../../etc/passwd"}]}]}""", "storedName")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[],"recurrenceRules":[{"id":1,"frequency":"Hourly","anchorDate":"2026-01-01"}]}""", "frequency")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[],"tags":[{"id":1,"name":"has space"}]}""", "spaces")]
    [InlineData("""{"schema":"taskflow-export","version":2,"tasks":[],"focusSessions":[{"kind":"Nap","startedAt":"2026-01-01T00:00:00Z","endedAt":"2026-01-01T00:10:00Z"}]}""", "kind")]
    public async Task New_fields_are_validated_on_import_and_nothing_is_written(string json, string expected)
    {
        var s = await Preview(json);
        Assert.False(s.Valid);
        Assert.Contains(s.Errors, e => e.Contains(expected));
        Assert.Equal(HttpStatusCode.BadRequest, (await Import(json)).StatusCode);
        Assert.Empty(await Tasks());
    }

    [Fact]
    public async Task Restore_replaces_everything_with_the_backup_and_takes_a_safety_snapshot()
    {
        await SeedRich();
        var b = await Backup();
        await CreateTask(new { title = "Created after the backup" });
        var extraCat = await CreateCategory("Later");
        Assert.Equal(2, (await Tasks()).Count);

        var res = await Http.PostAsync($"/api/backups/{b.Name}/restore?confirm=true", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var result = await Read<RestoreResult>(res);
        Assert.Equal((2, 1), (result.TasksBefore, result.TasksAfter));
        Assert.StartsWith("taskflow-pre-restore-", result.SafetyBackup);
        Assert.True(File.Exists(Path.Combine(Factory.BackupDir, result.SafetyBackup)));

        var after = Assert.Single(await Tasks());
        Assert.Equal("Rich", after.Title);
        Assert.Equal(["deep"], after.Tags.Select(x => x.Name));
        Assert.Equal(2, after.Subtasks.Count);
        Assert.Equal(["Work"], (await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!.Select(c => c.Name));
        Assert.NotEqual(0, extraCat.Id);

        // The safety snapshot can undo the restore.
        var undo = await Http.PostAsync($"/api/backups/{result.SafetyBackup}/restore?confirm=true", null);
        Assert.Equal(HttpStatusCode.OK, undo.StatusCode);
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task Restore_needs_explicit_confirmation_and_a_real_backup()
    {
        await CreateTask(new { title = "keep" });
        var b = await Backup();
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.PostAsync($"/api/backups/{b.Name}/restore", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/backups/taskflow-backup-20200101-000000.db/restore?confirm=true", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Http.PostAsync("/api/backups/..%2Fevil.db/restore?confirm=true", null)).StatusCode);
        Assert.Single(await Tasks());
    }

    [Fact]
    public async Task A_corrupt_backup_file_fails_without_touching_the_data()
    {
        await CreateTask(new { title = "keep me" });
        Directory.CreateDirectory(Factory.BackupDir);
        await File.WriteAllTextAsync(Path.Combine(Factory.BackupDir, "taskflow-backup-20200101-000000.db"), "this is not sqlite");
        var res = await Http.PostAsync("/api/backups/taskflow-backup-20200101-000000.db/restore?confirm=true", null);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(["keep me"], (await Tasks()).Select(t => t.Title));
    }

    [Fact]
    public async Task Restoring_an_old_schema_backup_works_and_keeps_completed_tasks_done()
    {
        Directory.CreateDirectory(Factory.BackupDir);
        var path = Path.Combine(Factory.BackupDir, "taskflow-backup-20200101-000000.db");
        var options = new DbContextOptionsBuilder<TaskFlowDbContext>().UseSqlite($"Data Source={path};Pooling=False").Options;
        await using (var old = new TaskFlowDbContext(options))
        {
            var first = old.GetService<IMigrationsAssembly>().Migrations.Keys.Order().First();
            await old.GetService<IMigrator>().MigrateAsync(first);
            await old.Database.ExecuteSqlRawAsync("INSERT INTO Tasks (Title, IsCompleted, Priority, CreatedAt, UpdatedAt, CompletedAt) VALUES ('finished',1,'Low','2020-01-01 10:00:00','2020-01-01 10:00:00','2020-01-02 10:00:00')");
        }
        await CreateTask(new { title = "will be replaced" });
        Assert.Equal(HttpStatusCode.OK, (await Http.PostAsync("/api/backups/taskflow-backup-20200101-000000.db/restore?confirm=true", null)).StatusCode);
        var t = Assert.Single(await Tasks());
        Assert.Equal("finished", t.Title);
        Assert.True(t.IsCompleted);
        Assert.Equal(WorkStatus.Done, t.Status);
    }

    [Fact]
    public async Task About_reports_the_configured_locations()
    {
        var about = (await Http.GetFromJsonAsync<TaskFlow.Api.Controllers.AboutDto>("/api/about", Json))!;
        Assert.Equal("TaskFlow", about.Name);
        Assert.Equal(Factory.DbPath, about.DatabasePath);
        Assert.Equal(Path.GetFullPath(Factory.BackupDir), about.BackupDirectory);
        Assert.Equal(Path.GetFullPath(Factory.AttachDir), about.AttachmentsDirectory);
    }
}

public class MigrationTests
{
    private static string TempDb() => Path.Combine(Path.GetTempPath(), $"taskflow-mig-{Guid.NewGuid():N}.db");

    [Fact]
    public async Task Upgrading_a_database_from_the_subtasks_schema_preserves_every_row_and_maps_status()
    {
        var path = TempDb();
        var cs = $"Data Source={path};Pooling=False";
        var options = new DbContextOptionsBuilder<TaskFlowDbContext>().UseSqlite(cs).Options;
        try
        {
            await using (var db = new TaskFlowDbContext(options))
            {
                var migrations = db.GetService<IMigrationsAssembly>().Migrations.Keys.Order().ToList();
                var previous = migrations.Single(m => m.EndsWith("_AddSubtasks"));
                await db.GetService<IMigrator>().MigrateAsync(previous);
                await db.Database.ExecuteSqlRawAsync("INSERT INTO Categories (Id, Name, Color) VALUES (1,'Work','#123456')");
                await db.Database.ExecuteSqlRawAsync("INSERT INTO Tasks (Id, Title, IsCompleted, Priority, DueDate, CategoryId, CreatedAt, UpdatedAt, CompletedAt) VALUES (1,'open',0,'High','2026-12-01',1,'2026-01-01 00:00:00','2026-01-01 00:00:00',NULL)");
                await db.Database.ExecuteSqlRawAsync("INSERT INTO Tasks (Id, Title, IsCompleted, Priority, CreatedAt, UpdatedAt, CompletedAt) VALUES (2,'closed',1,'Low','2026-01-01 00:00:00','2026-01-02 00:00:00','2026-01-02 00:00:00')");
                await db.Database.ExecuteSqlRawAsync("INSERT INTO Subtasks (TaskId, Title, IsCompleted, SortOrder, CreatedAt) VALUES (1,'s',0,0,'2026-01-01 00:00:00')");
            }

            await using (var db = new TaskFlowDbContext(options))
                await db.Database.MigrateAsync();

            await using (var db = new TaskFlowDbContext(options))
            {
                var tasks = await db.Tasks.Include(t => t.Subtasks).OrderBy(t => t.Id).ToListAsync();
                Assert.Equal(2, tasks.Count);
                Assert.Equal(("open", Priority.High, WorkStatus.Todo, 1), (tasks[0].Title, tasks[0].Priority, tasks[0].Status, tasks[0].CategoryId));
                Assert.Equal(new DateOnly(2026, 12, 1), tasks[0].DueDate);
                Assert.Single(tasks[0].Subtasks);
                Assert.Equal(("closed", true, WorkStatus.Done), (tasks[1].Title, tasks[1].IsCompleted, tasks[1].Status));
                Assert.Equal(1, tasks[0].OccurrenceNumber);
                Assert.False(tasks[0].IsPinned);
                Assert.Equal("Work", (await db.Categories.SingleAsync()).Name);
                Assert.Empty(await db.Tags.ToListAsync());
                Assert.Empty(await db.Database.GetPendingMigrationsAsync());
            }
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var s in new[] { "", "-wal", "-shm" }) try { File.Delete(path + s); } catch { }
        }
    }

    [Fact]
    public async Task Everything_persists_across_an_application_restart()
    {
        var path = TempDb();
        var backups = Path.Combine(Path.GetTempPath(), $"taskflow-mig-bk-{Guid.NewGuid():N}");
        try
        {
            int taskId;
            using (var f1 = new ApiFactory(path, backups))
            using (var http = f1.CreateClient())
            {
                var tag = await (await http.PostAsJsonAsync("/api/tags", new { name = "persist" }, TestBase.Json)).Content.ReadFromJsonAsync<TagDto>(TestBase.Json);
                var res = await http.PostAsJsonAsync("/api/tasks", new
                {
                    title = "Survives", dueDate = "2026-12-24", dueTime = "08:00", tagIds = new[] { tag!.Id }, isPinned = true,
                    reminders = new[] { new { minutesBefore = 10 } }, recurrence = new { frequency = "Yearly" },
                }, TestBase.Json);
                taskId = (await res.Content.ReadFromJsonAsync<TaskDto>(TestBase.Json))!.Id;
                await http.PostAsJsonAsync("/api/focus/sessions", new
                {
                    kind = "Focus", taskId, plannedSeconds = 1500, actualSeconds = 1500, completed = true,
                    startedAt = DateTime.UtcNow.AddMinutes(-30), endedAt = DateTime.UtcNow.AddMinutes(-5),
                }, TestBase.Json);
            }
            SqliteConnection.ClearAllPools();

            using var f2 = new ApiFactory(path, backups);
            using var http2 = f2.CreateClient();
            var t = (await http2.GetFromJsonAsync<TaskDto>($"/api/tasks/{taskId}", TestBase.Json))!;
            Assert.Equal("Survives", t.Title);
            Assert.Equal(["persist"], t.Tags.Select(x => x.Name));
            Assert.True(t.IsPinned);
            Assert.Equal(new TimeOnly(8, 0), t.DueTime);
            Assert.Single(t.Reminders);
            Assert.Equal(RecurrenceFrequency.Yearly, t.Recurrence!.Frequency);
            Assert.Equal(1500, t.FocusSeconds);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            foreach (var s in new[] { "", "-wal", "-shm" }) try { File.Delete(path + s); } catch { }
            try { Directory.Delete(backups, true); } catch { }
        }
    }
}
