using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api/tags")]
public class TagsController(TagService tags) : ControllerBase
{
    [HttpGet]
    public Task<List<TagDto>> List() => tags.ListAsync();

    [HttpPost]
    public async Task<ActionResult<TagDto>> Create(TagInput input) =>
        CreatedAtAction(nameof(List), await tags.CreateAsync(input));

    [HttpPut("{id:int}")]
    public Task<TagDto> Update(int id, TagInput input) => tags.UpdateAsync(id, input);

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await tags.DeleteAsync(id);
        return NoContent();
    }
}
