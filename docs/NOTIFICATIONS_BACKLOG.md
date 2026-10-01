# Notifications — pending work

Backlog from the notification clean-up (28 Sep 2026). Everything below was **found but deliberately
deferred**. Items are ordered by priority inside each section.

Conventions already agreed (keep them for new work):

- Dates in notification text follow the org **date display format** (Settings → General) in the org
  timezone — use `common/utils/notification-display.util.ts`. Times are `HH:mm` in the org timezone.
- `jobName` already contains the service user's preferred name (`Morning — Harry`), so show the
  **full name in brackets**: `Morning — Harry (Harry Max)`.
- Never show raw ids (UUIDs), enum values (`POTENTIAL_MISSED`) or ISO/UTC timestamps to users.
- Text builders live in pure `*.util.ts` files with a spec next to them.

---

## 0. URGENT — fallout from the 3x cron bug (fixed 29 Sep 2026)

**Bug (fixed):** `ScheduleModule.forRoot()` was imported in 3 feature modules (visit-plan-jobs,
learning, service-user-care-plans), so **every `@Cron` handler fired 3 times per tick** in a single
process (measured: */5 jobs 3x per tick, */2 job 9x over 3 ticks). Now registered once in
`AppModule`; re-measured at 1x per tick. This was the root cause of the triplicate late-visit and
ECM alerts.

**Still to do:**
- **Payout batches duplicated.** `EmployeePayoutAutoJob` (4th of month) ran 3x: local DB has **3 PAID
  `EmployeePayoutBatch` rows for period 2026-08**, created 2026-09-04 06:00:00.255–.256 (£35 each).
  Check the **live** database for the same, and decide how to reverse the extra batches (finance
  decision — do not delete blindly).
- `executeAutomaticMonthlyPayout` guards with `findFirst` then create — same check-then-create race.
  Add a lock / unique constraint on `(periodKey, auto)` so a double run can never pay twice again.
- Review other daily/hourly jobs for duplicated side effects in the period the bug was live:
  learning daily maintenance, care plan review reminders, rolling rota extension, visit start
  reminders (carer pushes).
- Deploy this fix to live **before the next 4th of the month**.

---

## 1. Performance

### 1.1 Carer app: medication alert blocks the MAR request — *skipped for now*
- **Where:** `src/employee-app/employee-app-visits.service.ts` (MAR record, after
  `medicationAdministrationEvent.create`) → `MedicationNotificationHook.notifyAdministrationEvent`.
- **Problem:** the alert is `await`ed inside the carer's request and runs ~6–8 DB queries
  (service user, managers, user locations, key worker / named nurse → user, org settings).
  Recording a missed/refused/controlled dose is slower for the carer.
- **Fix:** fire-and-forget like other hooks: `void this.medNotifications.notifyAdministrationEvent(...)`
  (the hook already never throws). Same change is optional in
  `src/medication-administration/medication-administration.service.ts` (office path).

---

## 2. Recipients / delivery

### 2.1 Role lists are inconsistent — some alerts never reach Super Admin
Several hooks hard-code their own role names. Local DB only has a Super Admin, so these alerts
currently reach **nobody** locally; in a real org they skip Super Admin / Care Coordinator.

| Alert | File | Roles today |
|---|---|---|
| Flash message | `service-user-flash-messages/flash-message-notification.hook.ts` | Admin, Manager |
| Allocation needs confirmation | `job-allocations/schedule-allocation-notification.hook.ts` | Admin, Manager, Staff Allocation |
| Rota updated | `schedule-lifecycle-impact/schedule-lifecycle-notification.hook.ts` | Staff Allocation, Manager, Admin |
| Call-off requested | `call-off-visits/call-off-visit-notification.hook.ts` | (own list) |
| Incident reported / safeguarding | `incidents/incidents.service.ts` → `managerUserIds` | Admin, Manager, Care Coordinator |
| IA / care plan / assessment reminders / **medication** | `notifications/resolve-manager-recipients.ts` | Admin, Manager, Branch Admin |

**Fix:** one shared recipient resolver (extend `resolveManagerUserIds`) with an explicit audience
per alert type, and decide once whether Super Admin and Care Coordinator are included.

### 2.2 Branch scoping only exists in a few places
`resolveManagerUserIds` scopes managers to the service user's branch (Admin = company-wide, users
without `UserLocation` = company-wide). Only IA, assessment review, care plan review and medication
use it. ECM alerts, late visit, allocation, rota, call-off, flash message and incidents go to
**every branch**. Move them onto the shared resolver as part of 2.1.

### 2.3 Incident safeguarding alert repeats on every review save — *skipped*
`incidents.service.ts` → `notifyOnReviewFlags` fires whenever the saved review has a flag set, even
if it was already set. Should fire only when `safeguardingConcern` / `escalationRequired` changes
from not-set to set (compare with the previous review, `existing`, at the call site).

---

## 3. Product decisions needed

- **"Admin completed visit" ECM alert** (`MANUAL_ATTENDANCE`): office is alerted about something the
  office itself did. Suggest: stop notifying, keep it in the ECM audit only.
- **Controlled medication "given"**: every controlled dose (including given) now raises an office
  alert. Confirm this is wanted, or limit controlled alerts to missed/refused/not given.

---

## 4. Robustness

### 4.1 Same check-then-create race in other ECM exception paths — *skipped for now*
The duplicate-alert race was fixed in `EcmExceptionsService.syncFromEvaluation` with a
transaction-scoped `pg_advisory_xact_lock`. These paths still do `findFirst` then `create` with no lock:
unable-to-start (`ecm-exceptions.service.ts`), carer SOS (`employee-app-sos.service.ts`),
left visit area (`visit-area-lock.service.ts`), outside-area check-in request
(`visit-check-in-method-grant.service.ts`). No DB constraint either (the only `@unique` is on
`ecmExceptionId`).

**Important finding (SOS):** the carer app builds a **new idempotency key on every tap**
(`care_employee/lib/presentation/controllers/visit_workspace_controller.dart`:
`'sos-${DateTime.now().microsecondsSinceEpoch}-$jobId'`). So a double tap = two keys = two SOS,
and a lock alone does **not** fix double taps — it only fixes the same request arriving twice at once
(`RetryInterceptor` retries).

**Agreed direction (not built):**
- **Server (Option B):** lock + merge only within a short window — same carer + same visit within
  **60 s** returns the existing SOS. After 60 s it is a **new SOS with a new alert** (a genuine second
  SOS must never be hidden). Same window for unable-to-start / left area / outside-area request.
- **App:** disable the SOS button while sending and reuse one idempotency key for 60 s. Needed in
  addition to the server rule (old app versions, network retries, two devices).

### 4.2 No DB constraint behind the race fix
A partial unique index on `EcmException (scheduledJobId, kind) WHERE lifecycle is open` would
guarantee no duplicates, but it cannot be created while old duplicate rows exist (46 jobs / 86 extra
rows locally, 28 Sep 2026). Needs a one-off clean-up first — user asked **not** to touch old data for now.

---

## 5. Code quality

- **Duplicated name formatting:** "full name / preferred name" logic is copied in ~6 files
  (ECM alert, late visit, medication, calendar, incidents, IA hook, rota). Extract one util.
- **Duplicated `userIdForEmployee`** in several hooks (medication, flash, allocation, call-off).
- **Org settings read directly:** `loadNotificationDisplay` queries `organisationGeneralSettings`
  itself; `OrganisationGeneralSettingsService.getOperationalDisplaySettings()` already exists.
  Consider reusing it (needs module wiring) and/or caching.
- **`AlertExceptionRow`** in `ecm/ecm-alert.service.ts` is hand-written; derive it with
  `Prisma.EcmExceptionGetPayload<...>` so it follows the schema.

## 6. Tests

Pure text builders have specs. Missing service-level tests for:
- ECM carer-name resolution (`EcmAlertService.carerNameForAlert`).
- Medication recipients + branch scoping (verified manually with temp users, not committed).
- Advisory-lock de-duplication in `syncFromEvaluation` (verified manually with 5 concurrent calls).
- Initial assessment reviewed → sent to submitter, skipped on self-review.
