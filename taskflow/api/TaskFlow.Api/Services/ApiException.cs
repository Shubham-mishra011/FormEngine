using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace TaskFlow.Api.Services;

/// <summary>Thrown by services for expected failures; mapped to a consistent ProblemDetails response.</summary>
public class ApiException(int status, string message, string? field = null) : Exception(message)
{
    public int Status { get; } = status;
    public string? Field { get; } = field;

    public static ApiException NotFound(string what = "Not found.") => new(404, what);
    public static ApiException Invalid(string field, string message) => new(400, message, field);
    public static ApiException Conflict(string message) => new(409, message);
}

public sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        ProblemDetails body;
        if (ex is ApiException api)
        {
            ctx.Response.StatusCode = api.Status;
            body = api is { Status: 400, Field: not null }
                ? new ValidationProblemDetails(new Dictionary<string, string[]> { [api.Field] = [api.Message] })
                { Status = 400, Title = "One or more validation errors occurred." }
                : new ProblemDetails { Status = api.Status, Title = api.Message };
        }
        else if (ex is BadHttpRequestException bad)
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            body = new ProblemDetails { Status = 400, Title = "Bad request.", Detail = bad.Message };
        }
        else
        {
            log.LogError(ex, "Unhandled exception for {Path}", ctx.Request.Path);
            ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
            body = new ProblemDetails { Status = 500, Title = "Something went wrong on the server." };
        }
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = ctx, ProblemDetails = body, Exception = ex });
    }
}
