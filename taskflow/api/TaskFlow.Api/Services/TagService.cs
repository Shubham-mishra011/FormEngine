using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

public class TagService(TaskFlowDbContext db)
{
    public async Task<List<TagDto>> ListAsync() =>
        await db.Tags.OrderBy(t => t.Name).Select(t => new TagDto(t.Id, t.Name, t.Color, t.TaskTags.Count)).ToListAsync();

    public async Task<TagDto> CreateAsync(TagInput input)
    {
        var name = Clean(input.Name);
        if (await db.Tags.AnyAsync(t => t.Name == name)) throw Duplicate();
        var tag = new Tag { Name = name, Color = input.Color };
        db.Tags.Add(tag);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { throw Duplicate(); } // lost a race against the unique index
        return new TagDto(tag.Id, tag.Name, tag.Color, 0);
    }

    public async Task<TagDto> UpdateAsync(int id, TagInput input)
    {
        var tag = await db.Tags.FindAsync(id) ?? throw ApiException.NotFound();
        var name = Clean(input.Name);
        if (await db.Tags.AnyAsync(t => t.Name == name && t.Id != id)) throw Duplicate();
        tag.Name = name;
        tag.Color = input.Color;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { throw Duplicate(); }
        return new TagDto(tag.Id, tag.Name, tag.Color, await db.TaskTags.CountAsync(x => x.TagId == id));
    }

    /// <summary>Removes the tag and its links to tasks. The tasks themselves are untouched.</summary>
    public async Task DeleteAsync(int id)
    {
        var tag = await db.Tags.FindAsync(id) ?? throw ApiException.NotFound();
        db.Tags.Remove(tag);
        await db.SaveChangesAsync();
    }

    private static string Clean(string raw)
    {
        // A leading # is how tags are typed in search; it is not part of the name.
        var name = raw.Trim().TrimStart('#').Trim();
        if (name.Length == 0) throw ApiException.Invalid("Name", "Name is required.");
        if (name.Any(char.IsWhiteSpace)) throw ApiException.Invalid("Name", "Tag names cannot contain spaces (use - or _).");
        return name;
    }

    private static ApiException Duplicate() => ApiException.Conflict("A tag with that name already exists.");
}
