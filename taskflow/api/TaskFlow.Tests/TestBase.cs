using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TaskFlow.Api.Controllers;
using TaskFlow.Api.Dtos;

namespace TaskFlow.Tests;

/// <summary>Shared plumbing for tests that talk to a real API instance over HTTP.</summary>
public abstract class TestBase(ApiFactory factory) : IDisposable
{
    protected ApiFactory Factory { get; } = factory;
    protected HttpClient Http { get; } = factory.CreateClient();

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public void Dispose()
    {
        Http.Dispose();
        Factory.Dispose();
        GC.SuppressFinalize(this);
    }

    protected static StringContent Raw(string body) => new(body, Encoding.UTF8, "application/json");

    protected async Task<T> Read<T>(HttpResponseMessage res) => (await res.Content.ReadFromJsonAsync<T>(Json))!;

    protected async Task<TaskDto> CreateTask(object body)
    {
        var res = await Http.PostAsJsonAsync("/api/tasks", body, Json);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await Read<TaskDto>(res);
    }

    protected async Task<CategoryDto> CreateCategory(string name, string color = "#112233")
    {
        var res = await Http.PostAsJsonAsync("/api/categories", new { name, color }, Json);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await Read<CategoryDto>(res);
    }

    protected async Task<SubtaskDto> CreateSubtask(int taskId, string title, bool done = false)
    {
        var res = await Http.PostAsJsonAsync($"/api/tasks/{taskId}/subtasks", new { title, isCompleted = done }, Json);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await Read<SubtaskDto>(res);
    }

    protected async Task<List<TaskDto>> Tasks(string query = "") =>
        (await Http.GetFromJsonAsync<List<TaskDto>>("/api/tasks" + query, Json))!;

    protected async Task<TaskDto> GetTask(int id) => (await Http.GetFromJsonAsync<TaskDto>($"/api/tasks/{id}", Json))!;

    protected async Task<ExportDocument> Export() =>
        (await Http.GetFromJsonAsync<ExportDocument>("/api/export", Json))!;

    protected async Task<ImportSummary> Preview(string json)
    {
        var res = await Http.PostAsync("/api/import/preview", Raw(json));
        return await Read<ImportSummary>(res);
    }

    protected Task<HttpResponseMessage> Import(string json) => Http.PostAsync("/api/import", Raw(json));

    protected async Task<AnalyticsDto> Analytics(string query = "") =>
        (await Http.GetFromJsonAsync<AnalyticsDto>("/api/analytics" + query, Json))!;
}

public static class HttpExtensions
{
    public static Task<HttpResponseMessage> PatchAsJsonAsync(this HttpClient http, string url, object body, JsonSerializerOptions options) =>
        http.PatchAsync(url, JsonContent.Create(body, options: options));
}
