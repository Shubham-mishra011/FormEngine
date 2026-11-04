using System.Text;
using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

/// <summary>Export, import and backup. Import is two-step: preview (no writes), then apply.</summary>
[ApiController]
[Route("api")]
public class DataController(
    ExportService exporter, ImportService importer, BackupService backups, TimeProvider time) : ControllerBase
{
    private string Stamp() => time.GetUtcNow().UtcDateTime.ToString("yyyyMMdd-HHmmss");

    [HttpGet("export")]
    public async Task<IActionResult> ExportJson()
    {
        var doc = await exporter.BuildAsync();
        Response.Headers.ContentDisposition = $"attachment; filename=\"taskflow-export-{Stamp()}.json\"";
        return new JsonResult(doc);
    }

    [HttpGet("export/tasks.csv")]
    public async Task<IActionResult> ExportCsv()
    {
        var csv = await exporter.BuildCsvAsync();
        // UTF-8 BOM so Excel opens non-ASCII text correctly.
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray();
        return File(bytes, "text/csv; charset=utf-8", $"taskflow-tasks-{Stamp()}.csv");
    }

    /// <summary>Validates an export file and reports what would be added or skipped. Writes nothing.</summary>
    [HttpPost("import/preview")]
    [RequestSizeLimit(ExportFormat.MaxBodyBytes)]
    public async Task<ActionResult<ImportSummary>> Preview()
    {
        var plan = await importer.PlanFromJsonAsync(await ReadBody());
        return plan.Summary.Valid ? plan.Summary : BadRequest(plan.Summary);
    }

    /// <summary>
    /// Validates again (never trusts an earlier preview), takes a safety snapshot of the current database,
    /// then inserts everything in a single transaction. Existing rows are never modified or removed.
    /// </summary>
    [HttpPost("import")]
    [RequestSizeLimit(ExportFormat.MaxBodyBytes)]
    public async Task<ActionResult<ImportResult>> Import()
    {
        var plan = await importer.PlanFromJsonAsync(await ReadBody());
        if (!plan.Summary.Valid) return BadRequest(plan.Summary);

        string? safety = null;
        if (plan.NewTasks.Count > 0 || plan.NewCategories.Count > 0)
            safety = (await backups.CreateAsync("pre-import")).Name;
        await importer.ApplyAsync(plan);
        return new ImportResult(plan.Summary, safety);
    }

    [HttpGet("backups")]
    public List<BackupInfo> ListBackups()
    {
        Response.Headers["X-Backup-Directory"] = backups.Directory;
        return backups.List();
    }

    [HttpPost("backups")]
    public async Task<ActionResult<BackupInfo>> CreateBackup()
    {
        var info = await backups.CreateAsync();
        Response.Headers["X-Backup-Directory"] = backups.Directory;
        return CreatedAtAction(nameof(ListBackups), info);
    }

    /// <summary>
    /// Reads a stored snapshot as an export document so it can go through the normal preview/import flow.
    /// The live database is never replaced.
    /// </summary>
    [HttpGet("backups/{name}/export")]
    public ActionResult<ExportDocument> ReadBackup(string name)
    {
        var path = backups.Resolve(name);
        if (path is null) return NotFound(new ProblemDetails { Title = "No such backup." });
        try
        {
            return ExportService.ReadSnapshot(path, time.GetUtcNow().UtcDateTime);
        }
        catch (Exception ex) when (ex is InvalidDataException or Microsoft.Data.Sqlite.SqliteException)
        {
            return BadRequest(new ProblemDetails { Title = "That file is not a readable TaskFlow backup.", Detail = ex.Message });
        }
    }

    /// <summary>
    /// Replaces ALL current data with a stored snapshot. Takes a safety snapshot first, then swaps the data in
    /// one transaction (all or nothing). Requires <c>confirm=true</c> so it can never happen by accident.
    /// </summary>
    [HttpPost("backups/{name}/restore")]
    public async Task<ActionResult<RestoreResult>> Restore(string name, bool confirm = false)
    {
        if (!confirm)
            return BadRequest(new ProblemDetails { Title = "Restore replaces all current data. Send confirm=true to proceed." });
        var path = backups.Resolve(name);
        if (path is null) return NotFound(new ProblemDetails { Title = "No such backup." });
        ExportDocument snapshot;
        try
        {
            snapshot = ExportService.ReadSnapshot(path, time.GetUtcNow().UtcDateTime);
        }
        catch (Exception ex) when (ex is InvalidDataException or Microsoft.Data.Sqlite.SqliteException or FormatException or InvalidOperationException or NullReferenceException)
        {
            return BadRequest(new ProblemDetails { Title = "That file is not a readable TaskFlow backup.", Detail = ex.Message });
        }

        var safety = await backups.CreateAsync("pre-restore");
        var (summary, before, after) = await importer.ReplaceAllAsync(snapshot);
        if (!summary.Valid) return BadRequest(summary);
        return new RestoreResult(summary, safety.Name, before, after);
    }

    private async Task<string> ReadBody()
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }
}
