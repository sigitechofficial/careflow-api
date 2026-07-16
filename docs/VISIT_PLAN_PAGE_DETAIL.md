# Visit Plan page — product & engineering detail

**Route:** `/service-users/:serviceUserId/visit-plan`  
**Example:** `/service-users/c4ebec1a-5604-4095-941c-479e7299acf2/visit-plan`  
**Frontend page:** `care-admin/src/features/service-users/pages/ServiceUserVisitPlanPage.tsx`  
**Module:** `care-admin/src/features/service-users/visit-plan/`  
**Backend:** `careadmin-backend/src/service-user-visit-plans/`

**Companions**
- [VISIT_PLAN_CONFIRMATION_UX.md](./VISIT_PLAN_CONFIRMATION_UX.md) — preview / confirm gates
- [VISIT_PLAN_REAL_WORLD_SCENARIOS.md](./VISIT_PLAN_REAL_WORLD_SCENARIOS.md) — operational scenarios
- [VISIT_PLAN_PAUSE_ENTERPRISE.md](./VISIT_PLAN_PAUSE_ENTERPRISE.md) — suspend / review governance
- [VISIT_PLAN_ENTERPRISE_ROADMAP.md](./VISIT_PLAN_ENTERPRISE_ROADMAP.md) — roadmap

---

## 1. Purpose

The Visit Plan page is the **authorised care package / call-pattern** surface for a domiciliary service user. Coordinators use it to define **when visits happen**, **who should attend**, and to **activate**, **suspend**, **end**, and **generate rota** from that package.

It is intentionally separate from the clinical **Care Plan**:

| Surface | Owns |
|---------|------|
| Visit Plan | Call pattern, slots, carers, contracted hours, rota generation, lifecycle |
| Care Plan | Clinical tasks / forms; linked *into* slots via accepted care-plan form IDs |

**User goals**
1. Configure time slots (from Settings → medication / time rounds).
2. Assign carers (slot-wide or per weekday), link care plans, set exceptions.
3. Align planned hours with weekly contracted hours (DOM Care).
4. Activate a draft into the live authorised package (one ACTIVE plan at a time).
5. Generate scheduled visits for a date range.
6. Review call pattern, visit outcomes, and version / amendment audit history.

---

## 2. Route, search params, permissions

### Route definition

Defined in `care-admin/src/router.tsx` as `serviceUsersVisitPlanRoute`:

| Item | Value |
|------|--------|
| Path | `/service-users/$serviceUserId/visit-plan` |
| Permission gate | `requirePermission('service_users.read')` |
| Loader | Prefetches visit-plan route data via `prefetchServiceUserVisitPlanRoute` |
| Page title | `Visit Plan` |

### Search params

| Param | Values | Effect |
|-------|--------|--------|
| `planId` | UUID | Select a specific plan version |
| `view` | omitted \| `details` | Omitted → **Set up visits**; `details` → review tabs |
| `detailsTab` | omitted \| `calendar` \| `history` | With `view=details`: Call pattern / Calendar / History |

**Tab resolution**

| URL | Page tab |
|-----|----------|
| (no `view`) | Set up visits |
| `?view=details` | Call pattern |
| `?view=details&detailsTab=calendar` | Visit calendar |
| `?view=details&detailsTab=history` | Versions & audit |
| `?planId=…` (+ optional view/tab) | Same tab, selected version |

Stale `planId` values are cleared with `replace: true` navigation.

### Fine-grained permissions

Declared in auth types (backend enforces with broader fallbacks):

| Permission | Typical use |
|------------|-------------|
| `service_users.visit_plan.read` | View plans |
| `service_users.visit_plan.write` | Create / amend |
| `service_users.visit_plan.activate` | Activate / re-activate |
| `scheduling.generate_from_visit_plan` | Generate rota |

### Navigation entry points

- Service user module tabs → **Visit Plan**
- Initial Assessment care activation → “Open Visit Plan”
- Header **Edit profile** → `/service-users/:id/view`
- DOM Care contract-hours banner → related funding context
- Related (not this page): portal `/portal/visit-plans`; Absences tab reuses visit-plan impact APIs

---

## 3. Page shell & tabs

```
ServiceUserModuleHeader
ServiceUserModuleTabs
└── Page tabs
    ├── Set up visits     → ServiceUserVisitPlanTab
    ├── Call pattern      → VersionPicker + ContextBanner + VisitPlanDetailsView
    ├── Visit calendar    → VersionPicker + ContextBanner + VisitPlanCalendarTab
    └── Versions & audit  → VersionPicker + ContextBanner + VisitPlanHistoryPanel
```

| Tab label | Internal id | Role |
|-----------|-------------|------|
| **Set up visits** | `setup` | Edit live / draft / suspended package; activate; generate rota |
| **Call pattern** | `summary` | Read-only summary of slots, carers, rules |
| **Visit calendar** | `calendar` | Scheduled visits & outcomes for selected plan version |
| **Versions & audit** | `history` | Compare versions; amendments & status events |

Review tabs share `VisitPlanVersionPicker` and `VisitPlanContextBanner`. Empty state on review tabs prompts return to **Set up visits**.

---

## 4. Set up visits (editable workspace)

Primary component: `ServiceUserVisitPlanTab.tsx`.

### Guided checklist (`VisitPlanSetupGuide`)

1. Choose which visits happen (enable slots + days)
2. Set start & end times
3. Assign carers per visit
4. Save the plan (draft / suspended) or activate
5. Generate rota (when ACTIVE)

### Main sections

1. **Editable plan picker** — when multiple DRAFT / ACTIVE / SUSPENDED versions exist  
2. **Setup guide** — checklist above  
3. **Care pathway context** (`VisitPlanCarePathwayContextPanel`) — IA / care activation readiness when relevant  
4. **Visit plan (care package)** card  
   - Weekly contracted hours, default number of carers, review due  
   - DOM Care sync / “Use contract values” (`prefill-dom-care`)  
   - `VisitPlanWeeklyHoursPanel` — planned vs contracted hours  
5. **Visit schedule** table — one row per catalogue time slot  
6. **Selected slot configure panel** — exceptions, frequency/lifecycle, carers-by-day, recording options  
7. **Save / activate / lifecycle actions** — notes, amendment reason, suspend / end / re-activate  
8. **Generate rota** — ACTIVE only; date range, area, backfill, preview  
9. **Dev clear rota** toolbar (`VisitPlanDevClearRotaToolbar`) — non-production wipe helper  

### Slot row actions

| Action | UI |
|--------|-----|
| Enable / disable | Switch on row |
| Days / times / duration | Inline fields |
| Required carers count | `VisitPlanCarersCountInput` |
| Assign carers | `VisitPlanSlotCarersDialog` |
| Link care plans | `VisitPlanSlotCarePlansDialog` |
| Slot details sheet | `VisitPlanSlotDetailsSheet` |
| Exceptions | `VisitPlanSlotExceptionsPanel` (SKIP / EXTRA) |
| Frequency & rules | `VisitPlanSlotAdvancedPanel` + `VisitPlanSlotLifecyclePanel` |
| Carers by day | `VisitPlanSlotCarerByDayPanel` |
| Visit recording flags | `VisitPlanSlotAdditionalDetailsPanel` |

Default slots are seeded from Settings medication / time rounds (`useMedicationRounds` → `defaultEditableVisitPlanSlots`).

---

## 5. Lifecycle

### Statuses

```
DRAFT ──activate──► ACTIVE ──suspend──► SUSPENDED ──re-activate──► ACTIVE
                      │                      │
                      └──────── end ─────────┴──────── end ───────► ENDED
```

| Status | Meaning | Typical actions on Set up |
|--------|---------|---------------------------|
| **DRAFT** | Package not live | Create, Save draft, Activate authorised package |
| **ACTIVE** | Authorised live package | Amend (reason required), Suspend, End, Generate rota |
| **SUSPENDED** | Temporarily paused | Save, Re-activate; generate rota blocked |
| **ENDED** | Closed | Immutable on setup; viewable on Call pattern / Calendar / History |

Activating a plan ends any other ACTIVE plans for that service user and sets approval metadata (`approvedAt` / `approvedById`). Re-activation clears suspension fields and writes a `REACTIVATED` status event.

### Lifecycle dialogs

| Dialog | File | Notes |
|--------|------|-------|
| Activate | `VisitPlanActivateDialog.tsx` | Other active plans + optional cancel of ended-package jobs; pattern conflicts |
| Re-activate | `VisitPlanReactivateDialog.tsx` | Suspended → active |
| Suspend | `VisitPlanSuspendDialog.tsx` | Pause catalog reason, review due, contingency, cancel future visits, impact preview |
| End | `VisitPlanEndDialog.tsx` | Reason, effective to (immediate / backdated / scheduled), cancel visits |
| Generate preview | `VisitPlanGeneratePreviewDialog.tsx` | Create / skip counts before generate |
| Working pattern sync | `VisitPlanWorkingPatternSyncDialog.tsx` | Respect vs allocate despite pattern conflicts |
| Amendment confirm | `VisitPlanConfirmGate.tsx` | Live save when rota impact > 0 |
| Calendar outcome | `VisitPlanCalendarOutcomeDialog.tsx` | Record outcome on a date/slot |

**Amendment reasons**
- DRAFT default: `Draft visit plan updated`
- SUSPENDED default: `Suspended visit plan updated before re-activation`
- ACTIVE: explicit reason required (audit)

---

## 6. Slot model

Types: `care-admin/src/features/service-users/visit-plan/types.ts`  
Persisted as Prisma `VisitPlanSlot` (+ carer assignments, exceptions).

### Core

| Field | Description |
|-------|-------------|
| `slotCode` / `label` | From medication / time-slot catalogue |
| `daysOfWeek` | `0` = Sunday … `6` = Saturday |
| `plannedStartTime` / `plannedEndTime` | `HH:mm` |
| `requiredCarers` | Headcount required |
| `isEnabled` | Disabled slots ignored for readiness / rota |
| `medicationRoundCode` | Settings round link |
| `notes`, `sortOrder` | |

### Schedule pattern

| Field | Values |
|-------|--------|
| `scheduleFrequency` | `DAILY` \| `WEEKLY` \| `MONTHLY` |
| `repeatEvery` + `repeatUnit` | `DAYS` \| `WEEKS` \| `MONTHS` |
| Monthly `monthlyDayMode` | `BY_DATE` (`monthlyDaysOfMonth`) or `BY_PATTERN` (`monthlyPatternOrdinal` + `monthlyPatternWeekday`) |

### Kind & window

| Field | Values / use |
|-------|----------------|
| `slotKind` | `STANDARD` \| `OVERNIGHT` (ends next day) \| `ONE_OFF` |
| `slotEffectiveFrom` / `slotEffectiveTo` | Recurring window |
| `oneOffDate` | Single date when `ONE_OFF` |
| `durationMinutes` | Optional override |
| `allowBackfillDays` | Rota backfill window |

### Carers

- Prefer `carerAssignments[]`: `dayOfWeek` (`null` = all days), `employeeId`, `role` (`LEAD` \| `SECONDARY`), optional times/duration, `sortOrder`
- Legacy mirror: `assignedEmployeeIds[]` (derived from assignments when present)
- UI: assign dialog + optional different carers on different days

### Care plans & exceptions

- `linkedCarePlanFormIds[]` — accepted care-plan forms from IA / care pathway
- Exceptions: `SKIP` \| `EXTRA` with date and optional time / duration / carers / notes

### Recording / advanced

| Field | Default / notes |
|-------|-----------------|
| `timeCritical` | false |
| `timeToleranceMinutes` | 30 |
| `notesRequired` / `photoAllowed` / `shareOutcomeWithFamily` | false |
| `analysisArea` | Optional catalogue (dementia, falls, medication, …) |

---

## 7. Key features

### Generate rota

- Only for **ACTIVE** plans
- Inputs: `fromDate`, `toDate` (blank → general settings horizon / default **28 days**), optional schedule area, `backfillDays`
- Preview then POST create; skips absences, SKIP exceptions, bank holidays, existing visits
- Bulk generate lives under scheduling (`/visit-plan-bulk-schedule`) — not this page’s primary UI

### Weekly contracted hours

- `VisitPlanWeeklyHoursPanel` compares enabled-slot planned minutes vs `weeklyContractedHours`
- Over-contract: **warning** (also surfaced on Schedule Jobs) — does **not** hard-block generate
- Prefill from DOM Care profile

### Carer suggestions

- `POST .../suggest-carers` — availability, skills, preferred / blocked, rota conflicts, location filter
- Fit: `good` \| `partial` \| `poor`
- Used in assign dialog and Call pattern availability warnings

### Working pattern sync

- Plan flag `respectWorkingPatternOnSync` (default true)
- Preview conflicts before save / activate / generate
- Dialog: respect pattern (skip mismatched) vs allocate anyway

### Readiness

- Frontend checklist (setup guide)
- Backend readiness util: enabled slots, times, days, carer counts
- Activate requires ≥ 1 enabled slot

### Versioning & audit

- Multiple plans per service user; one ACTIVE at a time
- Amendments store reason + before/after snapshots
- `statusEvents`: `SUSPENDED` \| `REACTIVATED` \| `ENDED` \| `SCHEDULED_END`
- Setup edits non-ENDED only; review tabs can select ended versions via `planId`

---

## 8. Call pattern / Calendar / History

### Call pattern (`VisitPlanDetailsView`)

Read-only: plan meta, weekly hours, per-slot cards (days, times, carers, care plans, frequency, time-critical, exceptions) with carer availability warnings.

### Visit calendar (`VisitPlanCalendarTab`)

- Day / week / month and calendar / list modes
- Loads `calendar-visits` for the selected plan version
- Record outcome via `VisitPlanCalendarOutcomeDialog`

**Outcome statuses** (`visit-plan-calendar-outcome.constants.ts`)

| Value | Label |
|-------|--------|
| `NOT_GENERATED` | Not on rota |
| `PLANNED` | Planned |
| `STARTED` | In progress |
| `COMPLETED` | Completed |
| `PARTIALLY_COMPLETED` | Partially completed |
| `MISSED` | Did not attend |
| `CALLED_OFF` | Called off |
| `CANCELLED` | Cancelled |
| `NEEDS_ATTENTION` | Needs attention |

### Versions & audit (`VisitPlanHistoryPanel`)

Timeline of versions, activations, amendments, and status events; selecting a version opens Call pattern for that `planId`.

---

## 9. API surface

Frontend client: `care-admin/src/features/service-users/visit-plan/api.ts`  
Base path: `/service-users/:serviceUserId/visit-plans`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | List plans |
| GET | `/active` | Active plan |
| GET | `/:planId` | Get by id |
| POST | `/` | Create draft |
| POST | `/from-assessment/:submissionId` | Draft from IA |
| POST | `/suggest-carers` | Carer suggestions |
| PATCH | `/:planId` | Update + amendment audit |
| POST | `/:planId/amendment-impact-preview` | Live amendment rota preview |
| POST | `/:planId/carer-sync-pattern-preview` | Working-pattern conflicts |
| GET | `/:planId/activate-impact-preview` | Activate replacement impact |
| POST | `/:planId/activate` | Activate / re-activate |
| POST | `/:planId/suspend` | Suspend |
| GET | `/:planId/suspend-impact-preview` | Suspend cancel preview |
| POST | `/:planId/end` | End / schedule end |
| GET | `/:planId/end-impact-preview` | End cancel preview |
| POST | `/:planId/prefill-dom-care` | Prefill hours/carers |
| GET | `/:planId/generate-schedule-preview` | Rota dry-run |
| POST | `/:planId/generate-schedule` | Generate scheduled visits |
| GET | `/:planId/slots/:slotId/skip-impact-preview` | SKIP exception impact |
| GET | `/:planId/calendar-visits` | Calendar outcomes |
| POST | `/:planId/calendar-visits/record-outcome` | Record outcome |

**Governance** (`/visit-plans`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/suspension-reviews-overdue` | Overdue suspension reviews |
| POST | `/dev/clear-visit-plans-and-rota` | Dev wipe (`dryRun` query) |

**Bulk** (`/visit-plan-bulk-schedule`) — scheduling tooling: candidates + bulk generate.

Related absences API used elsewhere: `GET .../absences/:absenceId/return-impact-preview`.

---

## 10. Integration points

| Area | Integration |
|------|-------------|
| **Scheduling** | Generate → scheduled visits/jobs; amendments cancel / reschedule / unallocate; query-key invalidation |
| **Care plans / IA** | Accepted forms linked per slot; pathway panel; create-from-assessment |
| **Absences** | SKIP sync for absence ranges; return-impact + generate prompts on Absences tab |
| **DOM Care / funding** | `weeklyContractedHours`; prefill; weekly hours panel; over-contract visual on Schedule Jobs |
| **Employee working patterns** | Suggest carers + sync-pattern preview |
| **Medication / time slots** | Slot catalogue from Settings rounds |
| **Schedule areas** | Optional on generate |
| **General settings** | Rota horizon days / mode |
| **Audit log** | `SERVICE_USER_VISIT_PLAN_*` actions |
| **Background jobs** | Rolling rota; scheduled end |

---

## 11. Frontend file map

```
pages/ServiceUserVisitPlanPage.tsx          # Shell + tabs
visit-plan/
  ServiceUserVisitPlanTab.tsx               # Set up visits
  api.ts · hooks.ts · types.ts
  hooks/useVisitPlanCareContext.ts
  VisitPlanSetupGuide.tsx
  VisitPlanCarePathwayContextPanel.tsx
  VisitPlanDetailsView.tsx                  # Call pattern
  VisitPlanCalendarTab.tsx                  # Calendar
  VisitPlanHistoryPanel.tsx                 # Versions & audit
  VisitPlanVersionPicker.tsx
  VisitPlanContextBanner.tsx
  VisitPlanWeeklyHoursPanel.tsx
  VisitPlanSlot*.tsx                        # Slot editors / dialogs
  VisitPlanActivate|Suspend|End|ReactivateDialog.tsx
  VisitPlanGeneratePreviewDialog.tsx
  VisitPlanWorkingPatternSyncDialog.tsx
  components/VisitPlanConfirmGate.tsx
  components/VisitPlanRotaImpactSummary.tsx
  visit-plan-*.util.ts                      # Time, version, carers, generate, calendar, …
```

Backend entry: `service-user-visit-plans.controller.ts`, `service-user-visit-plans.service.ts`, plus amendment-impact / bulk-schedule / governance controllers and readiness / generate / absence-sync utils.

---

## 12. Enterprise & compliance notes

- **Amendment audit:** ACTIVE saves require a reason; amendments store before/after JSON snapshots (CQC-oriented trail).
- **Confirm gates:** amendment, activate, suspend/end (often two-step), generate preview, working-pattern choice — see confirmation UX doc.
- **Retrospective / scheduled changes:** backdated suspend/end requires `retrospectiveReason`; future `effectiveTo` → `SCHEDULED_END`.
- **Suspension governance:** catalog pause reason, expected resume, review due (default +7 days), contingency notes; overdue reviews API.
- **Time-critical visits:** tolerance window for compliance reporting.
- **Package vs clinical:** Visit Plan is operational package; Care Plan remains clinical; pathway readiness from IA.
- **Rota safety:** preview before destructive schedule changes; over-hours soft-warn only.
- **Carer compliance signals:** suggestion payload includes compliance issues, preferred/blocked, skill gaps.
- **Dev wipe:** gated write + dry-run; not for production ops.

---

## 13. Quick reference — plan entity

```ts
ServiceUserVisitPlan {
  id, serviceUserId
  status: DRAFT | ACTIVE | SUSPENDED | ENDED
  effectiveFrom, effectiveTo
  weeklyContractedHours, numberOfCarers
  reviewDueAt, notes
  approvedAt, approvedById
  suspendedAt, pauseReasonCatalogId, expectedResumeAt
  suspensionReviewDueAt, suspensionContingencyNotes
  respectWorkingPatternOnSync
  slots[], amendments[], statusEvents[]
}
```

---

*Source of truth is the code cited above. Update this document when tab structure, lifecycle rules, or API contracts change.*
