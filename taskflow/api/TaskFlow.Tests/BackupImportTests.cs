using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;
using TaskFlow.Api.Services;

namespace TaskFlow.Tests;

public class BackupImportTests() : TestBase(new ApiFactory())
{
    private static string Doc(string tasks, string? categories = null, string schema = "taskflow-export", int version = 1) =>
        $$"""{ "schema": "{{schema}}", "version": {{version}}, "categories": {{categories ?? "[]"}}, "tasks": {{tasks}} }""";

    private async Task Seed()
    {
        var work = await CreateCategory("Work", "#aa0000");
        var t1 = await CreateTask(new { title = "Ship report", notes = "q3, \"final\"", priority = "High", dueDate = "2026-11-01", categoryId = work.Id });
        await CreateSubtask(t1.Id, "Draft", done: true);
        await CreateSubtask(t1.Id, "Review");
        var t2 = await CreateTask(new { title = "Buy milk" });
        await Http.PatchAsync($"/api/tasks/{t2.Id}/toggle", null);
    }

    // ---------- export ----------

    [Fact]
    public async Task Export_json_contains_everything_and_is_a_download()
    {
        await Seed();
        var res = await Http.GetAsync("/api/export");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("attachment", res.Content.Headers.ContentDisposition?.ToString() ?? string.Join(' ', res.Headers.GetValues("Content-Disposition")));

        var doc = await Read<ExportDocument>(res);
        Assert.Equal("taskflow-export", doc.Schema);
        Assert.Equal(ExportFormat.Version, doc.Version);
        Assert.Equal("Work", Assert.Single(doc.Categories).Name);
        Assert.Equal(2, doc.Tasks.Count);
        var report = doc.Tasks.Single(t => t.Title == "Ship report");
        Assert.Equal("High", report.Priority);
        Assert.Equal("2026-11-01", report.DueDate);
        Assert.Equal(["Draft", "Review"], report.Subtasks.Select(s => s.Title));
        Assert.True(report.Subtasks[0].IsCompleted);
        Assert.True(doc.Tasks.Single(t => t.Title == "Buy milk").IsCompleted);
    }

    [Fact]
    public async Task Export_of_an_empty_database_is_valid()
    {
        var doc = await Export();
        Assert.Empty(doc.Tasks);
        Assert.Empty(doc.Categories);
    }

    [Fact]
    public async Task Export_csv_has_header_bom_and_quoting()
    {
        await Seed();
        var res = await Http.GetAsync("/api/export/tasks.csv");
        Assert.Equal("text/csv", res.Content.Headers.ContentType?.MediaType);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
        var text = Encoding.UTF8.GetString(bytes)[1..];
        var lines = text.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("Id,Title,Notes,Status,Priority,DueDate,Category,Subtasks,CreatedAtUtc,CompletedAtUtc,", lines[0]);
        Assert.Contains("\"q3, \"\"final\"\"\"", text);   // comma and quotes escaped
        Assert.Contains(",Work,1/2,", text);              // category name and subtask progress
        Assert.Contains(",Completed,", text);
    }

    [Theory]
    [InlineData("=HYPERLINK(\"http://evil\")", "'=HYPERLINK")]
    [InlineData("+1+1", "'+1+1")]
    [InlineData("-2+3", "'-2+3")]
    [InlineData("@SUM(A1)", "'@SUM(A1)")]
    public async Task Export_csv_neutralises_spreadsheet_formulas(string title, string expectedPrefix)
    {
        await CreateTask(new { title });
        var text = await Http.GetStringAsync("/api/export/tasks.csv");
        // The cell must start with an apostrophe so a spreadsheet shows it as text instead of evaluating it.
        // (a cell that also needs RFC 4180 quoting starts with a quote character first)
        Assert.Matches(",\"?" + System.Text.RegularExpressions.Regex.Escape(expectedPrefix), text);
        Assert.DoesNotMatch(",\"?" + System.Text.RegularExpressions.Regex.Escape(title[..3]), text);
    }

    [Fact]
    public void Csv_cell_escaping_rules()
    {
        Assert.Equal("plain", ExportService.CsvCell("plain"));
        Assert.Equal("\"a,b\"", ExportService.CsvCell("a,b"));
        Assert.Equal("\"line1\nline2\"", ExportService.CsvCell("line1\nline2"));
        Assert.Equal("\"say \"\"hi\"\"\"", ExportService.CsvCell("say \"hi\""));
        Assert.Equal("", ExportService.CsvCell(""));
    }

    [Fact]
    public async Task Timestamps_are_always_utc_with_a_Z_suffix()
    {
        await CreateTask(new { title = "t" });
        var raw = await Http.GetStringAsync("/api/tasks");
        Assert.Matches("\"createdAt\":\"[^\"]+Z\"", raw);
    }

    // ---------- preview ----------

    [Fact]
    public async Task Preview_reports_adds_and_writes_nothing()
    {
        var json = Doc("""[{"title":"A","subtasks":[{"title":"s1"},{"title":"s2"}]},{"title":"B"}]""",
                       """[{"id":1,"name":"Home"}]""");
        var s = await Preview(json);
        Assert.True(s.Valid);
        Assert.Equal(new Tally(1, 0), s.Categories);
        Assert.Equal(new Tally(2, 0), s.Tasks);
        Assert.Equal(new Tally(2, 0), s.Subtasks);
        Assert.Empty(await Tasks());
        Assert.Empty((await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!);
    }

    [Fact]
    public async Task Preview_counts_duplicates_as_skipped()
    {
        await Seed();
        var exported = JsonSerializer.Serialize(await Export(), Json);
        var s = await Preview(exported);
        Assert.True(s.Valid);
        Assert.Equal(new Tally(0, 1), s.Categories);
        Assert.Equal(new Tally(0, 2), s.Tasks);
        Assert.Equal(new Tally(0, 2), s.Subtasks);
    }

    // ---------- import ----------

    [Fact]
    public async Task Import_round_trips_into_a_fresh_database_preserving_fields()
    {
        await Seed();
        var original = await Export();
        var json = JsonSerializer.Serialize(original, Json);

        using var other = new ApiFactory();
        using var http2 = other.CreateClient();
        var res = await http2.PostAsync("/api/import", Raw(json));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var result = (await res.Content.ReadFromJsonAsync<ImportResult>(Json))!;
        Assert.Equal(new Tally(2, 0), result.Summary.Tasks);

        var copy = (await http2.GetFromJsonAsync<ExportDocument>("/api/export", Json))!;
        Assert.Equal(original.Categories.Select(c => (c.Name, c.Color)), copy.Categories.Select(c => (c.Name, c.Color)));
        foreach (var o in original.Tasks)
        {
            var c = copy.Tasks.Single(t => t.Title == o.Title);
            Assert.Equal(o.Notes, c.Notes);
            Assert.Equal(o.IsCompleted, c.IsCompleted);
            Assert.Equal(o.Priority, c.Priority);
            Assert.Equal(o.DueDate, c.DueDate);
            Assert.Equal(o.CreatedAt, c.CreatedAt);          // exact, not approximate
            Assert.Equal(o.CompletedAt, c.CompletedAt);
            Assert.Equal(o.Subtasks.Select(s => (s.Title, s.IsCompleted)), c.Subtasks.Select(s => (s.Title, s.IsCompleted)));
            Assert.Equal(o.CategoryId is null, c.CategoryId is null);
        }
        Assert.Equal("Work", copy.Categories.Single(c => c.Id == copy.Tasks.Single(t => t.Title == "Ship report").CategoryId).Name);
    }

    [Fact]
    public async Task Importing_the_same_file_twice_adds_nothing_the_second_time()
    {
        await Seed();
        var json = JsonSerializer.Serialize(await Export(), Json);
        var again = await Import(json);
        again.EnsureSuccessStatusCode();
        var r = (await again.Content.ReadFromJsonAsync<ImportResult>(Json))!;
        Assert.Equal(new Tally(0, 2), r.Summary.Tasks);
        Assert.Equal(2, (await Tasks()).Count);
        Assert.Single((await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!);
        Assert.Null(r.SafetyBackup); // nothing to change, so no snapshot needed
    }

    [Fact]
    public async Task Import_merges_into_existing_data_without_touching_it()
    {
        var home = await CreateCategory("home");                       // different case from the file
        var mine = await CreateTask(new { title = "Mine", categoryId = home.Id });
        var json = Doc("""[{"title":"Imported","categoryId":7,"priority":"low"}]""", """[{"id":7,"name":"HOME","color":"#ff0000"}]""");

        var res = await Import(json);
        res.EnsureSuccessStatusCode();

        var cats = (await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!;
        var only = Assert.Single(cats);                                // matched case-insensitively
        Assert.Equal("home", only.Name);
        Assert.Equal("#112233", only.Color);                           // existing colour kept
        var imported = (await Tasks()).Single(t => t.Title == "Imported");
        Assert.Equal(home.Id, imported.CategoryId);
        Assert.Equal(Priority.Low, imported.Priority);                  // priority parsed case-insensitively
        Assert.Equal("Mine", (await GetTask(mine.Id)).Title);
    }

    [Fact]
    public async Task Import_defaults_missing_optional_fields()
    {
        var res = await Import(Doc("""[{"title":"Bare"}]"""));
        res.EnsureSuccessStatusCode();
        var t = Assert.Single(await Tasks());
        Assert.Equal(Priority.Medium, t.Priority);
        Assert.False(t.IsCompleted);
        Assert.Null(t.DueDate);
    }

    [Fact]
    public async Task Import_takes_a_safety_snapshot_first_and_it_contains_the_old_data()
    {
        await CreateTask(new { title = "Before import" });
        var res = await Import(Doc("""[{"title":"New one"}]"""));
        var r = (await res.Content.ReadFromJsonAsync<ImportResult>(Json))!;
        Assert.NotNull(r.SafetyBackup);
        Assert.StartsWith("taskflow-pre-import-", r.SafetyBackup);
        Assert.True(File.Exists(Path.Combine(Factory.BackupDir, r.SafetyBackup)));

        var snap = (await Http.GetFromJsonAsync<ExportDocument>($"/api/backups/{r.SafetyBackup}/export", Json))!;
        Assert.Equal(["Before import"], snap.Tasks.Select(t => t.Title));   // taken *before* the import
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task Duplicates_inside_the_file_are_added_once()
    {
        var created = "2026-01-01T00:00:00Z";
        var json = Doc($$"""[{"title":"Same","createdAt":"{{created}}"},{"title":" same ","createdAt":"{{created}}"}]""",
                         """[{"name":"X"},{"name":"x"}]""");
        var s = await Preview(json);
        Assert.Equal(new Tally(1, 1), s.Tasks);
        Assert.Equal(new Tally(1, 1), s.Categories);
        Assert.NotEmpty(s.Warnings);
        (await Import(json)).EnsureSuccessStatusCode();
        Assert.Single(await Tasks());
    }

    // ---------- validation: malformed imports must never reach the database ----------

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{ \"schema\": ")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("{\"schema\":\"something-else\",\"version\":1,\"tasks\":[]}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"tasks\":[]}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"version\":99,\"tasks\":[]}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"version\":1}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"version\":\"one\",\"tasks\":[]}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"version\":1,\"tasks\":\"nope\"}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"version\":1,\"tasks\":[null]}")]
    [InlineData("{\"schema\":\"taskflow-export\",\"version\":1,\"tasks\":[5]}")]
    public async Task Structurally_invalid_files_are_rejected_with_400_and_a_message(string body)
    {
        var res = await Http.PostAsync("/api/import", Raw(body));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var s = await Read<ImportSummary>(res);
        Assert.False(s.Valid);
        Assert.NotEmpty(s.Errors);
        Assert.Empty(await Tasks());

        var p = await Http.PostAsync("/api/import/preview", Raw(body));
        Assert.Equal(HttpStatusCode.BadRequest, p.StatusCode);
    }

    [Theory]
    [InlineData("""[{"title":""}]""", "title is required")]
    [InlineData("""[{"title":"   "}]""", "title is required")]
    [InlineData("""[{}]""", "title is required")]
    [InlineData("""[{"title":"x","priority":"Critical"}]""", "priority must be")]
    [InlineData("""[{"title":"x","priority":"1"}]""", "priority must be")]
    [InlineData("""[{"title":"x","dueDate":"2026-02-30"}]""", "dueDate must be a real date")]
    [InlineData("""[{"title":"x","dueDate":"31/12/2026"}]""", "dueDate must be a real date")]
    [InlineData("""[{"title":"x","categoryId":99}]""", "does not match any category")]
    [InlineData("""[{"title":"x","subtasks":[{"title":""}]}]""", "subtasks[0].title is required")]
    [InlineData("""[{"title":"x","subtasks":[null]}]""", "subtasks[0].title is required")]
    public async Task Field_level_problems_are_reported_with_their_location(string tasks, string expected)
    {
        var s = await Preview(Doc(tasks));
        Assert.False(s.Valid);
        Assert.Contains(s.Errors, e => e.Contains(expected));
        Assert.Contains(s.Errors, e => e.Contains("tasks[0]"));
    }

    [Fact]
    public async Task Overlong_fields_are_rejected()
    {
        var s = await Preview(Doc($$"""[{"title":"{{new string('a', 201)}}"},{"title":"ok","notes":"{{new string('n', 4001)}}"}]"""));
        Assert.False(s.Valid);
        Assert.Contains(s.Errors, e => e.Contains("tasks[0].title is longer"));
        Assert.Contains(s.Errors, e => e.Contains("tasks[1].notes is longer"));
    }

    [Theory]
    [InlineData("""[{"id":1,"name":""}]""", "name is required")]
    [InlineData("""[{"id":1,"name":"ok","color":"red"}]""", "color must look like")]
    [InlineData("""[{"id":1,"name":"a"},{"id":1,"name":"b"}]""", "appears more than once")]
    public async Task Category_problems_are_reported(string categories, string expected)
    {
        var s = await Preview(Doc("[]", categories));
        Assert.False(s.Valid);
        Assert.Contains(s.Errors, e => e.Contains(expected));
    }

    [Fact]
    public async Task One_bad_record_means_nothing_is_imported()
    {
        var json = Doc("""[{"title":"good 1"},{"title":"good 2"},{"title":"bad","dueDate":"nope"}]""", """[{"name":"New cat"}]""");
        var res = await Import(json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Empty(await Tasks());
        Assert.Empty((await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!);
        Assert.Empty(Directory.Exists(Factory.BackupDir) ? Directory.GetFiles(Factory.BackupDir) : []); // no snapshot for a rejected file
    }

    [Fact]
    public async Task Too_many_errors_are_capped()
    {
        var many = string.Join(",", Enumerable.Range(0, 200).Select(_ => "{}"));
        var s = await Preview(Doc($"[{many}]"));
        Assert.False(s.Valid);
        Assert.True(s.Errors.Count <= ExportFormat.MaxErrorsReported + 1);
    }

    [Fact]
    public async Task Too_many_subtasks_on_one_task_is_rejected()
    {
        var subs = string.Join(",", Enumerable.Range(0, 101).Select(i => $$"""{"title":"s{{i}}"}"""));
        var s = await Preview(Doc($$"""[{"title":"x","subtasks":[{{subs}}]}]"""));
        Assert.False(s.Valid);
        Assert.Contains(s.Errors, e => e.Contains("more than 100 subtasks"));
    }

    [Fact]
    public async Task Deeply_nested_json_is_rejected_not_crashed_on()
    {
        var deep = string.Concat(Enumerable.Repeat("[", 500)) + string.Concat(Enumerable.Repeat("]", 500));
        var res = await Http.PostAsync("/api/import", Raw(deep));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Unknown_extra_properties_are_ignored_for_forward_compatibility()
    {
        var s = await Preview(Doc("""[{"title":"x","futureField":{"a":1}}]""").Replace("\"tasks\"", "\"extra\": 1, \"tasks\""));
        Assert.True(s.Valid);
    }

    [Fact]
    public async Task Html_in_titles_is_stored_as_text_and_returned_verbatim()
    {
        (await Import(Doc("""[{"title":"<script>alert(1)</script>"}]"""))).EnsureSuccessStatusCode();
        Assert.Equal("<script>alert(1)</script>", Assert.Single(await Tasks()).Title);
    }

    // ---------- backups ----------

    [Fact]
    public async Task Create_backup_writes_a_file_in_the_configured_folder()
    {
        await Seed();
        var res = await Http.PostAsync("/api/backups", null);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var info = await Read<BackupInfo>(res);
        Assert.Matches(@"^taskflow-backup-\d{8}-\d{6}\.db$", info.Name);
        Assert.True(info.SizeBytes > 0);
        Assert.True(File.Exists(Path.Combine(Factory.BackupDir, info.Name)));

        var list = (await Http.GetFromJsonAsync<List<BackupInfo>>("/api/backups", Json))!;
        Assert.Contains(list, b => b.Name == info.Name);
    }

    [Fact]
    public async Task Backups_never_overwrite_each_other_even_within_the_same_second()
    {
        var clock = new FixedTimeProvider(new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero));
        using var f = new ApiFactory(clock: clock);
        using var http = f.CreateClient();
        var names = new List<string>();
        for (var i = 0; i < 3; i++)
            names.Add((await (await http.PostAsync("/api/backups", null)).Content.ReadFromJsonAsync<BackupInfo>(Json))!.Name);
        Assert.Equal(3, names.Distinct().Count());
        Assert.Equal(3, Directory.GetFiles(f.BackupDir).Length);
        Assert.Contains("taskflow-backup-20260501-120000.db", names);
    }

    [Fact]
    public async Task Existing_backup_files_are_left_byte_for_byte_unchanged()
    {
        await Seed();
        var first = await Read<BackupInfo>(await Http.PostAsync("/api/backups", null));
        var path = Path.Combine(Factory.BackupDir, first.Name);
        var before = await File.ReadAllBytesAsync(path);
        await CreateTask(new { title = "later change" });
        await Http.PostAsync("/api/backups", null);
        Assert.Equal(before, await File.ReadAllBytesAsync(path));
    }

    [Theory]
    [InlineData("..%2F..%2Fappsettings.json")]
    [InlineData("..%5C..%5Cwindows.db")]
    [InlineData("taskflow-x.db.txt")]
    [InlineData("random.db")]
    [InlineData("taskflow-missing.db")]
    [InlineData("taskflow-%2E%2E%2Fx.db")]
    public async Task Backup_names_are_validated_so_other_files_cannot_be_read(string name)
    {
        var res = await Http.GetAsync($"/api/backups/{name}/export");
        Assert.True(res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.BadRequest, res.StatusCode.ToString());
    }

    [Fact]
    public async Task A_corrupt_or_foreign_file_with_a_valid_name_is_rejected_cleanly()
    {
        Directory.CreateDirectory(Factory.BackupDir);
        await File.WriteAllTextAsync(Path.Combine(Factory.BackupDir, "taskflow-garbage.db"), "this is not sqlite");
        var res = await Http.GetAsync("/api/backups/taskflow-garbage.db/export");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);

        // A real SQLite file that is not a TaskFlow database.
        var other = Path.Combine(Factory.BackupDir, "taskflow-other.db");
        using (var c = new SqliteConnection($"Data Source={other};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "CREATE TABLE Unrelated (x INT)";
            cmd.ExecuteNonQuery();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await Http.GetAsync("/api/backups/taskflow-other.db/export")).StatusCode);
    }

    [Fact]
    public async Task Full_restore_workflow_recovers_data_after_it_is_deleted()
    {
        await Seed();
        var before = await Export();
        var backup = await Read<BackupInfo>(await Http.PostAsync("/api/backups", null));

        // Disaster: everything is deleted.
        foreach (var t in await Tasks()) await Http.DeleteAsync($"/api/tasks/{t.Id}");
        foreach (var c in (await Http.GetFromJsonAsync<List<CategoryDto>>("/api/categories", Json))!)
            await Http.DeleteAsync($"/api/categories/{c.Id}");
        Assert.Empty(await Tasks());

        // Restore: read the snapshot as an export document, preview, then import.
        var snapshotJson = await Http.GetStringAsync($"/api/backups/{backup.Name}/export");
        var preview = await Preview(snapshotJson);
        Assert.True(preview.Valid);
        Assert.Equal(new Tally(2, 0), preview.Tasks);
        Assert.Equal(new Tally(2, 0), preview.Subtasks);
        (await Import(snapshotJson)).EnsureSuccessStatusCode();

        var after = await Export();
        // Row ids/insert order are not part of the contract; compare the data itself.
        Assert.Equal(before.Tasks.Select(t => (t.Title, t.Notes, t.Priority, t.DueDate, t.IsCompleted, t.CreatedAt)).Order(),
                     after.Tasks.Select(t => (t.Title, t.Notes, t.Priority, t.DueDate, t.IsCompleted, t.CreatedAt)).Order());
        Assert.Equal(["Draft", "Review"], after.Tasks.Single(t => t.Title == "Ship report").Subtasks.Select(s => s.Title));
        Assert.Equal("Work", after.Categories.Single().Name);
    }

    [Fact]
    public async Task Reading_a_backup_does_not_modify_the_live_database_or_the_backup()
    {
        await Seed();
        var b = await Read<BackupInfo>(await Http.PostAsync("/api/backups", null));
        var path = Path.Combine(Factory.BackupDir, b.Name);
        var before = await File.ReadAllBytesAsync(path);
        await Http.GetAsync($"/api/backups/{b.Name}/export");
        Assert.Equal(before, await File.ReadAllBytesAsync(path));
        Assert.Equal(2, (await Tasks()).Count);
    }

    [Fact]
    public async Task A_snapshot_from_before_subtasks_existed_can_still_be_read()
    {
        // Build a database at the very first schema (no Subtasks table) and drop it in the backup folder.
        Directory.CreateDirectory(Factory.BackupDir);
        var path = Path.Combine(Factory.BackupDir, "taskflow-backup-20200101-000000.db");
        var options = new DbContextOptionsBuilder<TaskFlowDbContext>().UseSqlite($"Data Source={path};Pooling=False").Options;
        await using (var old = new TaskFlowDbContext(options))
        {
            var first = old.GetService<IMigrationsAssembly>().Migrations.Keys.Order().First();
            await old.GetService<IMigrator>().MigrateAsync(first);
            await old.Database.ExecuteSqlRawAsync("INSERT INTO Categories (Id, Name, Color) VALUES (1,'Old','#123456')");
            await old.Database.ExecuteSqlRawAsync(
                "INSERT INTO Tasks (Title, IsCompleted, Priority, CategoryId, CreatedAt, UpdatedAt) VALUES ('legacy',0,'High',1,'2020-01-01 10:00:00','2020-01-01 10:00:00')");
        }

        var doc = (await Http.GetFromJsonAsync<ExportDocument>("/api/backups/taskflow-backup-20200101-000000.db/export", Json))!;
        var t = Assert.Single(doc.Tasks);
        Assert.Equal("legacy", t.Title);
        Assert.Empty(t.Subtasks);
        Assert.Equal(new DateTime(2020, 1, 1, 10, 0, 0, DateTimeKind.Utc), t.CreatedAt);
        Assert.Equal("Old", Assert.Single(doc.Categories).Name);
    }

    [Fact]
    public async Task Listing_backups_with_no_folder_is_empty()
    {
        Assert.Empty((await Http.GetFromJsonAsync<List<BackupInfo>>("/api/backups", Json))!);
    }
}
