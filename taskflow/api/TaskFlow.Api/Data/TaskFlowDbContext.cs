using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Data;

/// <summary>
/// The data-access layer: EF Core's DbContext is the unit of work and its DbSets are the repositories.
/// Business rules live in the services, never in controllers or here.
/// </summary>
public class TaskFlowDbContext(DbContextOptions<TaskFlowDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Subtask> Subtasks => Set<Subtask>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<TaskTag> TaskTags => Set<TaskTag>();
    public DbSet<RecurrenceRule> RecurrenceRules => Set<RecurrenceRule>();
    public DbSet<Reminder> Reminders => Set<Reminder>();
    public DbSet<AppNotification> Notifications => Set<AppNotification>();
    public DbSet<FocusSession> FocusSessions => Set<FocusSession>();
    public DbSet<ActivityEntry> Activity => Set<ActivityEntry>();
    public DbSet<Attachment> Attachments => Set<Attachment>();

    protected override void ConfigureConventions(ModelConfigurationBuilder b) => b.UseUtcDateTimes();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TaskItem>(e =>
        {
            e.Property(t => t.Title).IsRequired().HasMaxLength(200);
            e.Property(t => t.Description).HasMaxLength(4000);
            e.Property(t => t.Notes).HasMaxLength(4000);
            e.Property(t => t.Priority).HasConversion<string>().HasMaxLength(10);
            e.Property(t => t.Status).HasConversion<string>().HasMaxLength(12).HasDefaultValue(WorkStatus.Todo);
            e.HasOne(t => t.Category).WithMany(c => c.Tasks)
                .HasForeignKey(t => t.CategoryId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(t => t.RecurrenceRule).WithMany()
                .HasForeignKey(t => t.RecurrenceRuleId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(t => t.IsCompleted);
            e.HasIndex(t => t.DueDate);
            e.HasIndex(t => t.Status);
            e.HasIndex(t => t.UpdatedAt);
            e.HasIndex(t => t.CategoryId);
            // One task per (series, occurrence number): the database refuses a duplicate occurrence even in a race.
            e.HasIndex(t => new { t.RecurrenceRuleId, t.OccurrenceNumber }).IsUnique()
                .HasFilter("\"RecurrenceRuleId\" IS NOT NULL");
        });
        b.Entity<Subtask>(e =>
        {
            e.Property(s => s.Title).IsRequired().HasMaxLength(200);
            e.HasOne(s => s.Task).WithMany(t => t.Subtasks)
                .HasForeignKey(s => s.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(s => new { s.TaskId, s.SortOrder });
        });
        b.Entity<Category>(e =>
        {
            // NOCASE: "work" and "Work" are the same category, for both the unique index and lookups.
            e.Property(c => c.Name).IsRequired().HasMaxLength(50).UseCollation("NOCASE");
            e.Property(c => c.Color).IsRequired().HasMaxLength(9);
            e.HasIndex(c => c.Name).IsUnique();
        });
        b.Entity<Tag>(e =>
        {
            e.Property(x => x.Name).IsRequired().HasMaxLength(30).UseCollation("NOCASE");
            e.Property(x => x.Color).IsRequired().HasMaxLength(9);
            e.HasIndex(x => x.Name).IsUnique();
        });
        b.Entity<TaskTag>(e =>
        {
            e.HasKey(x => new { x.TaskId, x.TagId });
            e.HasOne(x => x.Task).WithMany(t => t.TaskTags).HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Tag).WithMany(t => t.TaskTags).HasForeignKey(x => x.TagId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.TagId);
        });
        b.Entity<RecurrenceRule>(e =>
        {
            e.Property(r => r.Frequency).HasConversion<string>().HasMaxLength(10);
            e.Property(r => r.Weekdays).HasMaxLength(20);
            e.Property(r => r.MonthDays).HasMaxLength(100);
        });
        b.Entity<Reminder>(e =>
        {
            e.HasOne(r => r.Task).WithMany(t => t.Reminders).HasForeignKey(r => r.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(r => new { r.NotifiedAt, r.RemindAt });
            e.HasIndex(r => r.TaskId);
        });
        b.Entity<AppNotification>(e =>
        {
            e.Property(n => n.Kind).HasConversion<string>().HasMaxLength(10);
            e.Property(n => n.Title).IsRequired().HasMaxLength(250);
            e.Property(n => n.Message).HasMaxLength(500);
            e.Property(n => n.DedupeKey).IsRequired().HasMaxLength(100);
            e.HasOne(n => n.Task).WithMany().HasForeignKey(n => n.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(n => n.DedupeKey).IsUnique();
            e.HasIndex(n => n.CreatedAt);
        });
        b.Entity<FocusSession>(e =>
        {
            e.Property(f => f.Kind).HasConversion<string>().HasMaxLength(12);
            // Sessions are history: deleting a task keeps its sessions, just unlinked.
            e.HasOne(f => f.Task).WithMany().HasForeignKey(f => f.TaskId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(f => f.StartedAt);
        });
        b.Entity<ActivityEntry>(e =>
        {
            e.Property(a => a.Kind).IsRequired().HasMaxLength(30);
            e.Property(a => a.Detail).HasMaxLength(500);
            e.HasOne(a => a.Task).WithMany(t => t.Activity).HasForeignKey(a => a.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(a => new { a.TaskId, a.At });
            e.HasIndex(a => a.At);
        });
        b.Entity<Attachment>(e =>
        {
            e.Property(a => a.FileName).IsRequired().HasMaxLength(255);
            e.Property(a => a.StoredName).IsRequired().HasMaxLength(80);
            e.Property(a => a.ContentType).IsRequired().HasMaxLength(100);
            e.HasOne(a => a.Task).WithMany(t => t.Attachments).HasForeignKey(a => a.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(a => a.TaskId);
        });
    }
}
