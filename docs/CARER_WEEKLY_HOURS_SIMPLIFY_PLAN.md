# Carer weekly hours — simplified settings: implementation and test plan

Status: **built 30 Oct 2026 (uncommitted, on top of earlier uncommitted work on `saqi`)**. Migrations applied locally (backup `db-backups/careadmin-before-carer-hours-simplify-20261030.dump`). Automated checks pass; live UI test results are recorded in section 6.

Admin UI: Settings → Dom Rules → "Carer weekly hours limit".

---

## 1. Agreed rules (product owner, 30 Oct 2026)

| # | Rule |
|---|------|
| R1 | One setting for every path that gives a carer visits (visit plan, rota board, team allocate, auto rota run, rolling rota, extra visits, special visits): **"Visits over a carer's weekly hours need manager approval" Yes / No**. The old 3 options (Don't allow / Manager must approve / Warn and confirm) and the fixed "visit plan always needs approval" rule go away. |
| R2 | **No** → visits are assigned, with a warning. **Yes** → visits within the limit are assigned; the visits from the one that crosses the limit to the end of that week go to Hours approvals. |
| R3 | Within-limit order = the week's visits in time order. |
| R4 | Approve → the held visits are assigned. Reject → assigned visits stay, held visits stay unassigned. The reject dialog lists the visits that will stay unassigned. The old "remove the carer from the whole visit plan" option goes away. |
| R5 | Rolling rota follows R1–R4. |
| R6 | Longer visit time that takes a carer over: same setting. With approval, nothing changes (old time stays) until approved. |
| R7 | Draft plans: no carer-hours check at all. Checks happen once the plan is active and visits are made. |
| R8 | Changing the setting does not touch existing assignments. Only new over-limit assignments follow the new value. |
| R9 | Maximum = each carer's own **Employment → Working hours → Maximum weekly hours** (`EmployeeEmployment.maximumWeeklyHours`). The Dom Rules "Most weekly hours a manager can approve" number is removed. |
| R10 | "Allow over a carer's maximum weekly hours": **No** → stopped, shown in a **dialog** (not a toast). **Yes** → follows the approval setting (approval → request; no approval → assigned with a warning). Same rule for extra hours above the maximum (no separate "managers only" rule). |
| R11 | Two separate settings: **"Changing contracted weekly hours needs manager approval"** Yes/No and **"Adding extra hours needs manager approval"** Yes/No. No = applies at once. Yes = nothing changes until approved; pending visit requests stay pending. If a visit request is approved first, fine. If extra hours are approved first, visit requests that now fit are auto-approved. |
| R12 | Contracted hours decrease: visits over the new limit (latest in each week first, rota and plan) are unassigned. A dialog always lists them — on the manager's approve (approval Yes) or as a confirmation (approval No). |
| R13 | Manager's own changes also go to Hours approvals when approval is Yes (direct manager change: later). |
| R14 | Grace minutes stay: contracted + extra + grace = not over. |
| R15 | "Count called-off visits" stays. |
| R16 | Carers with contracted hours **0 or blank** can't be given visits for any service user. Message + one-click link to their working hours. Carers already on visits with 0/blank hours are **unassigned**. |
| R17 | Pending-approval visits are not shown in the carer app (today's behaviour — the carer has no allocation for them). |
| R18 | **Every reject needs a reason** (all request types). |
| R19 | Deferred: visa caps (QA_PENDING.md P-017), UK Working Time Regulations. |

Defaults: visits approval **Yes**, contracted change approval **Yes**, extra hours approval **No**, allow over maximum **No**, grace **0**, count called-off **Yes**. Saved values map: Warn and confirm → No; Don't allow / Manager must approve → Yes.

---

## 2. Open decisions (need answers before build)

| # | Question | Recommendation |
|---|----------|----------------|
| D1 | Carer's maximum weekly hours is **blank** — what happens? | **Decided:** blank maximum = **60h** (fixed default, not a setting). A note next to the Maximum weekly hours field (Employment → Working hours, add employee) must say "Left blank = 60h maximum". |
| D2 | Maximum lower than contracted hours — allowed? | **Decided:** never. Whichever of the two is already set, entering the other is checked against it and an error is shown (Employment save and add-employee). |
| D3 | Existing carers with 0/blank contracted hours who are on visits | **Decided:** give them hours instead of unassigning — **local test DB only** for now. Value chosen by me for local: their busiest upcoming week's assigned hours rounded up to a whole hour (so nobody becomes over), backup first. Live: not touched. |
| D4 | Requests already PENDING at release (old carer types: visit plan, rota, contracted hours change) | **Decided:** remove them. Done as status CANCELLED with note "Replaced by the new carer hours settings" (off the pending list, history kept, carers stay as they are — held visits stay unassigned). |
| D5 | Reason required for every reject, incl. service-user requests | **Decided:** always required; remove the SU "reject reason required" setting (`extraRejectReasonRequired`). |

---

## 3. Verified starting point (code read 30 Oct)

- Rule loader: `CarerWeeklyHoursService.rule()` → `OrganisationGeneralSettingsService.getCarerWeeklyHoursRule()`; options in `organisation-general-settings/dom-care-allocation-rules.util.ts` (`rejectAction`, `maxApprovableHours`, `allowOverMax`, `countCalledOff`, rule `behavior`, `minutes` = grace). Stored as JSON — **no migration needed for settings**.
- Limit: `carer-weekly-hours.service.ts:271` uses `contractedWeeklyHours > 0`, else **null = no check**. `maximumWeeklyHours` is not read by the check.
- Visit plan: `reconcileForPlan` runs in plan `create` (always DRAFT) / `update` / `generateSchedule` (`service-user-visit-plans.service.ts:1588, 1678, 2869`); over-max refusal at `employee-hours-approvals.service.ts:915`.
- `generateSchedule` only runs for ACTIVE plans (`:2817`); rolling rota → `bulkGenerate` → `generateSchedule`.
- Rota board: `allocation-checks.service.ts:297 checkCapacity`; `job-allocations.service.ts:~673`; `allocation-rule-hits.util.ts:~145`.
- Extra visits: `visit-plan-date-changes.service.ts:~1726`. Special visits: `special-visits.service.ts:~100`.
- Reject: `employee-hours-approvals.service.ts:2165` dispatch; visit-plan reject both options at `:2206`. `DecideHoursApprovalDto.notes` is optional.
- Contracted hours: direct edit blocked once set (`employee-employment.service.ts:91`); change goes through `CONTRACTED_HOURS_CHANGE` request (`requestContractedHoursChange`, preview via `CarerHoursReductionService.preview`).
- Extra hours: `carer-extra-hours.service.ts grant` applies at once; max check `:290–320` uses `maxApprovableHours` + manager-only rule.
- `maxApprovableHours` is read in 10 API files (carer-weekly-hours, employee-hours-approvals, carer-extra-hours, allocation-checks, job-allocations, schedule-runs, visit-plan-date-changes, special-visits, settings util + DTO).

---

## 4. Implementation steps

### Step 0 — Safety
- Ask before any branch / git step (project rule). No commit until asked.
- `pg_dump -Fc` backup of local `careadmin` before the migration (step 5) and before the R16 script.
- Read-only counts (local): carers with 0/blank contracted hours who have upcoming allocations or plan slot assignments; carers with blank maximum; carers whose maximum < contracted. Live counts only with the product owner's go.

### Step 1 — Settings model (API + admin)
- `dom-care-allocation-rules.util.ts` + DTO: new options `visitsNeedApproval` (bool), `contractedChangeNeedsApproval` (bool), `extraHoursNeedApproval` (bool); `allowOverMax` becomes `NO | YES`; keep grace (`minutes`) and `countCalledOff`. Normalise old saved JSON (behaviour → bool per the mapping; old `MANAGER_APPROVAL` allowOverMax → `YES`). Stop reading `rejectAction`, `maxApprovableHours`, `behavior` (left in JSON, ignored — backward compatible).
- `GeneralSettingsDomRulesPanel.tsx`: rebuild the card as the approved design (hints inside info tooltips, no maximum number).

### Step 2 — One shared check (`CarerWeeklyHoursService`)
- `limitMinutes` = contracted (+ extra) ; `maxMinutes` = carer's `maximumWeeklyHours` (D1/D2 rules).
- `checkNewVisits` returns per visit: `within` / `over` / `overMax` / `noContractedHours`.
- One helper decides the outcome from the setting: `ASSIGN` / `ASSIGN_WITH_WARNING` / `REQUEST` / `STOP_MAX` / `STOP_NO_HOURS`. Every path below calls this helper instead of its own `behavior` branches.

### Step 3 — Paths that give visits
1. Visit plan save (`reconcileForPlan`): skip DRAFT (R7). Approval No → no hold, response carries a warning list. Approval Yes → today's hold logic. Max stop → 400 with a code the admin shows in a dialog.
2. `generateSchedule` / rolling rota / bulk: same helper; no request when approval is No.
3. Longer visit time (`timeChanges` / pending times): only held when approval is Yes.
4. Rota board allocate, team allocate, auto rota run (`schedule-runs`): `CAPACITY_NEEDS_APPROVAL` only when Yes; warning when No; max stop = hard block; no-hours = hard block with link data.
5. Extra visits, special visits: same.
6. Remove the `REMOVE_FROM_PLAN` branch; reject always keeps assigned visits (R4).
7. New `GET /hours-approvals/:id/reject-preview` → visits that will stay unassigned.

### Step 4 — Reject reason everywhere (R18)
- Service: every reject path refuses an empty reason (400). Admin reject dialog: reason textarea required for every row type.

### Step 5 — Extra hours approval (R11)
- Migration (hand-written SQL, `migrate deploy`, backup first): enum value `EmployeeHoursApprovalType.EXTRA_WEEKLY_HOURS`.
- `grant`: approval Yes → create a PENDING request (payload = the grant input); nothing applied. Approve → create the `EmployeeExtraWeeklyHours` row (same code as today) + auto-approve fitting carer requests. Reject → reason, nothing applied.
- Max rule: replace manager-only check with R10 (carer maximum + allowOverMax).
- Admin: `CarerExtraHours.tsx` shows "Sent for approval"; Hours approvals gets the new row type.

### Step 6 — Contracted hours (R11, R12)
- Approval No: `employee-employment.service.ts` allows the direct change; before saving, admin shows the reduction impact dialog (existing `previewContractedHoursChange` / `ContractedHoursImpactSummary`) and the change applies the same unassign as an approved request.
- Approval Yes: today's request flow; approve dialog lists the visits that will be unassigned.
- Verify `CarerHoursReductionService` picks the **latest visits of each week** for rota and plan; adjust if not.

### Step 7 — Carers with no contracted hours (R16)
- All paths: `STOP_NO_HOURS` → error/dialog "Set this carer's contracted weekly hours first" + link to Employment → Working hours.
- Carer pickers (suggest-carers, allocate dialog, plan carer select): show these carers disabled with the same link.
- One-off script (D3) to unassign existing ones, after the count is approved.

### Step 8 — Admin dialogs instead of toasts
- Max stop and no-hours stop open a dialog (shared component) on plan save, allocate, extra, special, extra hours.

### Step 9 — Clean-up and docs
- Remove dead `behavior` / `rejectAction` / `maxApprovableHours` reads; update Hours approvals intro text; update `carer-weekly-hours-…` test PDF (Roman Urdu format) and memory.

---

## 5. Testing

### 5.1 Automated
- Update specs: `carer-weekly-hours`, `employee-hours-approvals.reconcile`, `allocation-checks.service`, `special-visits.service`, `visit-plan-date-changes.carer-over-max`, `carer-extra-hours.over-max`, `schedule-lifecycle-impact.service.reschedule`.
- New specs: settings normalisation (old JSON → new), outcome helper (every combination of approval × max × allowOverMax × no-hours), reject preview, reason required, extra-hours request approve/reject, contracted change without approval.
- `npx tsc --noEmit` (API + admin), touched jest suites, admin `allocate-job-warnings.util.test.ts`, `npx prisma validate`, `migrate deploy` on local after backup.

### 5.2 Manual end-to-end (admin, local, fresh test data)
Fresh data: 1 service user, carers A (contracted 20h, max 25h), B (contracted 20h, max blank), C (contracted blank).

| # | Setting | Action | Expected |
|---|---------|--------|----------|
| T1 | Card | Open Dom Rules | New card, defaults, tooltips, no maximum number; old saved values mapped |
| T2 | Approval Yes | Draft plan puts A at 25h | Saves, no request (R7) |
| T3 | Approval Yes | Activate + generate | Visits up to 20h assigned; rest in one request; not in carer app |
| T4 | Approval Yes | Approve T3 | All visits assigned |
| T5 | Approval Yes | Reject T3 without reason | Refused |
| T6 | Approval Yes | Reject T3 with reason | Dialog lists unassigned visits; assigned ones stay |
| T7 | Approval No | Same plan for A | All assigned + warning, no request |
| T8 | Approval Yes/No | Rota board allocate over limit | Request / warning |
| T9 | Approval Yes/No | Extra visit, special visit over limit | Request / warning |
| T10 | Approval Yes | Lengthen a visit so A goes over | Old time kept until approved, then new time |
| T11 | Approval Yes | Rolling rota "Run now" on a new over week | Request only for the over visits |
| T12 | Allow over max No | A would reach 26h | Dialog, nothing saved (plan, rota, extra, special) |
| T13 | Allow over max Yes + approval Yes / No | A to 26h | Request / warning |
| T14 | D1 | B to 70h | Per D1 answer |
| T15 | Any | Give C a visit (plan, rota, extra, special, picker) | Blocked + link to working hours |
| T16 | Grace 20 | A at 20h 20m / 20h 21m | Not over / over |
| T17 | Called-off off/on | Called-off visit in A's week | Not counted / counted |
| T18 | Contracted approval Yes | Lower A 20→15 | Request; approve dialog lists latest visits to unassign |
| T19 | Contracted approval No | Lower A 20→15 | Confirmation dialog lists visits, applies at once |
| T20 | Contracted approval any | Raise A 20→25 | Applies (or request), pending visit requests that now fit auto-approve |
| T21 | Extra hours approval No | Add 5h to A | Applies at once; fitting requests auto-approved |
| T22 | Extra hours approval Yes | Add 5h, approve visit request first | Visit assigned; extra still pending |
| T23 | Extra hours approval Yes | Add 5h, approve extra first | Fitting visit requests auto-approved |
| T24 | Extra hours approval Yes | Reject extra hours | Reason required; nothing applied |
| T25 | Switch setting | Yes→No and No→Yes with existing assignments | Existing unchanged; only new ones follow |
| T26 | Old pending requests | Decide a pre-release request | Works with new reject rule |

### 5.3 Device (product owner runs the app)
- Carer app: held visits not shown; after approve they appear (pull to refresh).

### 5.4 Regression
- Service user weekly hours settings and requests unchanged (except D5).
- Billing / invoicing unaffected (carer rule never cancels a visit; invoicing uses completed visits).
- Hours history screen shows the new request type.

---

## 6. Test results (30 Oct 2026, local)

### Automated
- API `tsc` clean; admin `tsc` clean; `prisma validate` OK; migrations `20261106090000` + `20261106090100` applied locally.
- Jest (job-allocations, service-user-visit-plans, employee-employment, employee-hours-approvals, special-visits, organisation-general-settings, schedule-runs, common/filters): **36 suites, 274 tests pass**. Rewritten for the new rules: allocation-checks, special-visits, date-changes carer-over-max, carer-extra-hours over-max, reconcile (+ draft skip, no-approval warning, no-hours refuse/withhold). New: settings normalisation spec.

### Live (API + admin on localhost, carer Chloe: contracted 16h, max temporarily 24h)
| Test | Result |
|---|---|
| T1 settings card (defaults, tooltips, no max number); SU "reason required" toggle gone; save via UI → JSON saved | PASS |
| T8 rota allocate over hours, approval Yes → request; approval No → assigned (pending confirmation) with CAPACITY_EXCEEDED warning, no request | PASS |
| T12 above carer max, allow No → hard block with carer's own max in the message | PASS |
| T13 above max, allow Yes: approval No → warning only; approval Yes → request | PASS |
| Approve above max: allow No → refused (code CARER_OVER_MAX_WEEKLY_HOURS); allow Yes → approved | PASS |
| Hours approvals page: Approve disabled with "exceeds the 24h weekly maximum" (per-carer) | PASS |
| T5/T6 reject: no reason → refused (API + UI button disabled); reject-preview lists the visit; reject with reason saved | PASS |
| Visit-plan request reject-preview (96 visits listed) | PASS (not rejected) |
| T21–T24 extra hours approval Yes: preview needsApproval, grant → request only, approve → extra hours created, reject needs reason → nothing added | PASS |
| T19/T20 contracted change, approval No → applied at once (history kept); above max → refused | PASS |
| D2 max below contracted → refused | PASS |
| Stop dialog (extra hours above max) opens instead of a toast, link to Employment | PASS |
| "Left blank = 60h maximum" note under Maximum | PASS |

### Live round 2 (30 Oct, fresh test data: carer HoursTest 4h/max 6h, carer NoHoursTest without hours, service user HoursTestSU)
| Test | Result |
|---|---|
| T2 draft plan over the carer's hours → saved, no request | PASS |
| T3 activate (approval Yes) → one request holding the 11 Friday visits; generate → Mon–Thu assigned, Fridays empty | PASS |
| Reject preview of that plan request lists the 11 held visits | PASS |
| T4 approve → Fridays assigned | PASS |
| T7 plan save, approval No → saved, warning in message + `meta.carerHoursWarnings`, no request; generate → new visits assigned | PASS |
| T12 plan save above the carer's max, allow No → refused, code CARER_OVER_MAX_WEEKLY_HOURS | PASS |
| Above max, allow Yes + approval No → saved with warning | PASS |
| T10 longer visit (approval Yes) → plan keeps 09:00–10:00, request has the new time; approve → 09:00–10:30 | PASS |
| T11 rolling rota Run now → rota extended, carers assigned, no extra request where an approval already covers the week | PASS |
| No-hours carer: plan save refused (code CARER_NO_CONTRACTED_HOURS); picker flags them; UI picker note with "Set weekly hours" link | PASS |
| Contracted change approval No in the UI → "Confirm contracted hours change" dialog → applied (4h → 5h), banner | PASS |

Fixed during round 2: plan-save warnings were dropped by the response interceptor (only data / meta / message reach the client) — now sent as `meta.carerHoursWarnings` and read by the admin.

Fixed after round 2 (existed before this work): `heldTimeChanges` / `scheduleImpact` on plan update, activate, suspend and end were dropped by the interceptor — now also sent in `meta` and read from there by the admin; live-checked (update meta had heldTimeChanges + scheduleImpact, end meta had scheduleImpact with 10 cancelled). Same pattern still exists, not touched: service user absences and employee non-core activities (`scheduleImpact`), employees.api `removedVisitPay`. Admin "Add extra hours" is hidden for a carer without contracted hours, so the no-hours stop dialog is reached only through the API code (the dialog itself was checked with the over-maximum code).

Side effect left in local data: the manual rolling-rota run extended every plan's rota and opened a legitimate request for Chloe on Edith's plan (Chloe is over her 16h contract in the demo data; 72 future plan visits from 29/11 held). The nightly run would do the same. Test service user ended + soft-deleted (28 future visits cancelled), test carers soft-deleted, settings back to defaults. Backup before round 2: `db-backups/careadmin-before-carer-hours-live-tests-20261030.dump`.

### Still not tested
- Carer app (held visits hidden) — device test by the product owner.

### Incident during testing (fixed)
- Lowering Chloe 17h → 16h (no-approval test) correctly unassigned her visits above 16h (32 rota visits + plan weekdays) and the follow-up plan check opened a request. All restored from the session backup (allocations, job statuses, plan slot assignments — checksums match the backup); the extra request was cancelled. Settings, Chloe's max (25h) and test allocations/extra hours were put back.
