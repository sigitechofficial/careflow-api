# Service user weekly hours — simplified settings: implementation and test plan

Status: **build started 30 Oct 2026** (uncommitted on `saqi`). Backup `care_app/db-backups/careadmin-before-su-hours-simplify-20261030.dump`.

Admin UI: Settings → Dom Rules → "Service user weekly hours". Same model as the carer redesign (`CARER_WEEKLY_HOURS_SIMPLIFY_PLAN.md`).

---

## 1. Agreed rules (product owner, 30 Oct 2026)

| # | Rule |
|---|------|
| S1 | **"Changing a service user's weekly hours needs manager approval" Yes / No.** Replaces Always / Only up / Only down / Never. No → the change applies at once. Yes → up and down both wait for a manager. |
| S2 | First time hours are set (no previous value) → applies at once, no approval (today's behaviour). |
| S3 | While a change is pending, the **old** hours decide every check. |
| S4 | **Hours go up** (applied directly or approved): pending over-hours visit requests of that service user whose week now fits are **auto-approved**, oldest request first; the rest stay pending. The manager sees which were approved. |
| S5 | A pending request whose date has passed or that is no longer valid shows as **Expired**. The same request record moves (no new row). Hours approvals gets a 5th tab: **Pending, Approved, Rejected, Cancelled, Expired**; expired requests move there automatically, with no Approve/Reject buttons and the reason (date passed / no longer valid). **Expiry time = the visit's start time** (org timezone). Weekly hours change requests never expire by date. Checked when Hours approvals opens, in the nightly rolling rota run, and on Approve (refused: "This request has expired"). |
| S6 | **Hours go down**: visits within the new hours stay, the ones over are **cancelled**, latest in each week first. The "Keep the visits and show a warning" option goes away. |
| S7 | Before a decrease is applied a **dialog always lists the visits that will be cancelled**, highlighted — on the manager's approve (S1 Yes) or as a confirmation (S1 No). Special visits in the list are marked as special. |
| S8 | Time-critical visits follow the same cancel rule as other visits (today they are never cancelled). |
| S9 | **Today's visits are never cancelled.** Cancelling starts tomorrow. |
| S10 | Special visits count and are cancelled too when they fall last in a week that is over. |
| S11 | **Weekly count = visits that actually exist on the rota** (created / scheduled), up to the rota horizon (`domRotaHorizonDays`, default 28, or the calendar-month edge). Not the 12-week plan projection. The "How many weeks ahead to check" setting goes away. |
| S12 | Every new rota day (nightly rolling rota, Regenerate rota, bulk generate, plan activation) is checked with the same rule. |
| S13 | A new visit that takes a week over the hours: **approval Yes** → the visits within the hours are created, the over ones are **not created** and go to Hours approvals. Approve → visit created. Reject → not created. Same as carer R2/R4. |
| S14 | Draft plans: **no check**. The check runs on activation, when visits are made. The draft-plan setting and `DRAFT_PLAN_OVER_HOURS` flow go away. |
| S15 | Switching a setting from Yes to No does not touch pending requests — they still need a manager. (Same for carer.) |
| S16 | **Every reject needs a reason.** Already enforced (`employee-hours-approvals.service.ts:2385`); the dead `extraRejectReasonRequired` key is removed. |
| S17 | Notifications for cancelled visits: skipped for now. |
| S18 | Old saved setting values are mapped or removed (local DB holds only defaults). |
| S19 | A request also expires when it is **no longer valid**: plan ended or deleted, service user inactive / discharged, the visit's slot removed, the date cancelled, or the visit already on the rota. |
| S20 | **Carer requests expire the same way** (visit start time passed / no longer valid) and show in the same Expired tab. |

---

## 2. Decisions (product owner accepted the recommendations, 30 Oct 2026)

| # | Question | Decision |
|---|----------|----------------|
| D1 | S13 uses "approval Yes". Which setting is that — the hours-change one (S1), or a **separate** "Visits over a service user's weekly hours need manager approval" Yes/No (like carer R1)? | **Decided:** separate setting, like carer. Hours change and visits over the hours are two different decisions. |
| D2 | Visits approval **No** → visit created with a warning? | **Decided:** yes, created with a warning (carer R2). |
| D3 | Editing a visit longer (extra visit, plan visit, rota time) that takes the week over. Today an extra-visit edit is simply blocked. | **Decided:** same setting. Yes → old time stays until approved (carer R6); No → saved with warning. |
| D4 | "Expired" (S5): there is no EXPIRED status today (`EmployeeHoursApprovalStatus` = PENDING / APPROVED / REJECTED / CANCELLED). | **Decided:** add `EXPIRED` status (migration), shown separately from a manager's cancel. |
| D5 | Pending `DRAFT_PLAN_OVER_HOURS` requests at release (S14 removes the flow). | **Decided:** mark CANCELLED with note "Replaced by the new service user hours settings" (same as carer D4); the draft can then be activated and S12/S13 apply. |
| D6 | Hours cut where the week is still over after every visit from tomorrow is cancelled (e.g. most hours are in the past days of this week). | **Decided:** cancel what can be cancelled, show "still over" in the dialog, nothing else. |
| D7 | Defaults. | **Decided:** hours change approval **Yes**, visits approval **Yes**, count special visits **Yes**. Saved map: ALWAYS / INCREASE_ONLY / DECREASE_ONLY → Yes, NEVER → No; KEEP_WARN / CANCEL_LATEST → removed (always cancel). |

---

## 3. Verified starting point (code read 30 Oct)

- Settings: `organisation-general-settings/service-user-weekly-hours-settings.util.ts` — 12 keys in JSON column `OrganisationGeneralSettings.serviceUserWeeklyHoursSettings` (**no migration needed for settings**). Local DB holds only defaults.
- Count: `visit-plan-weekly-hours.util.ts computeVisitPlanWeeklyHours` builds `checkWeeks` (12) Monday weeks from the **plan pattern**; rota data used only for `cancelledOnRota` and `specialVisitMinutesByDay`. Heaviest week vs limit.
- `VisitPlanWeeklyHoursService` (`visit-plan-weekly-hours.service.ts`): `count`, `assertWithinLimit` (179), `draftOverWeeks` (229), `classifyExtraDates` (268), `checkExtraEdit` (371), `overLimitWeeksForRange` (445), `describeOverLimit` (522), `checkSpecialVisit` (544).
- Callers: plan `create` (`service-user-visit-plans.service.ts:1591`), update (~1645–1672), `syncDraftOverHoursRequest` (2264), `generateSchedule` (2833, `skipWeeklyHoursCheck`), `weeklyHoursRunWarning` (3388); `bulkGenerate` (`visit-plan-bulk-schedule.service.ts:268`, `bulkOverLimit`); extra visits (`visit-plan-date-changes.service.ts` ~1031, ~1212); special visits (`special-visits.service.ts:97`).
- Hours change: `requestServiceUserHoursChange` → `suHoursChangeNeedsApproval` (`employee-hours-approvals.service.ts:568`); applied directly (579) or on approve (658) → `afterServiceUserHoursChanged` (675) → `applyHoursDecrease` only when `CANCEL_LATEST`.
- Decrease: `planHoursDecrease` (`visit-plan-date-changes.service.ts:1633`) — ACTIVE plan only, within `checkWeeks`, skips time-critical, latest-first; candidates from `listCancellable` (299): plan + extra visits, **not special visits**; today's not-yet-started visits **are** included.
- Pending SU extra-visit requests are **not** auto-approved when hours rise (only `currentWeek` shown, ~1368). Carer has auto-approve (`POST /hours-approvals/check-within-limit`).
- Reject reason already required for every type (2385).
- Rota horizon: `domRotaHorizonDays` (default 28, 1–90) + `domRotaHorizonMode` (FIXED_DAYS / CALENDAR_MONTH), `visit-plan-rolling-rota*.ts`.
- Admin: `GeneralSettingsServiceUserHoursPanel.tsx`, `service-user-weekly-hours-defaults.ts`, `ServiceUserHoursApproval.tsx`, `ServiceUserHoursDecreaseImpact.tsx`, `HoursApprovalsPage.tsx`, `VisitPlanAddExtraVisitsDialog.tsx`, plan weekly hours panel / live line.

---

## 4. Implementation steps

### Step 0 — Safety
`pg_dump -Fc` backup of local `careadmin` before any migration. Hand-written SQL migrations, `npx prisma migrate deploy` only. Fresh test service users (no stale data).

### Step 1 — Settings model (API + admin)
New keys: `changeNeedsApproval` (bool), `visitsNeedApproval` (bool, D1), `specialVisitsCount` (kept). Remove: `changeApproval`, `decreaseAction`, `planOverLimit`, `draftOverLimit`, `extraOverLimit`, `extraEditOverLimit`, `extraApproveRecheck`, `extraRejectReasonRequired`, `bulkOverLimit`, `specialVisitOverLimit`, `checkWeeks`. Parser maps old saved values (D7). Admin card rebuilt: descriptions in the (i) tooltip, like the carer card.

### Step 2 — Rota-based weekly count (S11)
New count from `ScheduledJob` / `ScheduledVisit` of the service user, today → rota edge, Monday weeks; double-up counts every carer (fixed rule); sleeping nights full hours (fixed rule); cancelled not counted, called-off counted (today's rules); special visits per setting. Last, partly generated week flagged "partial". Replace `computeVisitPlanWeeklyHours` use in checks; plan page panel shows the rota count.

### Step 3 — One check for new visits (S12, S13)
Shared "classify" for a set of new visits: week in time order, from the crossing visit on → held. Used by `generateSchedule` (activation, Regenerate rota, bulk, rolling rota), extra visits, special visits, plan update. Held visits: not created, stored on a request (new type `SU_ROTA_VISIT_OVER_HOURS` — migration — with payload `slotId|date` or the special-visit data), and generation must skip held dates (same idea as carer `withheld`). Approve → create the visit; reject → stays not created.

### Step 4 — Plan save and draft (S14)
Remove `assertWithinLimit` blocks and draft request flow. Plan update on an ACTIVE plan: save, regenerate, then Step 3 holds the over visits. Plan save preview projects the regenerated rota so the dialog shows what will be held.

### Step 5 — Hours change (S1–S4)
`suHoursChangeNeedsApproval` → bool. After an increase (direct or approve): run auto-approve over pending SU over-hours requests, oldest first, re-checking with Step 2; return the list for the UI. Blocked by another check (clash) → stays pending with reason. Past / invalid → Expired (D4).

### Step 6 — Hours decrease (S6–S10)
`planHoursDecrease` → rota-based, whole rota horizon, from **tomorrow**, includes time-critical and special visits, latest-first. Preview endpoint feeds the dialog for both approve and direct change. Special visits cancelled through the special-visit cancel path.

### Step 7 — Admin dialogs
Decrease dialog (list + highlight + "special" badge) on approve and on direct save. Increase result: "N pending visits approved automatically". Hours approvals: new request type rows; new **Expired** tab after Cancelled (status badge, reason, no actions); visit plan "Changes for specific dates" shows an Expired badge.

### Step 8 — Clean-up and docs
Remove dead code for removed settings, update QA test-case PDF later on request, update this file with results.

---

## 5. Testing

### 5.1 Automated
Unit: rota-based count (cancelled / called-off / double-up / sleep-in / special / partial week), classify (crossing visit), decrease pick (tomorrow, time-critical, special), auto-approve order. `npx tsc --noEmit`, related jest suites, admin `tsc` + lint on touched files.

### 5.2 Manual end-to-end (admin, local, fresh test service user, small limit e.g. 5h)
| # | Case | Expected |
|---|------|----------|
| T1 | Hours change, approval No, increase | Applies at once |
| T2 | Approval Yes, increase / decrease | Waits on Hours approvals; old hours used meanwhile |
| T3 | First value set | Applies at once |
| T4 | Increase with 3 pending visit requests, room for 2 | Oldest 2 approved and created, 1 pending, list shown |
| T5 | Pending request with a past date | Shows Expired |
| T6 | Decrease, approval No | Dialog lists highlighted visits; confirm → cancelled, latest first; today untouched |
| T7 | Decrease with a time-critical and a special visit last in the week | Both cancelled, special marked |
| T8 | Decrease, approval Yes | Dialog on approve; reject (reason required) → nothing changes |
| T9 | Activate draft over the hours, visits approval Yes | Within visits created, over ones held → request |
| T10 | Same, approval No | All created, warning |
| T11 | Rolling rota Run now adds a day that goes over | Held + request (Yes) / created + warning (No) |
| T12 | Extra visit / special visit over | Same as T9/T10 |
| T13 | Approve / reject a held visit | Created / not created; reject needs reason |
| T14 | Switch Yes → No with pending requests | Requests still pending |
| T15 | Monthly visit beyond the rota horizon | Not counted until its day is generated, then checked |
| T16 | Calendar-month horizon mode | Count runs to the month edge |

### 5.3 Regression
Carer weekly hours checks unchanged; visit plan create/edit/activate without hours set; billing / invoices of cancelled visits (NO_CHARGE); Activity tabs (Cancelled / Rejected); hours history screen.

---

## 6. Risks
- Held visits are **not on the rota** until approved — nobody visits on that date if no manager acts. Hours approvals must show near dates clearly.
- Cancelling time-critical visits (S8) is a change from today's rule.
- Organisations that chose "Keep the visits" will now get visits cancelled on a decrease (dialog first).
- Count switch from plan to rota changes numbers shown on the plan page (partial last week).
- Live data not checked; settings values and pending requests on live must be counted before release.

---

## 7. Build and test results (30 Oct 2026, local, uncommitted on `saqi`)

Migration `20261107090000_su_visit_over_hours_expired` applied locally (backup `care_app/db-backups/careadmin-before-su-hours-simplify-20261030.dump`): enum `SERVICE_USER_VISIT_OVER_HOURS`, status `EXPIRED`, pending `DRAFT_PLAN_OVER_HOURS` → CANCELLED (none were pending locally).

### Built
- Settings: 3 keys (`changeNeedsApproval`, `visitsNeedApproval`, `specialVisitsCount`); old saved values mapped by the parser. Admin card rebuilt with Yes/No toggles and (i) tooltips.
- Count from the rota (`VisitPlanWeeklyHoursService.weeks`): this week's Monday → rota edge (`domRotaHorizonDays` / mode). Whole week counted, **past days of this week included** (they are real visits now). Plan page/preview of a draft or unsaved edit uses the plan's rows from today on. A job counts duration × required carers.
- Holding: `generateSchedule` (manual, bulk, rolling, approve) holds a new visit that takes its week over → one `SERVICE_USER_VISIT_OVER_HOURS` request per visit; held / rejected visits are never made by generation; approve makes it (`allowHeldKeys`). Special visits held the same way (made on approve). Extra visits keep `EXTRA_VISIT_OVER_HOURS` with the new count/rule. Approval No → made with a warning.
- Plan save and draft: no hours block; draft request flow removed from the plan service.
- Hours change Yes/No; increase → pending visit requests that fit are auto-approved oldest first (returned as `autoApproved`); decrease → always cancels (plan, extra and special visits, time-critical included, from tomorrow, latest first). Impact endpoint returns `kind` + `timeCritical`; admin dialog highlights them.
- Expiry (`expireStaleRequests`): visit start passed, SU inactive, plan ended/deleted, slot removed, date cancelled, visit already on the rota (SU); carer: start passed / all held dates past / plan ended / job removed. Runs on Hours approvals open, nightly rolling rota, and on approve. Hours approvals has the Expired tab (reason under the badge).

### Tests
- Automated: new `visit-plan-weekly-hours.service.spec.ts` (6) + related suites — 14 suites / 89 tests pass. `tsc -p tsconfig.build.json` 0 errors; admin `tsc` 0 errors.
- Live (API on Raymond Okonkwo, 8h; UI checked for settings card + Expired tab), all PASS: special visit over → held, no job; hours 8→9 approved → held visit auto-approved and made; approval No → special made with warning; hours 9→8 → impact lists the Sunday special (kind SPECIAL), approve → it is cancelled; regenerate a day → first visit made, the one over held; approve → made; hold again + reject (reason required) → not made on regenerate (counted as skipped, no new request); held visit with past start → approve refused, status EXPIRED "Visit time has passed"; extra-visit preview → 2nd date needs approval. Raymond's rota restored afterwards (weeks 7.5h as before).

### D3 built later on 30 Oct (longer visits)
- Extra visit edit over the hours, approval Yes → request (kind `EXTRA_EDIT`), the visit keeps its time; approve applies the edit; No → saved with a warning.
- Plan amendment making visits longer (active plan, "apply to rota"): rota visits taken in time order; those whose week would go over keep their old time (`keepOldTime` passed to `applyAmendmentImpact`), **one request per amendment** (kind `PLAN_TIME`, list of held visits); approve moves them to the plan's time (only if the plan still has it); reject keeps the old time. New days later are made at the new time (whole visit held if over, decision B). Rota board edits: not checked (decision C).
- Auto-approve on an hours increase uses the minutes each held visit adds (`heldDeltas`).
- Count fix: a job counts its window (end − start) first — `rescheduleSlotJobs` moves the window but leaves `estimatedDurationMinutes` stale (pre-existing; **not fixed**, other readers of that field may be affected).
- Live (Raymond): Evening 30→45 min → Mon–Tue moved, Wed–Fri × 4 weeks (12) kept old time in one request; approve → 12 moved, weeks 8h 45m; plan restored. Extra visit 30→60 min → held, rota kept 14:00–14:30; approve → 14:00–15:00; extra deleted. Tests: 18 suites / 123 pass; both type-checks 0.
- Not covered: more carers on a plan visit (requiredCarers up) is not held; held edits not live-tested in the UI.

### Not done / not tested
- Carer expiry: only time / plan ended / job removed (S20 partly).
- Not live-tested: decrease dialog and extra-visit dialog in the UI, visit plan panel wording in the UI, bulk generate and rolling rota runs, special-visit toast, manager notifications.
- Old draft-plan approval code paths in `employee-hours-approvals.service.ts` are left for existing records (no longer created).
- Test records left locally on Raymond: one EXPIRED and one CANCELLED request, two cancelled/removed HoursTest special visits.

### UI check (30 Oct, admin in the browser, Raymond — nothing saved)
- Visit plan panel: "Within contract — 30m remaining", "Counted from the visits on the rota, this week to 27/11/2026 (the rota horizon)…" — PASS.
- DOM Care hours 8 → 7, Save changes → review dialog "Manager approval needed", 4 weeks over, 4 Evening visits listed to cancel (latest each week); cancelled, DB still 8h, no request — PASS.
- Add extra visits 17/11 Afternoon 14:00 60 min → "Needs manager approval — that week would have 8h 30m of 8h", button "Send 1 for approval"; closed without saving — PASS.
- Hours approvals: Expired tab (reason under badge); Approved tab labels "Longer extra visit…" / "Longer visit plan visits…" with old → new time and visit count — PASS (fixed: the "keeps the current time" note now shows on pending rows only).
- Rolling rota Run now (same code as bulk generate): 5 plans succeeded, 0 created, 361 skipped, no warnings — PASS (all service users within their hours).
- Not checked in the UI: the extra-visit **edit** dialog with a longer time (no extra visit on file; API tested), the bulk generate page itself (uses `window.confirm`), special-visit toast, manager notifications.

### Remaining UI checks (30 Oct, later)
- Extra visit **edit** 30 → 60 min (week 8h → 8h 30m): dialog "Needs manager approval … The visit keeps its current time until a manager approves", Save → toast "Extra visit not changed yet"; list still 14:00–14:30 — PASS. Fixed: the note above the list now has edit-mode wording.
- Special visit page, over the hours → toast "Sent to Hours approvals — not added yet" — PASS.
- Manager notifications — found and fixed: every held visit was titled "Extra visit over weekly hours"; held special visits sent none; plan-time hours were rounded (8h 18m for 8h 15m); the longer-extra message had an ISO date. Now: "Special visit / Visit plan visit / Longer extra visit / Longer visit plan visit over weekly hours — {name}", org date format, exact minutes. Checked: special visit notification "20/11/2026 15:00–16:00 takes the week to 9h of 8h".
- Bulk generate page (Raymond, 20/11): result "1 visit over the weekly contracted hours (8h) sent to Hours approvals — made only once a manager approves" — PASS. Fixed: the banner line still described the old skip setting.
- Clean-up: Raymond's test requests CANCELLED ("Test clean-up 30 Oct (HoursTest)"), test special/extra visits removed, Friday evening restored; weeks 7.5h; settings defaults. Tests: 18 suites / 123 pass; type-checks 0.
