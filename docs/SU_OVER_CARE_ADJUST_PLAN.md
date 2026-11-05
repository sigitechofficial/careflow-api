# Service user over care — taken back the next week (plan)

Status: BUILT 4 Nov 2026 (uncommitted), D1–D7 approved by the user. Results in §6. Builds on the Timebank (`docs/SU_TIMEBANK_USE_PLAN.md`)
and the SU weekly hours rules (`docs/SU_WEEKLY_HOURS_SIMPLIFY_PLAN.md`).

## 1. What exists today (verified in code)

| Fact | Evidence |
|---|---|
| Each week's over care is already worked out: `overMinutes = covered − setMinutes`, where covered = delivered (approved for invoice) + pending (done, not approved) + scheduled + awaiting clock-out + chargeable cancellations. It never changes the bank. | `src/service-user-hours/service-user-timebank.util.ts` ~L641–656 |
| Timebank list shows it under "Over contract"; the SU timebank page shows "+Xh over contract" per week. | `careflow-admin/src/features/timebank/pages/TimebankPage.tsx:71,452`, `TimebankServiceUserPage.tsx:653` |
| Visits paid from the timebank (ledger RESERVED) and visits a manager approved over the hours still count in `overMinutes`. | `computeTimebankWeeks` has no ledger or approval input |
| An approved SU hours request stores the visit it made: `requestPayload.createdJobId`. | `employee-hours-approvals.service.ts:858` |
| "Cancel visits so a week fits a lower limit" already exists: `planHoursDecrease` / `applyHoursDecrease` — latest visits first, from tomorrow to the rota horizon, through the normal plan "Cancel visits" (SKIP kept so the rota never remakes it, reason OTHER + note, NO_CHARGE, carers taken off and pushed). Today's visits are never picked. | `src/service-user-visit-plans/visit-plan-date-changes.service.ts:1672`, `:1972`; carer push in `scheduled-jobs-housekeeping.service.ts` `cancelJob` |
| Timebank leaves hours-cut cancels out of every count by their note prefix (outcome `REMOVED_HOURS_REDUCED`). | `service-user-timebank.util.ts:277–286`, `:420–432` |
| The nightly rolling rota job already settles the timebank ledger each run. | `visit-plan-rolling-rota.job.ts` `approveCarerRequestsBackWithinLimit` |
| Managers with `hours_approvals.manage` get hours notifications (`approverUserIds`). | `employee-hours-approval-notification.hook.ts` |
| SU weekly-hours settings are a JSON column — a new setting needs no migration. | `serviceUserWeeklyHoursSettings` |

## 2. Decisions by the user (4 Nov)

| # | Decision |
|---|---|
| U1 | New setting, **default Yes**: over care in a finished week is taken back the next week automatically (no manager approval). Example: weekly 20h, week got 25h → next week 5h of visits are cancelled. |
| U2 | The cancelled visits keep a record of why ("the service user already had over care"), and it is shown. |
| U3 | Wherever over care is shown, an info tag says over care was given and next week's visits are (or will be) cancelled, with **See visits** opening a dialog of those visits. |
| U4 | Managers see it wherever needed. |

## 3. My proposals — to confirm

| # | Proposal | Why |
|---|---|---|
| D1 | Over to take back = care given (delivered + pending) − weekly hours − timebank-paid minutes of that week − minutes of visits a manager approved over the hours (`createdJobId`). Scheduled, awaiting clock-out and chargeable cancellations are **not** counted. | Only care actually given; bank and manager-approved time is already agreed. |
| D2 | Runs in the nightly rolling rota job, for the week that just finished. It cancels in the next week **from tomorrow** (the run day's visits are never picked — same as the hours cut), latest visits first. | Reuses `planHoursDecrease`. |
| D3 | If the next week can't take all of it (not enough visits left), the rest is **not carried on**; it is shown to managers as "not taken back". | Keeps it one week, as asked. |
| D4 | Cancel as NO_CHARGE, cancelled by "Other", note `Over care adjustment — week of DD/MM/YYYY had Xh over`. | Same as the hours cut; visit was never given. |
| D5 | Timebank leaves these cancels out of every count (own outcome, like `REMOVED_HOURS_REDUCED`), so the next week is not "short" and nothing goes back into the bank. | Else the hours loop back. |
| D6 | **Live safety:** only weeks that start on/after the day the setting is first saved On (or, with the default, the deploy day) are adjusted. | With default Yes, the first live run would otherwise cancel visits for every SU with past over care. |
| D7 | Skipped: SU with no weekly hours, no active plan (suspended/ended), and today's visits. Double-up = each carer's time, special visits per the "Count special visits" setting (same as today). | Same rules as the weekly hours. |

## 4. Build

**API**
1. Setting `adjustOverCareNextWeek` (default true) in SU weekly-hours settings + `adjustOverCareFrom` date (D6).
2. Table `ServiceUserOverCareAdjustment` (one row per SU per over week): over minutes, excluded minutes (bank / approved), cancelled minutes and job ids, not-taken-back minutes, adjust week, run time. Unique (serviceUserId, overWeekStart) so a week is done once. **Migration** (new table only).
3. Service: compute D1 from `computeTimebankWeeks` + ledger + approved requests; cancel via an `applyHoursDecrease`-style path with limit = weekly − over for the next week only, note per D4; write the row.
4. Nightly job step after the ledger settle; manager notification (`approverUserIds`): "Over care taken back: N service users, X visits cancelled" → Timebank.
5. Timebank: new outcome for these cancels (D5); week rows carry the adjustment (cancelled visits, not taken back). Preview for the current week: "if it ends like this, these visits next week would be cancelled".

**Admin**
1. Settings → Dom Rules → Service user weekly hours: "Take over care back the next week" No/Yes (+ tooltip).
2. Timebank list "Over contract" rows and SU timebank week rows: info tag "Over care given — Xh of next week's visits cancelled" (or "will be cancelled") + **See visits** dialog (date, time, carer, minutes, status).
3. Visit plan Activity → Cancelled: shows the note (already does for plan cancels).
4. Manager notification links to the Timebank page.

## 5. Tests
Over exactly at limit (nothing), 5h over → 5h cancelled latest first, bank-paid week (nothing), manager-approved over visit (excluded), next week too small (rest shown as not taken back), run on Monday (Monday visits kept), setting off, week before `adjustOverCareFrom`, rerun (no double cancel), timebank next week not short, carer push sent.

## 6. Results (4 Nov 2026, local)

Built as planned. Files: API `service-user-over-care.service.ts` (+ spec), `service-user-over-care.controller.ts`
(`GET /service-user-hours/timebank/:id/over-care?weekStart=`), migration `20261121090000_su_over_care_adjustments`,
`planVisitCut` / `applyVisitCut` in `visit-plan-date-changes.service.ts` (hours cut now uses them), timebank util/service
(set lowered by `takenBackMinutes`, outcome `REMOVED_OVER_CARE`), settings `adjustOverCareNextWeek` / `adjustOverCareFrom`,
rolling rota step, manager notice. Admin: Dom Rules toggle, `OverCareNotes.tsx` (tag + See visits dialog) on the Timebank
list and SU timebank weeks.

| Check | Result |
|---|---|
| Unit: take back 2h, bank/approved left out, not taken back, setting off, first run, skips | PASS (6) |
| Unit: timebank next week lowered, cancelled visit `REMOVED_OVER_CARE`, not short | PASS (2) |
| Related suites (hours, visit plans, approvals, settings, jobs, specials, housekeeping) | 41 suites / 282 tests PASS |
| Settings save: on keeps date, off clears, on again = today, client date refused (400) | PASS (API) |
| Preview, Raymond (plan), this week 1h over → Fri 13/11 evening 30m listed, 1h taken back | PASS (API + Chrome dialog) |
| Preview, George (no plan) → "no active visit plan" | PASS (Chrome dialog) |
| Nightly job run with the step (no over last week locally) → `overCare: {adjusted: 0}` | PASS |
| Real cancel by the nightly run on a finished over week | PASS — see §7 |

Local leftovers: setting saved On with `adjustOverCareFrom` 2026-11-04; test specials deleted.

## 7. End-to-end test record (4 Nov 2026, local DB `careadmin`)

Setup (local test data only):
- Ray Okonkwo (`0e68aaee-c154-4735-919e-d189e464da76`), weekly 8h, active plan. First week (from 29 Oct) set **274m**.
- His two plan visits on Fri 30 Oct completed through the normal complete flow with longer times (morning 07:30–12:30,
  evening 18:00–19:00, overrun reason "Over care test"), then the office overrun approved (`/overrun/approve`, ACTUAL):
  reconciliations PENDING_REVIEW, billable 300m + 60m → care given **360m**, over **86m**.
- `adjustOverCareFrom` set to 2026-10-26 in the local settings so that week is eligible.

Preview before the run (`GET …/over-care?weekStart=2026-10-26`): WILL_CANCEL — Fri 06/11 Morning (60m) and Evening (30m).

Run: `POST /system-jobs/rolling-rota/run` → job run `b4f977d6-9dc2-4695-b776-8e01b0c219d3`, success,
`overCare: { adjusted: 1, cancelledVisits: 2 }`.

| Check | Result |
|---|---|
| Record `ServiceUserOverCareAdjustment` | 1 row: over week 26/10, adjust week 02/11, weekly 274, care given 360, left out 0, over 86, cancelled 90, taken back 86, not taken back 0, job ids of the 2 visits |
| Visits cancelled | Fri 06/11 Morning + Evening: CANCELLED, by OTHER, reason OTHER, note "Over care adjustment — week of 26/10/2026 had 1h 26m over", NO_CHARGE |
| Plan | SKIP exceptions on 06/11 with the same note (the rota will not remake them) |
| Other visits of the week | Untouched (Mon–Thu; the run day's visits kept) |
| Audit | `scheduled_job_cancelled` × 2 |
| Timebank week 26/10 | over 86, `overCareAdjustment` taken back 86 |
| Timebank week 02/11 | set 480 → **394** (taken back 86), the 2 visits outcome `REMOVED_OVER_CARE`, not counted as cancelled/short |
| Manager notice | "Over care taken back: 1 service user" → `/reports/timebank?week=2026-10-26` |
| Run again (job runs `d53e9a86…` failed, `39f3e846…` success) | `overCare: {adjusted: 0}` both times — no second cancel, still 1 record, still 2 cancelled visits. `d53e9a86` failed on Edie Marsh's **plan generation** (120s transaction timeout) while the machine load average was ~100; the next run passed (83s). Not in the over care step. |
| Admin, SU timebank page | Week 26/10: "Over care given — 1h 26m taken back in the week of 02/11/2026 (2 visits cancelled). See visits"; week 02/11: "Hours lowered by 1h 26m — over care in the week of 26/10/2026. See visits"; dialog lists the 2 cancelled visits |
| Fix found in the test | The dialog listed a carer taken off the visit days earlier (by a contracted hours cut). It now lists only carers on the visit, or taken off by its cancellation. |

Local test data left: Ray's Fri 30/10 visits completed (5h / 1h, overrun approved, not invoiced), his Fri 06/11 visits
cancelled by the run, the adjustment row, `adjustOverCareFrom` = 2026-10-26 in local settings.

## 8. Scenario tests (5 Nov 2026, local) — guide `tester-guides/over-care-late-cancel-timebank-invoice.html`

| # | Run how | Result |
|---|---|---|
| A1/A2/A7 | Margaret (Peggy) week 26/10: 5 visits completed longer (overrun approved) → care 8h vs 6h; nightly run `b0924e22` | PASS — record over 2h, Fri 06/11 Morning + Evening cancelled (OTHER, NO_CHARGE, note "Over care adjustment — week of 26/10/2026 had 2h over"), plan SKIPs, today's 05/11 visits kept, week 02/11 set 10h → 8h, notice "Over care taken back: 1 service user", audit `scheduled_job_cancelled`; admin tags + See visits dialog correct |
| A3 | Arthur week 26/10 completed at planned times (4h 30m = 4h 30m) | PASS — NOTHING, no record |
| A4 | George, Use timebank = Yes, 7h extra visit 06/11 (5h from bank), preview | PASS — 1h over left out (bank), NOTHING |
| A5 | Arthur extra visit 06/11 sent to approval and approved, preview | **FAIL → fixed**: approved visit plan extra visits store `createdExceptionId`, the over-care exclusion read only `createdJobId`, so they counted as over care. Now matched by the rota visit's `metadata.visitPlanExceptionId`. After the fix: Arthur's 3 approved extras left out, NOTHING |
| A6 | Margaret this week: 13h over vs next week 10h (preview) | **FAIL → fixed**: shown 11h taken back / 2h not taken back while only 8h of visits could go. Over care above the whole next week now counts as not taken back: 8h taken back (8 visits), 5h not taken back; dialog "5h not taken back (not enough visits left)" |
| A8 | Setting No, preview + UI | PASS — OFF, tag "not taken back (setting off)", dialog text; On again → start date = today (NOT_ELIGIBLE), test date restored to 26/10 |
| A9 | — | Covered by the 4 Nov browser check (George, then no plan) + unit test |
| A10 | Nightly run again | PASS — adjusted 0, still 1 record, 1 notice |
| A11a | Margaret this week 3h over (preview + UI) | PASS — "visits in the week of 09/11/2026 may be cancelled", 12–13/11 visits listed |
| A11b | — | Not run live (no service user with over contract from a chargeable cancellation only) |

Tests: over-care spec 8 (2 new: approved extra visit left out; over above the whole next week), related suites 83 / 694 PASS, `tsc` clean.
Not changed (open): approved longer plan visit times (`PLAN_TIME`) are not left out; an approved longer extra visit (`EXTRA_EDIT`) leaves out the whole visit.
Test data left: Margaret's 30/10–01/11 and 02–04/11 visits completed longer (pending review), her 06/11 visits cancelled by the run; Arthur's 30/10–01/11 + 03/11 visits completed, a 06/11 approved extra visit; George's 06/11 12:00 7h extra visit (5h from bank); Use timebank = Yes.

Toast taps (part E of the same guide, 5 Nov): toasts shown through the real admin toaster with API message texts — "Sent to Hours approvals — not added yet" and "1 approved, 1 could not be approved — see Hours approvals" → `?tab=pending`; expired / rejected / cancelled / "2 approved" → their tab; a toast without "Hours approvals" is not clickable. `?tab=expired` opens Expired; clicking Pending changes the address to `?tab=pending`. Not run: a user without `hours_approvals.read`. Seen: after a session expiry the login redirect keeps `/hours-approvals` but drops `?tab=` (existing login behaviour).

## 9. Decision 5 Nov (user: "ok fix karo") — approved longer visits

A visit a manager approved longer now leaves out only the approved extra minutes, per visit: a plan visit's new time (`PLAN_TIME`, from `planTimeChange.held[].jobId/minutes`) and a longer extra visit (`EXTRA_EDIT`, its `heldDeltas` on `createdJobId`). Before: `PLAN_TIME` was not left out at all (taken back every week), `EXTRA_EDIT` left out the whole visit. A visit approved whole (held visit, special, extra visit) still leaves out all of it. Tests: over-care spec 10 (2 new, `PLAN_TIME` and `EXTRA_EDIT`: 15m of a 45m visit left out); related suites 83 / 700 PASS; live previews (Margaret, Arthur) unchanged except time passing. Not shown live in isolation: Arthur already has more approved minutes than his over care.
