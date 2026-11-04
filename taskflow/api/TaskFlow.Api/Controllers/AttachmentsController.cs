using Microsoft.AspNetCore.Mvc;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Services;

namespace TaskFlow.Api.Controllers;

[ApiController]
[Route("api")]
public class AttachmentsController(AttachmentService attachments) : ControllerBase
{
    [HttpGet("tasks/{taskId:int}/attachments")]
    public Task<List<AttachmentDto>> List(int taskId) => attachments.ListAsync(taskId);

    [HttpPost("tasks/{taskId:int}/attachments")]
    [RequestSizeLimit(AttachmentService.MaxBytes + 1024 * 1024)]
    public async Task<ActionResult<AttachmentDto>> Upload(int taskId, IFormFile file)
    {
        await using var stream = file.OpenReadStream();
        var dto = await attachments.AddAsync(taskId, file.FileName, stream, file.Length);
        return CreatedAtAction(nameof(List), new { taskId }, dto);
    }

    /// <summary>Always a download, with a server-chosen type and no sniffing, so an upload can never run as a page.</summary>
    [HttpGet("attachments/{id:int}")]
    public async Task<IActionResult> Download(int id)
    {
        var (meta, path) = await attachments.OpenAsync(id);
        Response.Headers.XContentTypeOptions = "nosniff";
        return PhysicalFile(path, meta.ContentType, meta.FileName);
    }

    [HttpDelete("attachments/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await attachments.DeleteAsync(id);
        return NoContent();
    }
}
