namespace TaskFlow.Api.Models;

public enum RecurrenceFrequency { Daily = 0, Weekly = 1, Monthly = 2, Yearly = 3 }

/// <summary>
/// The schedule shared by every occurrence of a recurring task. Occurrences are ordinary tasks that point
/// here, so completed occurrences remain as history. <see cref="AnchorDate"/> is the original start; all
/// dates are computed from it (not from the previous occurrence) so "the 31st" does not drift to the 28th.
/// </summary>
public class RecurrenceRule
{
    public int Id { get; set; }
    public RecurrenceFrequency Frequency { get; set; }
    public int Interval { get; set; } = 1;
    /// <summary>Comma-separated DayOfWeek numbers (0 = Sunday), weekly only. Empty = the anchor's weekday.</summary>
    public string? Weekdays { get; set; }
    /// <summary>Comma-separated days of month, monthly only; 31 or -1 mean "last day" in short months.</summary>
    public string? MonthDays { get; set; }
    public DateOnly AnchorDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public int? MaxOccurrences { get; set; }
    /// <summary>How many occurrences exist so far (including the first). Counts toward MaxOccurrences.</summary>
    public int OccurrencesGenerated { get; set; } = 1;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime? StoppedAt { get; set; }
}
