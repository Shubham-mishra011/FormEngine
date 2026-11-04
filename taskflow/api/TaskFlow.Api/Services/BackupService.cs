using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;

namespace TaskFlow.Api.Services;

/// <summary>
/// Point-in-time copies of the whole database, written next to it on E:. Names are unique and an
/// existing file is never overwritten.
/// </summary>
public partial class BackupService(TaskFlowDbContext db, IConfiguration config, TimeProvider time)
{
    [GeneratedRegex(@"^taskflow-[A-Za-z0-9_\-]+\.db$")]
    private static partial Regex NamePattern();

    public string Directory => Path.GetFullPath(config["Backups:Directory"]
        ?? throw new InvalidOperationException("Backups:Directory is not configured."));

    public async Task<BackupInfo> CreateAsync(string kind = "backup")
    {
        System.IO.Directory.CreateDirectory(Directory);
        var stamp = time.GetUtcNow().UtcDateTime.ToString("yyyyMMdd-HHmmss");
        string name, path;
        var n = 0;
        do
        {
            name = n == 0 ? $"taskflow-{kind}-{stamp}.db" : $"taskflow-{kind}-{stamp}-{n}.db";
            path = Path.Combine(Directory, name);
            n++;
        } while (File.Exists(path));

        // VACUUM INTO produces a consistent, compact copy even while the API is serving requests.
        await db.Database.OpenConnectionAsync();
        try
        {
            await using var cmd = db.Database.GetDbConnection().CreateCommand();
            cmd.CommandText = "VACUUM INTO $path";
            var p = cmd.CreateParameter();
            p.ParameterName = "$path";
            p.Value = path;
            cmd.Parameters.Add(p);
            await cmd.ExecuteNonQueryAsync();
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
        SqliteConnection.ClearAllPools();
        return Describe(new FileInfo(path));
    }

    public List<BackupInfo> List() =>
        !System.IO.Directory.Exists(Directory)
            ? []
            : new DirectoryInfo(Directory).EnumerateFiles("taskflow-*.db")
                .Where(f => NamePattern().IsMatch(f.Name))
                .OrderByDescending(f => f.LastWriteTimeUtc).ThenByDescending(f => f.Name)
                .Select(Describe).ToList();

    /// <summary>Maps a client-supplied name to a file inside the backup folder, or null. Blocks path tricks.</summary>
    public string? Resolve(string name)
    {
        if (!NamePattern().IsMatch(name)) return null;
        var path = Path.Combine(Directory, name);
        return File.Exists(path) ? path : null;
    }

    private static BackupInfo Describe(FileInfo f) => new(f.Name, f.Length, f.LastWriteTimeUtc);
}
