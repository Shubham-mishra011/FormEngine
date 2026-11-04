using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

/// <summary>
/// Stores attachments as files under a dedicated folder (default E:\FormEngine\data\attachments). The user's file
/// name is display-only: files are written under a generated name, the extension must be on an allow-list,
/// and downloads are always sent as attachments with a content type chosen by the server.
/// </summary>
public class AttachmentService(TaskFlowDbContext db, IConfiguration config, TimeProvider time)
{
    public const long MaxBytes = 10 * 1024 * 1024;
    public const int MaxPerTask = 20;

    // Deliberately no html/svg/js/exe: anything a browser could execute is refused.
    private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image/png", [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".gif"] = "image/gif",
        [".webp"] = "image/webp", [".pdf"] = "application/pdf", [".txt"] = "text/plain", [".md"] = "text/markdown",
        [".csv"] = "text/csv", [".json"] = "application/json", [".log"] = "text/plain",
        [".doc"] = "application/msword",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [".xls"] = "application/vnd.ms-excel",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".ppt"] = "application/vnd.ms-powerpoint",
        [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        [".zip"] = "application/zip",
    };

    public string Directory => Path.GetFullPath(config["Attachments:Directory"]
        ?? throw new InvalidOperationException("Attachments:Directory is not configured."));

    public static string AllowedExtensions => string.Join(", ", Types.Keys.Order());

    public async Task<AttachmentDto> AddAsync(int taskId, string? originalName, Stream content, long length)
    {
        if (!await db.Tasks.AnyAsync(t => t.Id == taskId)) throw ApiException.NotFound("Task not found.");
        if (await db.Attachments.CountAsync(a => a.TaskId == taskId) >= MaxPerTask)
            throw ApiException.Invalid("File", $"A task can have at most {MaxPerTask} attachments.");
        if (length > MaxBytes) throw new ApiException(413, $"Files can be at most {MaxBytes / 1024 / 1024} MB.");

        var name = CleanName(originalName);
        var ext = Path.GetExtension(name);
        if (string.IsNullOrEmpty(ext) || !Types.TryGetValue(ext, out var contentType))
            throw ApiException.Invalid("File", $"That file type is not allowed. Allowed: {AllowedExtensions}.");

        System.IO.Directory.CreateDirectory(Directory);
        var stored = Guid.NewGuid().ToString("N") + ext.ToLowerInvariant();
        var path = Path.Combine(Directory, stored);
        long written = 0;
        try
        {
            await using (var fs = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[81920];
                int n;
                while ((n = await content.ReadAsync(buffer)) > 0)
                {
                    written += n;
                    if (written > MaxBytes) throw new ApiException(413, $"Files can be at most {MaxBytes / 1024 / 1024} MB.");
                    await fs.WriteAsync(buffer.AsMemory(0, n));
                }
            }
            if (written == 0) throw ApiException.Invalid("File", "The file is empty.");

            var now = time.GetUtcNow().UtcDateTime;
            var a = new Attachment
            {
                TaskId = taskId, FileName = name, StoredName = stored, ContentType = contentType,
                SizeBytes = written, CreatedAt = now,
            };
            db.Attachments.Add(a);
            var task = await db.Tasks.FindAsync(taskId);
            task!.UpdatedAt = now;
            db.Activity.Add(new ActivityEntry { TaskId = taskId, Kind = "AttachmentAdded", Detail = name, At = now });
            await db.SaveChangesAsync();
            return TaskMapper.ToDto(a);
        }
        catch
        {
            TryDelete(path);
            throw;
        }
    }

    public async Task<List<AttachmentDto>> ListAsync(int taskId)
    {
        if (!await db.Tasks.AnyAsync(t => t.Id == taskId)) throw ApiException.NotFound("Task not found.");
        return (await db.Attachments.Where(a => a.TaskId == taskId).OrderBy(a => a.Id).ToListAsync())
            .Select(TaskMapper.ToDto).ToList();
    }

    public async Task<(Attachment Meta, string Path)> OpenAsync(int id)
    {
        var a = await db.Attachments.FindAsync(id) ?? throw ApiException.NotFound("Attachment not found.");
        var path = Path.Combine(Directory, Path.GetFileName(a.StoredName)); // GetFileName: never trust the column as a path
        if (!File.Exists(path)) throw ApiException.NotFound("The attachment's file is missing from disk.");
        return (a, path);
    }

    public async Task DeleteAsync(int id)
    {
        var a = await db.Attachments.FindAsync(id) ?? throw ApiException.NotFound("Attachment not found.");
        var now = time.GetUtcNow().UtcDateTime;
        db.Attachments.Remove(a);
        db.Activity.Add(new ActivityEntry { TaskId = a.TaskId, Kind = "AttachmentRemoved", Detail = a.FileName, At = now });
        await db.SaveChangesAsync();
        DeleteFiles([a.StoredName]);
    }

    public void DeleteFiles(IEnumerable<string> storedNames)
    {
        foreach (var n in storedNames) TryDelete(Path.Combine(Directory, Path.GetFileName(n)));
    }

    public bool Exists(string storedName) => File.Exists(Path.Combine(Directory, Path.GetFileName(storedName)));

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { /* best effort; an orphan file is harmless */ }
    }

    public static string CleanName(string? name)
    {
        var n = Path.GetFileName((name ?? "").Replace('\\', '/'));
        n = new string(n.Where(c => !char.IsControl(c)).ToArray()).Trim();
        foreach (var bad in Path.GetInvalidFileNameChars()) n = n.Replace(bad, '_');
        if (n.Length > 255) n = n[^255..];
        return n.Length == 0 ? "file" : n;
    }
}
