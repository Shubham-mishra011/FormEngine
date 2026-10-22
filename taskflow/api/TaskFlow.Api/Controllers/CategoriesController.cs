using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api/categories")]
public class CategoriesController(TaskFlowDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<List<CategoryDto>> List() =>
        await db.Categories.OrderBy(c => c.Name)
            .Select(c => new CategoryDto(c.Id, c.Name, c.Color, c.Tasks.Count)).ToListAsync();

    [HttpPost]
    public async Task<ActionResult<CategoryDto>> Create(CategoryInput input)
    {
        var name = input.Name.Trim();
        if (name.Length == 0) return BlankName();
        if (await db.Categories.AnyAsync(c => c.Name == name)) return Duplicate();
        var c = new Category { Name = name, Color = input.Color };
        db.Categories.Add(c);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { return Duplicate(); } // lost a race against the unique index
        return CreatedAtAction(nameof(List), new CategoryDto(c.Id, c.Name, c.Color, 0));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<CategoryDto>> Update(int id, CategoryInput input)
    {
        var c = await db.Categories.FindAsync(id);
        if (c is null) return NotFound();
        var name = input.Name.Trim();
        if (name.Length == 0) return BlankName();
        if (await db.Categories.AnyAsync(x => x.Name == name && x.Id != id)) return Duplicate();
        c.Name = name;
        c.Color = input.Color;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { return Duplicate(); }
        return new CategoryDto(c.Id, c.Name, c.Color, await db.Tasks.CountAsync(t => t.CategoryId == id));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var c = await db.Categories.FindAsync(id);
        if (c is null) return NotFound();
        db.Categories.Remove(c); // tasks are kept; their CategoryId becomes null
        await db.SaveChangesAsync();
        return NoContent();
    }

    private ActionResult BlankName()
    {
        ModelState.AddModelError("Name", "Name is required.");
        return ValidationProblem(ModelState);
    }

    private ActionResult Duplicate() =>
        Conflict(new ProblemDetails { Title = "A category with that name already exists." });
}
