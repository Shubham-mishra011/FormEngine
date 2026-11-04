using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Data;
using TaskFlow.Api.Dtos;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Services;

/// <summary>Creates and edits recurrence rules and spawns the next occurrence when one is completed.</summary>
public class RecurrenceService(TaskFlowDbContext db, TimeProvider time)
{
    public static void Validate(RecurrenceInput i, DateOnly anchor, string field = "Recurrence")
    {
        if (!Enum.IsDefined(i.Frequency)) throw ApiException.Invalid(field, "Unknown recurrence frequency.");
        if (i.Interval is < 1 or > 99) throw ApiException.Invalid(field, "Interval must be between 1 and 99.");
        if (i.Weekdays is { Count: > 0 })
        {
            if (i.Frequency != RecurrenceFrequency.Weekly) throw ApiException.Invalid(field, "Weekdays only apply to weekly recurrence.");
            if (i.Weekdays.Any(d => d is < 0 or > 6)) throw ApiException.Invalid(field, "Weekdays must be 0 (Sunday) to 6 (Saturday).");
        }
        if (i.MonthDays is { Count: > 0 })
        {
            if (i.Frequency != RecurrenceFrequency.Monthly) throw ApiException.Invalid(field, "Days of the month only apply to monthly recurrence.");
            if (i.MonthDays.Any(d => d != -1 && (d < 1 || d > 31))) throw ApiException.Invalid(field, "Days of the month must be 1–31 (or -1 for the last day).");
        }
        if (i.EndDate is { } end && end < anchor) throw ApiException.Invalid(field, "The end date is before the first occurrence.");
    }

    public static RecurrenceRule NewRule(RecurrenceInput i, DateOnly anchor, DateTime now)
    {
        var r = new RecurrenceRule { CreatedAt = now };
        Fill(r, i, anchor);
        return r;
    }

    /// <summary>Replaces the schedule in place (affects future occurrences) and reactivates the rule.</summary>
    public static void Fill(RecurrenceRule r, RecurrenceInput i, DateOnly anchor)
    {
        r.Frequency = i.Frequency;
        r.Interval = i.Interval;
        r.Weekdays = i.Frequency == RecurrenceFrequency.Weekly ? RecurrenceCalculator.JoinList(i.Weekdays) : null;
        r.MonthDays = i.Frequency == RecurrenceFrequency.Monthly ? RecurrenceCalculator.JoinList(i.MonthDays) : null;
        r.AnchorDate = anchor;
        r.EndDate = i.EndDate;
        r.MaxOccurrences = i.MaxOccurrences;
        r.IsActive = true;
        r.StoppedAt = null;
    }

    private DateOnly Today => DateOnly.FromDateTime(time.GetLocalNow().DateTime);

    /// <summary>
    /// Call after a task has been saved as completed. Adds (and saves) the next occurrence unless the series is
    /// over or that occurrence already exists. Safe to call twice: the (rule, occurrence number) unique index and
    /// the existence check mean a duplicate is never created.
    /// </summary>
    public async Task<TaskItem?> SpawnNextAsync(TaskItem done)
    {
        if (done.RecurrenceRuleId is not int ruleId) return null;
        var rule = done.RecurrenceRule ?? await db.RecurrenceRules.FindAsync(ruleId);
        if (rule is not { IsActive: true }) return null;

        var nextNumber = done.OccurrenceNumber + 1;
        if (await db.Tasks.AnyAsync(t => t.RecurrenceRuleId == ruleId && t.OccurrenceNumber == nextNumber)) return null;

        var now = time.GetUtcNow().UtcDateTime;
        var today = Today;
        DateOnly? nextDue = RecurrenceCalculator.HasRemaining(rule)
            ? RecurrenceCalculator.NextAfter(rule, done.DueDate ?? today, today)
            : null;
        if (nextDue is null)
        {
            rule.IsActive = false;
            rule.StoppedAt = now;
            done.Activity.Add(new ActivityEntry { Kind = "SeriesEnded", Detail = "Recurrence finished.", At = now });
            await db.SaveChangesAsync();
            return null;
        }

        var shift = done.DueDate is { } oldDue ? nextDue.Value.DayNumber - oldDue.DayNumber : 0;
        var next = new TaskItem
        {
            Title = done.Title, Description = done.Description, Notes = done.Notes,
            Priority = done.Priority, Status = WorkStatus.Todo, IsCompleted = false,
            DueDate = nextDue, DueTime = done.DueTime,
            StartDate = done.StartDate?.AddDays(shift),
            EstimatedMinutes = done.EstimatedMinutes, CategoryId = done.CategoryId,
            IsPinned = done.IsPinned, IsFavorite = done.IsFavorite,
            RecurrenceRuleId = ruleId, OccurrenceNumber = nextNumber,
            CreatedAt = now, UpdatedAt = now,
            SortOrder = (await db.Tasks.Where(t => t.Status == WorkStatus.Todo).MaxAsync(t => (int?)t.SortOrder) ?? -1) + 1,
        };
        var tz = time.LocalTimeZone;
        var dueUtc = ReminderTime.DueInstantUtc(next.DueDate, next.DueTime, tz);
        foreach (var r in done.Reminders.Where(r => r.MinutesBefore is not null))
            next.Reminders.Add(new Reminder
            {
                MinutesBefore = r.MinutesBefore,
                RemindAt = dueUtc!.Value.AddMinutes(-r.MinutesBefore!.Value),
            });
        var tagIds = await db.TaskTags.Where(x => x.TaskId == done.Id).Select(x => x.TagId).ToListAsync();
        foreach (var id in tagIds) next.TaskTags.Add(new TaskTag { TagId = id });
        var subs = await db.Subtasks.Where(s => s.TaskId == done.Id).OrderBy(s => s.SortOrder).ThenBy(s => s.Id).ToListAsync();
        for (var i = 0; i < subs.Count; i++)
            next.Subtasks.Add(new Subtask { Title = subs[i].Title, SortOrder = i, CreatedAt = now });
        next.Activity.Add(new ActivityEntry
        {
            Kind = "Created", At = now,
            Detail = $"Occurrence {nextNumber} of a recurring task, created when occurrence {done.OccurrenceNumber} was completed.",
        });

        rule.OccurrencesGenerated = Math.Max(rule.OccurrencesGenerated, nextNumber);
        db.Tasks.Add(next);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Lost a race against another request that created the same occurrence: keep that one.
            db.Entry(next).State = EntityState.Detached;
            foreach (var e in db.ChangeTracker.Entries().Where(e => e.State == EntityState.Added).ToList())
                e.State = EntityState.Detached;
            db.Entry(rule).State = EntityState.Unchanged;
            return null;
        }
        return next;
    }

    public async Task StopAsync(TaskItem t)
    {
        if (t.RecurrenceRuleId is not int id) throw ApiException.Invalid("Recurrence", "This task does not repeat.");
        var rule = await db.RecurrenceRules.FindAsync(id);
        if (rule is null) return;
        var now = time.GetUtcNow().UtcDateTime;
        if (rule.IsActive)
        {
            rule.IsActive = false;
            rule.StoppedAt = now;
            t.Activity.Add(new ActivityEntry { Kind = "RecurrenceStopped", At = now, Detail = "Recurrence stopped." });
        }
        t.UpdatedAt = now;
        await db.SaveChangesAsync();
    }
}
