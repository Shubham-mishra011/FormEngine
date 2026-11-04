# TaskFlow completion audit

Audit date: 2026-11-02. Method: every row below was checked against the code and a **fresh run** of the test suites in this session
(not against the progress document). Evidence columns name the tests/checks that exercise the feature.

Fresh results this session:

| Check | Result |
|-------|--------|
| Backend (`dotnet test taskflow\api\TaskFlow.slnx`) | **292 passed**, 0 failed |
| Frontend (`vitest run`) | **285 passed** in 17 files, 0 failed |
| TypeScript (`tsc -b`) | 0 errors |
| Lint (`oxlint`) | 0 errors (react-hooks / fast-refresh *warnings* remain, listed under Known issues) |
| Production build (`npm run build`) | passes (JS 375 kB / 111 kB gzip, CSS 36 kB) |
| Browser, real API + UI, temp DB (Playwright/Edge) | **53/53** feature checks (phase 1) + **6/6** after an API restart (phase 2) |
| Browser WCAG AA text-contrast scan, 20 routes × light/dark | **0 failures** |
| No horizontal overflow at 768 px and 390 px, 15 routes each | pass |
| Real database | migrated to `AdvancedFeatures`, `PRAGMA integrity_check = ok`, 0 foreign-key violations, file copy taken first |

Legend: **C** complete and verified · **I** implemented, not (fully) tested · **P** partial · **N** not started · **B** blocked by an external limit.

## A. Advanced task management
| Requirement | Status | Evidence / note |
|---|---|---|
| Create / edit / delete / duplicate | C | API tests; `tasks.test.tsx`; browser lifecycle |
| Complete / reopen | C | optimistic + rollback tests; browser |
| Description + notes | C | `TaskFeatureTests`, editor tests |
| Priority Low/Medium/High/Urgent | C | all layers; analytics includes Urgent |
| Due date + time, start date | C | validation tests (time needs date, start ≤ due) |
| Categories and tags | C | |
| Parent tasks / subtasks | C | see B |
| Estimated duration, actual tracking | C | estimate, time spent, `CompletedAt`, focus seconds per task |
| Pin and favorite | C | PUT keeps them when omitted (tested) |
| Attachments (local) | C | `AttachmentTests` (type allow-list, traversal, size, cleanup); browser upload. Files are not inside `.db` snapshots / JSON (documented) → see K |
| Bulk selection + actions | C | `Bulk_actions…` API test, UI tests, browser |
| Multi-criteria filtering, advanced search | C | server + client; `#tag`, AND of words, subtasks, categories |
| Custom sorting | C | created/updated/due/priority/title/board order, pinned first |
| Activity history, recently modified | C | `Activity_history…`; History tab; sort "Recently modified" |
| Clear completed with confirmation | C | UI test + browser |
| Quick-add everywhere, shortcuts | C | `quickAdd.test.ts` (12), `app.test.tsx`, browser |

## B. Subtasks
| One level of nesting by design; no self-reference ⇒ no cycles | C | schema + `SubtaskTests`; edit/delete/toggle; parent progress; kept on parent completion (browser); preserved in import/export |

## C. Tags and labels — C
CRUD, unique case-insensitive names, colours, multiple per task, filter, search (`#tag`), shown on cards, deleting a tag keeps tasks (`Tag_crud…`, `manage` UI tests, browser).

## D. Recurring tasks — C
Daily / weekly / monthly / yearly / interval / weekdays / month days / end date / max count; next occurrence on completion by any path (toggle, PUT, board, bulk); duplicate prevention (unique index, existence check, 4-way parallel test); history (`/occurrences`); month-end and leap-year handling; missed occurrences skipped and never auto-completed; stop / edit / preserve on edit; skip; export/import round trip. Evidence: 14 calculator unit tests + 18 API tests + browser (next occurrence, no duplicate on reopen/complete, edit keeps rule).

## E. Calendar — C
Month/week/day, upcoming + overdue + unscheduled panel, drag-and-drop **and** keyboard/touch rescheduling, quick create from a day, navigation + Today, category/priority/status filters, real data. 11 UI tests; browser drag-and-drop verified against the API.

## F. Kanban — C
Three columns, drag-and-drop + Move buttons, priority/due/category/tag/subtask indicators, search + filters, per-column quick add, responsive snap-scroll, persisted through `PATCH /status` (order via `SortOrder`). 12 UI tests; API tests for the Status⇔IsCompleted invariant and positioning; browser drag verified.

## G. Themes — C
Light / dark / system, manual toggle (top bar and Settings, kept in sync), persisted, no flash. Contrast scan passes on all 20 routes in both themes (found and fixed muted calendar chips). Modals, dropdowns, forms, calendar, board all themed.

## H. Productivity analytics — C
Today / week / month completions, created vs completed, completion %, daily / weekly / monthly trends, priority + category distribution, overdue stats, average completion time, current/best streaks; "—" when no data (no fabrication). `AnalyticsTests` + UI tests + browser KPIs.

## I. Focus timer
| Configurable durations, short/long breaks, start/pause/resume/reset, task link, session history, daily duration, statistics | C | 34 focus+notification tests; backend `FocusTests`; browser (pause, refresh persistence, completion recorded through a virtual clock) |
| Survives refresh; honest about background throttling | C | clock-derived, expiry-while-closed handled and disclosed on the page |
| Sound notification | I | WebAudio beep is guarded and unit-tested with stubs; actual audio output cannot be asserted headless |
| Browser notification (permission-gated) | I | tested with a stubbed `Notification`; a real permission prompt was not exercised in a browser |

## J. Reminders and notifications
| Reminders before deadline, custom times, multiple per task | C | relative + absolute; `ReminderTests` (9) |
| In-app notifications, mark read, dismiss, preferences, upcoming + overdue lists | C | bell UI tests; browser (unread badge, panel) |
| Browser notifications | I | as above |
| Alerts while the browser/tab is closed | **B** | Not possible without an always-on process or push service (a paid/cloud dependency, excluded). Documented in README, USER_GUIDE, ARCHITECTURE, Settings → About. |

## K. Import, export, backup
| Full JSON export (v2, reads v1), CSV export | C | CSV is formula-injection safe |
| Import preview, validation, duplicate detection, summaries, malformed JSON, schema versions (future versions refused politely) | C | 60+ tests incl. field-level errors with locations |
| Backup creation, history, never overwrites | C | |
| Restoration: transactional replace-all with confirmation + pre-restore snapshot, older-schema snapshots readable | C | `RestoreTests`; browser restore verified (data replaced, safety snapshot created) |
| Attachment **files** inside backups | **P** | records are exported and re-linked on restore when the file still exists; the files themselves are not bundled (documented; ROADMAP idea: zip bundle) |
| Default folder `E:\FormEngine\data\backups\` | C | |

## L. Dashboard and workspace — C
Greeting, today, upcoming, overdue, high priority, progress ring, focus summary, productivity summary, shortcuts, customisable widgets, quick-add hint, skeletons, empty states, 16 tests, browser + 390 px screenshot reviewed.

## M. Search, command palette — C
Global quick search on every list (`/`), Ctrl+K palette (navigation, actions, theme, finds tasks), G-prefixed navigation, `?` help; single-letter shortcuts suppressed while typing and with modifiers.

## N. Settings and personalisation — C
Theme, default priority, default view, week start, date and time format, reminder preferences, focus settings, dashboard widgets, backup (folders, restore), shortcut reference, About/version, reset. 23 tests. Stored in `localStorage` (documented; not in the DB).

## O. UI/UX — C
Grouped 13-item sidebar, drawer on mobile, modals with focus trap + Escape (topmost only), confirmations, toasts, skeletons, tooltips (`title`), reduced-motion support, responsive 390/768/desktop with zero horizontal overflow on every route.

## P. Backend architecture and database safety
| Controllers → Services → EF Core → SQLite, DTOs, DI, async, consistent ProblemDetails, status codes | C | no business logic in controllers; `ApiException` handler |
| Additive migrations, indexes, cascade rules reviewed | C | `DATABASE_SCHEMA.md`; `MigrationTests` seeds an old database and upgrades it |
| Real DB protected | C | copy taken before first migration (`data\backups\premigration-20261101-manual`, verified readable), daily copy by `start.ps1`; real DB never deleted/reset |

## Q. Security, reliability, performance
| Item | Status | Note |
|---|---|---|
| Input validation, EF parameterisation, LIKE escaping, import validation | C | |
| Upload validation | C | allow-list, generated names, nosniff, download-only |
| Localhost binding | C | `applicationUrl` localhost; `AllowedHosts` limited to localhost names |
| Cross-site writes (CSRF / DNS-rebinding style) | C | **found and fixed this session**: browsers can send body-less cross-site POSTs (e.g. `…/restore?confirm=true`) without a CORS preflight; the API now refuses any write whose `Origin` is not the app (`CrossOriginTests`) |
| Duplicate submission / races | C | buttons disabled while busy; Serializable (`BEGIN IMMEDIATE`) write transactions; unique index; parallel-completion test |
| Concurrent edits of one task | P | last write wins (documented) |
| Large datasets | C | automated test with 1 500 tasks; ad-hoc run with 9 000 imported tasks: import 9.4 s, list-all 2.5 s (includes PowerShell JSON parsing), filtered search 0.9 s, calendar month 0.8 s, analytics 0.1 s, API memory ≈ 340 MB working set. Fine for personal use; the UI loads all tasks (see ARCHITECTURE for the paging trade-off) |

## R. Testing
Backend 292, frontend 285, browser 59 checks + contrast scan + overflow scan. Browser scripts live outside the repo in `E:\FormEngine\.tools\e2e` (run3.mjs, contrast-all.mjs, full.ps1) and use a separate temp database.

## S. Documentation / delivery — C
README, ROADMAP (reflects reality), IMPLEMENTATION_PROGRESS, ARCHITECTURE, DATABASE_SCHEMA, API_REFERENCE, USER_GUIDE, this audit; `scripts\start.ps1` / `stop.ps1` (tested against the real database; stopped afterwards).

## Known issues (none critical)
* `oxlint` reports react-hooks "set-state-in-effect" and fast-refresh export warnings (cosmetic/guidance, not failures).
* Real audio output and the real browser-notification permission prompt are unverified in automation.
* Alerts require an open tab (B above).
* The `.tools\e2e` browser scripts are not in git (the folder is deliberately ignored).

## Remaining work
None of the directive's requirements is NOT STARTED. Items marked B/P/I are limits or verification gaps, not missing features.
