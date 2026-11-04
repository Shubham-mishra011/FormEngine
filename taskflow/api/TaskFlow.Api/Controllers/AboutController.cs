using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

public record AboutDto(
    string Name, string Version, string DatabasePath, string BackupDirectory, string AttachmentsDirectory,
    string TimeZone, DateTime ServerTimeUtc, string AllowedAttachmentTypes, long MaxAttachmentBytes);

[ApiController]
[Route("api/about")]
public class AboutController(IConfiguration config, BackupService backups, AttachmentService attachments, TimeProvider time) : ControllerBase
{
    public const string AppVersion = "1.0.0";

    [HttpGet]
    public AboutDto Get()
    {
        var cs = config.GetConnectionString("Default") ?? "";
        var db = new SqliteConnectionStringBuilder(cs).DataSource;
        return new AboutDto("TaskFlow", AppVersion, Path.GetFullPath(db), backups.Directory, attachments.Directory,
            time.LocalTimeZone.Id, time.GetUtcNow().UtcDateTime, AttachmentService.AllowedExtensions, AttachmentService.MaxBytes);
    }
}
