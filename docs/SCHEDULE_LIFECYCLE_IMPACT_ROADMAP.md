# Schedule Lifecycle Impact — Enterprise Roadmap

**Status:** Phase 2 complete · Phase 3 started  
**Goal:** When absences, leave, plan changes, or carer unavailability occur, the **rota reflects reality** automatically — with audit, idempotency, and coordinator override.

---

## 1. Problem statement

Today these layers are disconnected:

| Layer | Records reality | Updates rota |
|-------|-----------------|--------------|
| Service user absence (hospital) | ✅ | ✅ (Phase 1) |
| Visit plan suspend / end | ✅ | ✅ (Phase 1) |
| Employee holiday / leave | ✅ | ✅ (Phase 1) |
| Employee NCA | ✅ | ✅ (Phase 2) |
| Employee suspended / inactive | ✅ | ✅ (Phase 2) |
| Scheduling board | ✅ Badges + issues filter (Phase 2) |

Enterprise domiciliary care requires **one operational truth**: if the client is in hospital or the carer is on leave, visits must not silently remain on the rota.

### Phase 2 — Coordinator workflow & validation ✅

| Deliverable | Status |
|-------------|--------|
| Preview impact API | ✅ |
| NCA → unallocate | ✅ |
| Employee inactive → unallocate | ✅ |
| Org allocation rules (holiday/NCA) | ✅ |
| Rota board badges | ✅ |
| Employee holidays UI | ✅ |

### Phase 3 — Advanced enterprise (in progress)

| Deliverable | Status |
|-------------|--------|
| Auto SKIP exceptions from absence | ✅ |
| Coordinator notifications on bulk impact | ✅ |
| Cancel vs call-off policy by absence type | ✅ |
| Re-instate on absence end | ⏳ |
| Bank holiday calendar | ⏳ |
| Exception approval workflow | ⏳ |

---

## 2. Design principles

1. **Explicit impact** — every automated change logs `source`, `reason`, and affected job IDs.
2. **Safe defaults** — cancel/unallocate future **not-started** jobs only; never mutate `IN_PROGRESS` / `COMPLETED`.
3. **Coordinator choice** — `applyToSchedule` flag (default `true`) on absence/holiday/suspend; preview API in Phase 2.
4. **Correct action per scenario** — cancel when **client** absent; unallocate when **carer** absent (visit may still need cover).
5. **Org rules** — honour `domCareAllocationRules` (`carer_on_holiday`, `carer_on_nca`) on allocate + suggest.
6. **Plan ↔ rota** — skip generation on absence days; optional auto SKIP exceptions (Phase 3).

---

## 3. Phased delivery

### Phase 1 — Automatic rota impact (MVP enterprise)

| # | Deliverable | Trigger | Rota action |
|---|-------------|---------|-------------|
| 1.1 | `ScheduleLifecycleImpactService` | Shared module | Bulk cancel / unallocate with audit |
| 1.2 | Absence → rota | `POST/PATCH` absence (`applyToSchedule`, default true) | **Cancel** SU jobs in date range |
| 1.3 | Plan suspend / end → rota | Suspend/end (`cancelFutureVisits`, default true) | **Cancel** future SU jobs from today |
| 1.4 | Holiday → rota | `POST` employee holiday (`applyToSchedule`, default true) | **Unallocate** carer from jobs in range |
| 1.5 | Block allocate on holiday | `AllocationChecksService` | Warning / blocking per org rule |
| 1.6 | Skip generate on absence | `generateSchedule` | No new jobs on absent days |
| 1.7 | Admin UI toggles | Absences tab, visit plan suspend | Expose `applyToSchedule` / `cancelFutureVisits` |
| 1.8 | Unit tests | Impact service + absence hook | — |

**Out of scope Phase 1:** preview counts API, NCA auto-unallocate, employee status bulk unallocate, bi-directional plan sync on manual unallocate.

### Phase 2 — Coordinator workflow & validation

| Deliverable | Description |
|-------------|-------------|
| **Preview impact** | `GET …/schedule-impact-preview?from&to` before save |
| **Impact summary in API response** | `{ scheduleImpact: { jobsCancelled, jobsUnallocated, jobIds } }` |
| **NCA → unallocate** | Same pattern as holiday |
| **Employee inactive / suspended** | Unallocate all future jobs; block allocate |
| **Wire org allocation rules** | `carer_on_holiday`, `carer_on_nca`, working pattern |
| **Rota board badges** | “Client absent”, “Carer on leave”, “Needs cover” |
| **Employee holidays UI** | Admin CRUD + apply toggle |

### Phase 3 — Advanced enterprise

| Deliverable | Description |
|-------------|-------------|
| Auto SKIP exceptions from absence | Plan-level skip dates synced from absence |
| Call-off vs cancel policy | Hospital = `CANCELLED`; temporary = `CALLED_OFF` (configurable) |
| Re-instate on absence end | Optional auto-reopen jobs or regenerate |
| Bank holiday calendar | Org-wide skip / reduced service |
| Exception approval workflow | Manager sign-off for EXTRA visits |
| Notification hooks | Notify coordinators when bulk impact runs |

---

## 4. Scenario playbooks (target behaviour)

### Service user admitted to hospital

1. **Record Absences** (reason: hospital, dates, planned/unplanned).
2. If `applyToSchedule` (default): cancel all **cancellable** jobs for that SU in range.
3. **Suspend visit plan** (optional) + `cancelFutureVisits` to prevent regeneration.
4. On discharge: end absence → reactivate plan → generate from return date.

### Carer planned leave

1. Record **employee holiday**.
2. If `applyToSchedule`: unallocate carer from jobs in range → jobs become `UNALLOCATED` / `NEEDS_ATTENTION`.
3. Coordinator reassigns on Scheduling board or updates visit plan carers.

### Carer sudden sickness

1. Record holiday/NCA as **unplanned** (or deactivate employee).
2. Phase 2: same unallocate flow; Phase 1: manual reassign on board + allocate checks warn.

### Visit plan suspended / ended

1. Suspend/end with reason.
2. If `cancelFutureVisits`: cancel future SU jobs from effective date.
3. `generateSchedule` blocked while not ACTIVE.

---

## 5. Technical architecture

```
ServiceUserAbsencesService ──┐
ServiceUserVisitPlansService ├──► ScheduleLifecycleImpactService
EmployeeHolidaysService ─────┤         │
                             │         ├─ cancelServiceUserJobsInRange()
                             │         ├─ unallocateEmployeeJobsInRange()
                             │         └─ isServiceUserAbsentOnDay()  → generateSchedule
JobAllocationsService ◄──────┘         (syncJobAllocationStatus)
AllocationChecksService ◄── holiday / NCA checks
```

**Cancellable job statuses:** `DRAFT`, `UNALLOCATED`, `ALLOCATED`, `NEEDS_ATTENTION`  
**Never auto-touch:** `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `CALLED_OFF`, `MISSED`

---

## 6. API changes (Phase 1)

### `CreateServiceUserAbsenceDto` / `UpdateServiceUserAbsenceDto`

- `applyToSchedule?: boolean` (default `true`)

### `VisitPlanStatusChangeDto`

- `cancelFutureVisits?: boolean` (default `true`)

### `CreateEmployeeHolidayDto`

- `applyToSchedule?: boolean` (default `true`)

### Response envelope (all impact endpoints)

```json
{
  "message": "Absence recorded",
  "data": { "...": "..." },
  "scheduleImpact": {
    "jobsCancelled": 12,
    "jobsUnallocated": 0,
    "jobIds": ["…"]
  }
}
```

---

## 7. Testing strategy

- Unit: date overlap, status filters, open-ended absence cap
- Integration: absence create → jobs cancelled; holiday create → allocations removed
- Regression: generate skips absent days; suspend blocks generate

---

## 8. Related docs

- [VISIT_PLAN_ENTERPRISE_ROADMAP.md](./VISIT_PLAN_ENTERPRISE_ROADMAP.md) — visit plan ↔ rota
- [phases/SCHEDULING_MANAGEMENT.md](./phases/SCHEDULING_MANAGEMENT.md) — scheduling phases
- [phases/SERVICE_CARE_MANAGEMENT.md](./phases/SERVICE_CARE_MANAGEMENT.md) — absences CRUD (update: scheduling integration)
