using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
builder.Services.AddDbContext<TaskFlowDbContext>(o => o.UseSqlite(connectionString));

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<TaskService>();
builder.Services.AddScoped<RecurrenceService>();
builder.Services.AddScoped<TagService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<FocusService>();
builder.Services.AddScoped<AttachmentService>();
builder.Services.AddScoped<ExportService>();
builder.Services.AddScoped<ImportService>();
builder.Services.AddScoped<BackupService>();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Apply pending migrations on startup; this also creates the SQLite file if it is missing.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TaskFlowDbContext>();
    var dir = Path.GetDirectoryName(new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString).DataSource);
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    db.Database.Migrate();
}

if (app.Environment.IsDevelopment()) app.MapOpenApi();

app.UseExceptionHandler();

// The API has no login because it only listens on localhost. That is only safe if a web page the user happens to
// visit cannot drive it: browsers attach an Origin header to cross-site writes (including "simple" POSTs that skip
// the CORS preflight, such as a body-less POST .../restore), so any write from an origin we do not serve is refused.
var allowedOrigins = (builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .ToHashSet(StringComparer.OrdinalIgnoreCase);
app.Use(async (ctx, next) =>
{
    var method = ctx.Request.Method;
    var safe = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
    if (!safe && ctx.Request.Headers.TryGetValue("Origin", out var origin) && origin.Count > 0
        && !allowedOrigins.Contains(origin.ToString()))
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        await ctx.Response.WriteAsJsonAsync(new Microsoft.AspNetCore.Mvc.ProblemDetails
        {
            Status = 403, Title = "Cross-origin request refused.",
        });
        return;
    }
    await next();
});
app.UseCors();
app.MapControllers();

app.Run();

public partial class Program;
