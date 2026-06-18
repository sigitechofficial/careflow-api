# Visit Plan Enterprise Roadmap

**Status:** Phase 1 complete · Phase 2 in progress  
**Scope:** Service user visit plans → authorised call pattern → scheduled rota  
**Modules:** `careadmin-backend` (API + Prisma), `care-admin` (UI)

---

## 1. Vision

Deliver **enterprise-grade domiciliary visit planning**: per-slot lifecycle dates, asymmetric double-up durations, day-specific carer rosters, one-off/special visits, overnight handling, audited backfill, and bi-directional carer sync with the daily rota.

---

## 2. Phased delivery

### Phase 1 — Foundation (current)

| Deliverable | Description |
|-------------|-------------|
| **Slot lifecycle** | `slotEffectiveFrom`, `slotEffectiveTo`, `slotKind` (STANDARD / OVERNIGHT / ONE_OFF), `oneOffDate`, `allowBackfillDays` |
| **Carer assignments** | `VisitPlanSlotCarerAssignment` — per day-of-week (or all days), role (LEAD/SECONDARY), optional duration + time overrides |
| **Exceptions** | `VisitPlanSlotException` — SKIP or EXTRA on a specific date |
| **Duration authority** | `durationMinutes` drives end time when set; validated against planned window |
| **Per-allocation times** | `JobAllocation.scheduledStartDateTime/EndDateTime`, `durationMinutes`, `isLeadCarer` |
| **Generation** | Respects slot dates, exceptions, carer assignments, overnight spans, optional backfill |
| **Carer sync** | Port `visit-plan-slot-carer-sync.util.ts`; sync on plan update + generation skip |
| **Activate fix** | Preserve `effectiveFrom` on re-activation from SUSPENDED |
| **UI** | Slot lifecycle panel, duration editor, carer-by-day assignment, generate defaults + backfill |

### Phase 2 — Operational excellence

| Deliverable | Description |
|-------------|-------------|
| Suspend / end plan UI | ✅ Wired in Care Admin (reason field + actions) |
| **Schedule lifecycle impact** | ✅ Phase 1 — see [SCHEDULE_LIFECYCLE_IMPACT_ROADMAP.md](./SCHEDULE_LIFECYCLE_IMPACT_ROADMAP.md) |
| Schedule area on generate | ✅ `scheduleAreaId` dropdown on generate form |
| Weekly contracted hours panel | ✅ Planned vs contracted hours summary |
| Smart assign → carer assignments | ✅ Dialog populates `carerAssignments` with roles |
| Overnight batch semantics | Optional second batch row for next-day segment |
| Contracted hours validation | Planned hours vs `weeklyContractedHours` |
| Plan → rota time sync | Update future PLANNED visits when slot times change |

### Phase 3 — Commissioner & finance

| Deliverable | Description |
|-------------|-------------|
| Funding line linkage | Visit plan ↔ funding authorisation |
| Billing duration source | Configurable: allocation vs job window |
| Exception approval workflow | Manager sign-off for EXTRA visits |
| Bank holiday rules | Org calendar integration |

---

## 3. Data model (Phase 1)

```
ServiceUserVisitPlan
  └── VisitPlanSlot
        ├── slotEffectiveFrom / slotEffectiveTo
        ├── slotKind, oneOffDate, allowBackfillDays
        ├── VisitPlanSlotCarerAssignment[]  (day, employee, role, duration, times)
        └── VisitPlanSlotException[]        (date, SKIP | EXTRA)

ScheduledJob / ScheduledVisit  ← generateSchedule
  └── JobAllocation[]  (per-carer start/end/duration, isLeadCarer)
```

---

## 4. Business rules

### 4.1 Slot matching (occurrence on calendar day D)

1. Slot `isEnabled`
2. `slotEffectiveFrom ≤ D` (if set)
3. `slotEffectiveTo ≥ D` (if set)
4. Plan `effectiveTo ≥ D` (if set) and plan ACTIVE
5. Recurrence: `visitPlanSlotMatchesDay` (daily/weekly/monthly)
6. ONE_OFF: `oneOffDate === D`
7. No SKIP exception on D
8. EXTRA exception adds occurrence even if recurrence miss

### 4.2 Duration

- If `durationMinutes` set → end = start + duration (unless OVERNIGHT with end ≤ start → +24h cap)
- Job window = union of all carer windows
- Each allocation gets its own window when assignments specify per-carer duration/times

### 4.3 Double-up asymmetric (e.g. 60 min + 30 min)

- Carer A: 07:00–08:00 (LEAD, 60 min)
- Carer B: 07:00–07:30 (SECONDARY, 30 min)
- Single job; visit window 07:00–08:00; allocations carry individual times

### 4.4 Backfill

- Generate form: `fromDate`, `toDate`, optional `backfillDays` (0–14)
- Effective start = `fromDate - backfillDays`, capped per slot by `allowBackfillDays` and `slotEffectiveFrom`
- Audit log records backfill range

### 4.5 Overnight (22:00–07:00)

- `slotKind = OVERNIGHT` or end ≤ start → end datetime +1 day
- Job assigned to **start-day** batch (Phase 1); Phase 2 optional next-day batch segment

---

## 5. API changes (Phase 1)

| Endpoint | Change |
|----------|--------|
| `POST/PATCH visit-plans` | Slot DTO extended: lifecycle, carerAssignments, exceptions |
| `POST generate-schedule` | `backfillDays`, enforce slot date bounds |
| `GET visit-plans/:id` | Return nested assignments + exceptions |

---

## 6. Acceptance criteria (Phase 1)

- [x] User sets MORNING slot start 1 Jul, end 30 Sep — no visits outside range
- [x] User assigns Carer A Mon/Wed, Carer B Tue/Thu on same slot — generation allocates correctly
- [x] Double-up: two carers with 60 and 30 min — allocations show distinct end times (P02 seed: 90+45)
- [x] ONE_OFF slot on 15 Aug — single occurrence only
- [x] SKIP exception removes one date; EXTRA adds ad-hoc date
- [x] NIGHT 22:00–07:00 creates job ending next calendar day (P06 seed)
- [x] Backfill 7 days creates past jobs when allowed
- [x] Amendment audit captures slot lifecycle changes
- [x] Updating slot carers syncs future PLANNED rota rows

---

## 7. Test plan

- Unit: `visit-plan-schedule-match.util`, `visit-plan-slot-window.util`, `visit-plan-slot-carer-resolve.util`
- Integration: generateSchedule with persona P02 (double-up), P03 (time-critical), P06 (overnight)
- Manual: Care Admin visit plan Configure → Generate → Scheduling view

---

## 8. References

- Gap analysis: conversation research (visit plan vs enterprise requirements)
- Existing spec: `docs/test-data/SERVICE_USER_PERSONAS.md`
- Sync reference: `_sync-repos-push/careflow-api/.../visit-plan-slot-carer-sync.util.ts`
