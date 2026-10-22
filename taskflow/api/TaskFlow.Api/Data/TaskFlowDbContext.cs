using Microsoft.EntityFrameworkCore;
using TaskFlow.Api.Models;

namespace TaskFlow.Api.Data;

public class TaskFlowDbContext(DbContextOptions<TaskFlowDbContext> options) : DbContext(options)
{
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<Category> Categories => Set<Category>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<TaskItem>(e =>
        {
            e.Property(t => t.Title).IsRequired().HasMaxLength(200);
            e.Property(t => t.Notes).HasMaxLength(4000);
            e.Property(t => t.Priority).HasConversion<string>().HasMaxLength(10);
            e.HasOne(t => t.Category).WithMany(c => c.Tasks)
                .HasForeignKey(t => t.CategoryId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(t => t.IsCompleted);
            e.HasIndex(t => t.DueDate);
        });
        b.Entity<Category>(e =>
        {
            // NOCASE: "work" and "Work" are the same category, for both the unique index and lookups.
            e.Property(c => c.Name).IsRequired().HasMaxLength(50).UseCollation("NOCASE");
            e.Property(c => c.Color).IsRequired().HasMaxLength(9);
            e.HasIndex(c => c.Name).IsUnique();
        });
    }
}
