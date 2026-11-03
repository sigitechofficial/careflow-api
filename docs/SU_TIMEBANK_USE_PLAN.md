# Service user timebank — using the bank (plan)

Status: PLAN, 3 Nov 2026. Nothing built yet. Builds on the report-only Timebank (Reports › Timebank,
built 2 Nov, uncommitted) and the SU weekly hours rules (`docs/SU_WEEKLY_HOURS_SIMPLIFY_PLAN.md`).

## 1. What exists today (verified in code)

| Fact | Evidence |
|---|---|
| The bank is not stored. It is worked out on every read from rota jobs, visit reconciliations and the DOM Care weekly-hours audit history. | `src/service-user-hours/service-user-timebank.util.ts` `computeTimebankWeeks` (header comment) |
| A finished week adds `freeMinutes = set − (delivered + pending + scheduled + awaiting clock-out)` to the bank. Over-delivery takes nothing out. | `service-user-timebank.util.ts` ~L605–617 |
| Visits cancelled by an hours cut (`OTHER` + note `Weekly contracted hours reduced to …`) are left out of every count. | `timebankRemovedByHoursCut`; note written in `visit-plan-date-changes.service.ts:1944` |
| Clocked-in visits with no clock-out are `AWAITING_CLOCK_OUT`, not short. | `service-user-timebank.util.ts:479` |
| The weekly-hours check compares a week's rota minutes with the weekly hours only. It knows nothing about the bank. | `visit-plan-weekly-hours.service.ts` `classifyNewVisits`, `checkLongerVisit`, `withLimit` |
| SU weekly-hours settings are a JSON column. A new setting needs no migration. | `organisationGeneralSettings.serviceUserWeeklyHoursSettings`; `service-user-weekly-hours-settings.util.ts`; DTO `dom-care-settings.dto.ts` `ServiceUserWeeklyHoursSettingsDto` (whitelist + forbidNonWhitelisted) |

### Places where a new visit or longer visit is checked against the weekly hours (all verified)

| # | Path | Code |
|---|---|---|
| P1 | Plan visits made by generate, bulk generate and the nightly rolling rota | `service-user-visit-plans.service.ts` `generateSchedule` → `heldOverHours` (~L3051) |
| P2 | Extra visits added on a plan | `visit-plan-date-changes.service.ts` extra add (`classifyExtraDates`, ~L1236). The job is created directly in that flow (`scheduledJob.create`, ~L1398). |
| P3 | Extra visit made longer | `visit-plan-date-changes.service.ts` `editExtraVisit` → `checkExtraEdit` (~L2137) |
| P4 | Plan amendment that makes plan visits longer | `service-user-visit-plans.service.ts` `holdLongerPlanVisits` (~L1813) |
| P5 | Special visit created | `special-visits.service.ts` `serviceUserHoursCheck` (~L224) |

### Places where a rota visit stops being live (all verified)

| # | Path | Code |
|---|---|---|
| C1 | Cancel / call off from the rota board, and plan "cancel visits" | `scheduled-jobs-housekeeping.service.ts` `cancelJob` (plan date changes call it at `visit-plan-date-changes.service.ts:737`) |
| C2 | Plan end / suspend and other lifecycle cancels | `schedule-lifecycle-impact.service.ts` `cancelJobInTransaction` (L206, L528) |
| C3 | Hours cut: special visits set to CANCELLED | `visit-plan-date-changes.service.ts:1979` |
| C4 | Special visit removed | `special-visits.service.ts` `remove` (soft delete + CANCELLED) |
| C5 | Rota job deleted | `scheduled-jobs.service.ts` ~L503 (soft delete) |
| C6 | Reinstate (visit becomes live again) | `scheduled-jobs-housekeeping.service.ts` `reinstateJob` |

The visit workspace loads the job with `GET /scheduled-jobs/:id` (`careflow-admin/.../ScheduleVisitWorkspaceSheet.tsx`, `getScheduledJob`).

## 2. Decisions by the user (3 Nov)

1. New setting: **"Use timebank hours automatically"**, Yes/No (Settings → Dom Rules → Service user weekly hours).
2. **No:** everything works as today. The bank balance is only shown, and only when it is above 0.
3. **Yes:** when a new visit takes a week over the weekly hours, the hours over come from the bank. They are **reserved when the visit is put on the rota**.
4. Every use is **stored**: when, which visit, how many minutes. The visit workspace shows "taken from the timebank". The schema change was agreed.
5. **Visit cancelled → the reserved time goes back** to the bank.
6. **Bank empty →** the current setting "Visits over the weekly hours need manager approval" decides, as today.
7. Office cancel, missed visits and SU cancels add to the bank (already true in the report). The SU late-cancel charge cases are **left out** for now.

## 3. Design

### 3.1 New table (hand-written migration, schema `service_users`)

`ServiceUserTimebankEntry`. Rows are only ever added; nothing is updated or deleted.

| Column | Meaning |
|---|---|
| id | uuid |
| serviceUserId | service user |
| scheduledJobId | the visit (nullable FK, `onDelete: SetNull`, so the record survives a hard delete) |
| weekStart | Monday of the visit's week (date) |
| kind | `RESERVED` (taken from the bank) or `RETURNED` (given back) |
| minutes | positive |
| reason | e.g. `NEW_VISIT`, `LONGER_VISIT`, `VISIT_CANCELLED`, `VISIT_REMOVED`, `WEEK_NEEDED_LESS`, `NOT_DELIVERED` |
| note | readable text shown on screen |
| createdById | user, null for the system |
| createdAt | when |

Plus indexes on `serviceUserId`, `scheduledJobId`, `weekStart`.

A visit's **reserved minutes** = its RESERVED − its RETURNED.

### 3.2 Bank balance

- **Earned** = sum of finished weeks' `freeMinutes`, exactly as the report does today.
- **Available** = earned − sum of all net reserved minutes.
- Each over-hours check counts a week as having **weekly hours + reserved minutes of that week**. Visits already paid from the bank then do not make the week look over again.

### 3.3 Reserving (setting = Yes), at P1–P5

At the point where the code decides a visit is over:

1. `over part` = week minutes after the visit − (weekly hours + reserved minutes of the week).
2. If the bank covers it (see the open decision on partial cover): the visit is made as within the hours, and a `RESERVED` entry is written for the new job, with reason `NEW_VISIT` or `LONGER_VISIT`. It is written in the same transaction where one exists.
3. Otherwise the current behaviour runs unchanged: held for approval, or made with a warning.

With setting = No, P1–P5 behave exactly as today.

### 3.4 Giving time back (one shared "settle" step, no change to C1–C6)

`settle(serviceUserId)` writes `RETURNED` entries when a visit's reserved time is no longer used:

- **Job cancelled or deleted** (C1–C5): return all of its reserved minutes (`VISIT_CANCELLED` / `VISIT_REMOVED`). The entry's time is the cancellation or delete time.
- **Week needs less** (another visit cancelled, or weekly hours raised): needed = max(0, week minutes − weekly hours). Return the difference, latest reserved visits first (`WEEK_NEEDED_LESS`).
- **Week finished**: needed = max(0, covered − set), using the report's own `covered`. A paid-from-bank visit that was missed, shorter or not approved gives its unused time back (`NOT_DELIVERED`). This follows decision 7 (missed hours go to the bank).

`settle` runs:
- before every over-hours check (P1–P5)
- when Timebank pages load
- in the nightly rolling rota

Because it reads the jobs themselves, the cancel paths C1–C6 need no edits.

### 3.5 Screens (admin)

- **Settings → Dom Rules:** new Yes/No row with a plain tooltip.
- **Visit workspace:** a line such as "Timebank: 1h 30m taken from the bank on 03/11/2026", plus "1h 30m given back on … (visit cancelled)" when returned. The data comes from `GET /scheduled-jobs/:id` (new `timebank` field) or a small endpoint.
- **Timebank › service user page:** balance as earned / reserved / available, plus a list of entries (date, visit, minutes, reason).
- **Messages:** the messages at P1–P5 say "1h taken from the timebank" when the bank was used.

## 4. Left out on purpose (unclear, not built)

- SU late-cancel charge cases (charged / partial % / PENDING_REVIEW).
- Reinstated visit (C6): no new reservation. The week simply counts it, as today.
- Manager approving a held visit: made over the hours, as today. No bank.
- Hours decrease: works as today (cancels the visits over the new hours). Bank time of the cancelled visits goes back through `settle`.
- Visits already over before this feature, or made with a warning: the bank is not applied to them afterwards.
- Late clock-in sync after a week ended can make "available" go below 0. It is shown as it is; nothing automatic happens.
- Carer timebank: not affected.

## 5. Decisions taken 3 Nov (asked before building)

- **O1 Partial cover = all or nothing.** The bank is used only when it covers the visit's whole over part. Otherwise the bank is not touched and setting 2 (approval / warning) applies to the visit.
- **O2 Balance also shows** on the visit plan's weekly hours panel and on the SU DOM Care tab (next to weekly contracted hours), besides Reports › Timebank and the visit workspace. Setting No: shown only when > 0.

## 6. Steps

0. `pg_dump -Fc` backup of local `careadmin`.
1. Prisma model + hand-written migration; `prisma validate`; `migrate deploy` locally; `prisma generate`.
2. Setting `useTimebank` (util parse/default No, DTO, admin type/defaults).
3. `ServiceUserTimebankLedgerService`: available(), reservedByWeek(), reserve(), settle(). It reuses `ServiceUserTimebankService` for "earned".
4. Wire P1–P5 (only when setting = Yes).
5. `settle` calls: before checks, Timebank load, nightly run.
6. API for entries: Timebank detail + job detail.
7. Admin: settings row, workspace line, Timebank entries and balance.
8. Tests: unit (settle maths, partial cover), tsc, related jest; live test on a fresh demo SU (see §7).

## 7. Tests

- **T1** Setting No: an over visit is held or warned exactly as today. No entries are written.
- **T2** Setting Yes, bank 5h, week 20h set: a 2h extra visit over the hours → made, RESERVED 2h, available 3h, workspace shows it.
- **T3** Cancel that visit → RETURNED 2h, available back to 5h.
- **T4** Cancel a different visit in the same week → `WEEK_NEEDED_LESS` return.
- **T5** Bank empty → held (setting 2 Yes) / warned (setting 2 No).
- **T6** Plan generate and nightly run reserve per visit.
- **T7** Special visit and longer extra visit reserve.
- **T8** Finished week where the paid-from-bank visit was missed → `NOT_DELIVERED` return.
- **T9** Timebank page balances add up: earned − reserved = available.

## 8. Built and tested (3 Nov 2026, uncommitted)

**Built**
- Table `service_users.ServiceUserTimebankEntry` + enum (migration `20261112090000_su_timebank_entries`, applied locally after backup `db-backups/careadmin-before-su-timebank-ledger-20261103.dump`). Not run on live.
- Setting `useTimebank` (default No) in `serviceUserWeeklyHoursSettings` JSON; admin row "Use timebank hours automatically".
- `ServiceUserTimebankLedgerService` (`src/service-user-hours/service-user-timebank-ledger.service.ts`): `budget`, `balance`, `reserve`, `settle`, `settleAll`, `entries`, `forJob`; `TimebankBudget` (all or nothing).
- Weekly-hours checks count a week as weekly hours + minutes its visits hold (`classifyNewVisits`, `checkLongerVisit`, `checkExtraEdit`, `withLimit`).
- P1 `generateSchedule` (also nightly/bulk), P2 extra add (+ preview), P3 extra edit (+ preview), P4 plan amendment longer visits, P5 special visit create: reserve when the bank covers.
- Settle: before every check, on Timebank / balance loads, nightly rolling rota (`settleAll`).
- API: `GET /service-user-hours/timebank/:id/balance`, `GET /service-user-hours/timebank/jobs/:jobId`, Timebank detail adds `timebank` (balance + entries).
- Admin: setting row; Timebank page "In timebank" = available + "Timebank used" card; DOM Care tab and visit plan panel balance note; visit workspace (sheet + visit hub page) note; extra visit dialog and special visit toast say "taken from the timebank".

**Tests**
- Unit: ledger spec (6) + weekly-hours spec timebank case; related suites 33 / 245 pass; API tsc 0; admin tsc 0.
- Live (local, Raymond Okonkwo, bank 4h 34m): T1 setting No → held as before, no entries ✔; T2 extra 1h30 → 60m reserved, week not over ✔; T4 cancel 30m plan visit same week → 30m WEEK_NEEDED_LESS ✔; T3 extra removed → 30m VISIT_REMOVED ✔; T5 5h30 over > bank → needs approval, bank untouched ✔; T7 special 2h → 90m reserved, removed → returned ✔; T6 generate 1–4 Dec over 8h → 6 visits, 270m reserved ✔, then special removed → 270m returned latest first ✔; T9 earned − held = available ✔.
- UI checked: settings row, Timebank page ledger, DOM Care note, visit plan panel note, visit hub note.
- Not live-tested: T8 finished week NOT_DELIVERED (unit only); P3 extra edit and P4 plan amendment (code path shared with tested ones, not run live); visit workspace **sheet** on the rota board (hub page checked).

**Test clean-up:** T4 visit reinstated; test extras/specials removed; setting back to No. Left: ledger rows of the tests (history, net 0) and Raymond's plan visits 1–4 Dec made early by T6 (normal plan visits the nightly run would make).

**Follow-up 3 Nov — generate messages bank-aware (uncommitted)**
- Preview `weeklyHoursRunWarning` returns `{ warning, timebank }`: a week counts weekly hours + what visits already hold; with the setting on, the time this run's new visits add above that (never a week already over before it) is paid from the bank when it covers it in full → listed in `weeklyHoursTimebank` ("Timebank: 1h will be taken … — week of …"), not in the over warning. Partial: adds "The Xh left is used only for a visit whose whole time over it can pay". Setting No: warning as before.
- Run result adds `weeklyHoursTimebank` ("Timebank: 1h taken …") from the rows actually reserved. `weeklyHoursWarning` unchanged, so bulk generate and the nightly run (which collect it) are unchanged.
- Admin: generate preview dialog shows the timebank note (grey, piggy bank); generate toasts (visit plan, absence return) append it.
- Live (Raymond, horizon temporarily 35/36 days, 6h special on 8 Dec): preview 7–8 Dec setting No → "Over … week of 07/12/2026: 9h … Hours approvals" ✔; setting Yes → no warning, "1h will be taken" ✔; run → 4 visits, 2 × 30m reserved, result "1h taken" ✔; dialog note checked in the browser (9 Dec: "1h 30m will be taken") ✔. Clean-up: special removed → 60m returned; horizon 28 and setting No restored. Left: 4 plan visits 7–8 Dec made early.
- Unchanged and known: the preview only counts weeks up to the rota horizon (as before); the visit plan weekly-hours panel still shows a week over before the run even when the bank will pay for it.

**Follow-up 3 Nov — Hours approvals screen counts the bank (uncommitted)**
- Request payloads (extra visit `EXTRA_VISIT`, held `PLAN_VISIT` / `SPECIAL_VISIT` / `EXTRA_EDIT` / `PLAN_TIME`) store `timebankMinutes`: what the week's visits held from the bank when asked (PLAN_TIME: the busiest week). Older requests have none → shown as before.
- `currentExtraVisitWeekHours` (pending extra visits, the week as it is now) also returns `timebankMinutes` from the ledger.
- Admin Hours approvals: room = weekly hours + bank minutes. Row "13h that week (1h from the timebank)", over column "+4h" (was +5h), approve dialog "13h of 8h weekly contracted hours + 1h from the timebank", green "Now within…" note uses the same room.
- Not changed: approve/reject rules; approving still makes the visit over the hours without the bank; auto-approve when weekly hours go up (`autoApproveServiceUserVisits`) still compares with the weekly hours only.
- Live (Raymond, setting Yes): extra A 1h30 on 24 Nov → 60m from bank; extra B 4h on 25 Nov → approval (bank 3h34 < 4h). API payload + currentWeek `timebankMinutes: 60` ✔; screen row and approve dialog as above ✔. Green note not live-tested (same comparison as the over column). Clean-up: B rejected, A deleted (60m returned), setting No.
