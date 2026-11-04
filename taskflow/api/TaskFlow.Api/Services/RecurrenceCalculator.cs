using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

/// <summary>
/// Pure date arithmetic for recurrence (no database, no clock), so it can be tested exhaustively.
/// A date is "scheduled" when it satisfies the rule measured from <see cref="RecurrenceRule.AnchorDate"/>;
/// measuring from the anchor (not from the previous occurrence) is what stops "the 31st" drifting to the 28th.
/// </summary>
public static class RecurrenceCalculator
{
    private const int HorizonDays = 366 * 40;

    public static List<int> ParseList(string? csv) =>
        string.IsNullOrWhiteSpace(csv) ? [] :
        csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
           .Select(s => int.TryParse(s, out var n) ? n : int.MinValue).Where(n => n != int.MinValue).Distinct().Order().ToList();

    public static string? JoinList(IEnumerable<int>? values)
    {
        var list = values?.Distinct().Order().ToList();
        return list is null or { Count: 0 } ? null : string.Join(',', list);
    }

    /// <summary>Is <paramref name="d"/> one of the rule's scheduled dates?</summary>
    public static bool IsScheduled(RecurrenceRule r, DateOnly d)
    {
        var a = r.AnchorDate;
        var interval = Math.Max(1, r.Interval);
        if (d < a) return false;
        switch (r.Frequency)
        {
            case RecurrenceFrequency.Daily:
                return (d.DayNumber - a.DayNumber) % interval == 0;

            case RecurrenceFrequency.Weekly:
            {
                var days = ParseList(r.Weekdays);
                if (days.Count == 0) days = [(int)a.DayOfWeek];
                if (!days.Contains((int)d.DayOfWeek)) return false;
                var weeks = (MondayOf(d).DayNumber - MondayOf(a).DayNumber) / 7;
                return weeks % interval == 0;
            }

            case RecurrenceFrequency.Monthly:
            {
                var months = (d.Year - a.Year) * 12 + d.Month - a.Month;
                if (months % interval != 0) return false;
                var days = ParseList(r.MonthDays);
                if (days.Count == 0) days = [a.Day];
                var dim = DateTime.DaysInMonth(d.Year, d.Month);
                return days.Any(day => d.Day == (day == -1 ? dim : Math.Min(day, dim)));
            }

            case RecurrenceFrequency.Yearly:
            {
                var years = d.Year - a.Year;
                if (years % interval != 0 || d.Month != a.Month) return false;
                return d.Day == Math.Min(a.Day, DateTime.DaysInMonth(d.Year, d.Month));
            }

            default:
                return false;
        }
    }

    /// <summary>
    /// The next occurrence date after <paramref name="after"/> (normally the completed task's due date).
    /// Missed occurrences are skipped, not queued: the result is never before <paramref name="today"/>, so
    /// finishing a task three weeks late does not spawn three weeks of backlog. Honors EndDate; the occurrence
    /// count limit is applied by the caller. Null means the series is over.
    /// </summary>
    public static DateOnly? NextAfter(RecurrenceRule r, DateOnly after, DateOnly today)
    {
        var start = after.AddDays(1);
        if (start < today) start = today;
        if (start < r.AnchorDate) start = r.AnchorDate;
        for (var i = 0; i < HorizonDays; i++)
        {
            var d = start.AddDays(i);
            if (r.EndDate is { } end && d > end) return null;
            if (IsScheduled(r, d)) return d;
        }
        return null;
    }

    public static bool HasRemaining(RecurrenceRule r) => r.MaxOccurrences is not { } max || r.OccurrencesGenerated < max;

    public static DateOnly MondayOf(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
