using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaskFlow.Api.Migrations
{
    /// <inheritdoc />
    public partial class AdvancedFeatures : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ActualMinutes",
                table: "Tasks",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "Tasks",
                type: "TEXT",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "DueTime",
                table: "Tasks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EstimatedMinutes",
                table: "Tasks",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsFavorite",
                table: "Tasks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsPinned",
                table: "Tasks",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "OccurrenceNumber",
                table: "Tasks",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "RecurrenceRuleId",
                table: "Tasks",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SortOrder",
                table: "Tasks",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateOnly>(
                name: "StartDate",
                table: "Tasks",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Tasks",
                type: "TEXT",
                maxLength: 12,
                nullable: false,
                defaultValue: "Todo");

            // Existing completed tasks belong in the Done column (IsCompleted stays the source of truth).
            migrationBuilder.Sql("UPDATE Tasks SET Status = 'Done' WHERE IsCompleted = 1;");
            migrationBuilder.Sql("UPDATE Tasks SET OccurrenceNumber = 1;");

            migrationBuilder.CreateTable(
                name: "Activity",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false),
                    Detail = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    At = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Activity", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Activity_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Attachments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                    FileName = table.Column<string>(type: "TEXT", maxLength: 255, nullable: false),
                    StoredName = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    ContentType = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    SizeBytes = table.Column<long>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Attachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Attachments_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FocusSessions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TaskId = table.Column<int>(type: "INTEGER", nullable: true),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 12, nullable: false),
                    PlannedSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    ActualSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    Completed = table.Column<bool>(type: "INTEGER", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    EndedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FocusSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FocusSessions_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Notifications",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TaskId = table.Column<int>(type: "INTEGER", nullable: true),
                    Kind = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    Title = table.Column<string>(type: "TEXT", maxLength: 250, nullable: false),
                    Message = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    DedupeKey = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ReadAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    DismissedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Notifications_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "RecurrenceRules",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Frequency = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    Interval = table.Column<int>(type: "INTEGER", nullable: false),
                    Weekdays = table.Column<string>(type: "TEXT", maxLength: 20, nullable: true),
                    MonthDays = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    AnchorDate = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    MaxOccurrences = table.Column<int>(type: "INTEGER", nullable: true),
                    OccurrencesGenerated = table.Column<int>(type: "INTEGER", nullable: false),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    StoppedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecurrenceRules", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Reminders",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                    MinutesBefore = table.Column<int>(type: "INTEGER", nullable: true),
                    RemindAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    NotifiedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reminders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Reminders_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Tags",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 30, nullable: false, collation: "NOCASE"),
                    Color = table.Column<string>(type: "TEXT", maxLength: 9, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tags", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TaskTags",
                columns: table => new
                {
                    TaskId = table.Column<int>(type: "INTEGER", nullable: false),
                    TagId = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TaskTags", x => new { x.TaskId, x.TagId });
                    table.ForeignKey(
                        name: "FK_TaskTags_Tags_TagId",
                        column: x => x.TagId,
                        principalTable: "Tags",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TaskTags_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "Tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_RecurrenceRuleId_OccurrenceNumber",
                table: "Tasks",
                columns: new[] { "RecurrenceRuleId", "OccurrenceNumber" },
                unique: true,
                filter: "\"RecurrenceRuleId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_Status",
                table: "Tasks",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_UpdatedAt",
                table: "Tasks",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Activity_At",
                table: "Activity",
                column: "At");

            migrationBuilder.CreateIndex(
                name: "IX_Activity_TaskId_At",
                table: "Activity",
                columns: new[] { "TaskId", "At" });

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_TaskId",
                table: "Attachments",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_FocusSessions_StartedAt",
                table: "FocusSessions",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_FocusSessions_TaskId",
                table: "FocusSessions",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_CreatedAt",
                table: "Notifications",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_DedupeKey",
                table: "Notifications",
                column: "DedupeKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_TaskId",
                table: "Notifications",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_Reminders_NotifiedAt_RemindAt",
                table: "Reminders",
                columns: new[] { "NotifiedAt", "RemindAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Reminders_TaskId",
                table: "Reminders",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_Tags_Name",
                table: "Tags",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TaskTags_TagId",
                table: "TaskTags",
                column: "TagId");

            migrationBuilder.AddForeignKey(
                name: "FK_Tasks_RecurrenceRules_RecurrenceRuleId",
                table: "Tasks",
                column: "RecurrenceRuleId",
                principalTable: "RecurrenceRules",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Tasks_RecurrenceRules_RecurrenceRuleId",
                table: "Tasks");

            migrationBuilder.DropTable(
                name: "Activity");

            migrationBuilder.DropTable(
                name: "Attachments");

            migrationBuilder.DropTable(
                name: "FocusSessions");

            migrationBuilder.DropTable(
                name: "Notifications");

            migrationBuilder.DropTable(
                name: "RecurrenceRules");

            migrationBuilder.DropTable(
                name: "Reminders");

            migrationBuilder.DropTable(
                name: "TaskTags");

            migrationBuilder.DropTable(
                name: "Tags");

            migrationBuilder.DropIndex(
                name: "IX_Tasks_RecurrenceRuleId_OccurrenceNumber",
                table: "Tasks");

            migrationBuilder.DropIndex(
                name: "IX_Tasks_Status",
                table: "Tasks");

            migrationBuilder.DropIndex(
                name: "IX_Tasks_UpdatedAt",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "ActualMinutes",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "Description",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "DueTime",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "EstimatedMinutes",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "IsFavorite",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "IsPinned",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "OccurrenceNumber",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "RecurrenceRuleId",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "SortOrder",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "StartDate",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Tasks");
        }
    }
}
