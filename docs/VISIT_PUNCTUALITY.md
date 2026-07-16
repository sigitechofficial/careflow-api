# Visit punctuality tracking (CQC / enterprise)

**Purpose:** Define how Care classifies **started early / late** and **ended early / late** for domiciliary visits, for coordinator evidence and future authority exports.

**Related UI:** Employee edit → **Visits** tab (`/employee/:id/edit?tab=visits`)  
**Helpers:** `care-admin/src/features/employees/utils/visit-punctuality.util.ts`  
**ECM (GPS check-in/out):** [VISIT_ECM.md](./VISIT_ECM.md)  
**Duration variance (separate):** short / exceeded / on time — see Employee Visits duration columns (billing-aligned underrun &gt; 15 minutes).

---

## CQC context

CQC does **not** publish a single national “X minutes late = non-compliant” rule. Inspectors expect providers to:

1. Record planned vs actual start/end (electronic call monitoring)
2. Define late / missed visits in policy and contracts
3. Monitor, alert, inform the person, and act on exceptions
4. Show trends and learning in governance

Industry / commissioner practice commonly uses a **±15 minute** on-time window. Care defaults to 15 when no org or slot override applies.

Useful references:

- [NICE QS123 — Plan for missed or late visits](https://www.nice.org.uk/guidance/qs123/chapter/quality-statement-2-plan-for-missed-or-late-visits)
- Org settings already support late-visit alerts (`domLateVisitAlertMinutes`)

---

## Tolerance hierarchy

Effective tolerance for **punctuality** (start and end):

```
1. Visit plan slot is time-critical → slot.timeToleranceMinutes
2. Else organisation.domLateVisitAlertMinutes  (if > 0)
3. Else organisation.domGlobalToleranceMinutes (if > 0)
4. Else 15 minutes (industry default)
```

**Do not** mix this with **duration** short/exceeded rules (those remain independent; duration underrun uses &gt; 15 minutes under planned length for billing alignment).

---

## Classifications

For **start** and **end** independently:

| Outcome | Condition |
|---------|-----------|
| **Not assessed** | Missing actual start (start metrics) or actual end (end metrics) |
| **Early** | `actual − planned < −tolerance` |
| **On time** | `\|actual − planned\| ≤ tolerance` |
| **Late** | `actual − planned > +tolerance` and not critically late |
| **Critically late** | `actual − planned > max(tolerance × 2, tolerance + 15)` |

**Variance (min):** signed integer string for exports (`+18`, `-5`, `0`). Empty when not assessed.

Per-visit lifecycle, duration exceptions, and mandatory timing reason codes: see [VISIT_DELIVERY_STATUS.md](./VISIT_DELIVERY_STATUS.md).

Database already stores separate columns (no Phase 1 migration):

| Entity | Planned | Actual |
|--------|---------|--------|
| `ScheduledJob` | `scheduledStartDateTime`, `scheduledEndDateTime` | (via related visit) |
| `ScheduledVisit` | `scheduledStartDateTime`, `scheduledEndDateTime` | `actualStartDateTime`, `actualEndDateTime` |
| `VisitReconciliation` | `plannedStartDateTime`, `plannedEndDateTime` | `actualStartDateTime`, `actualEndDateTime` |

Phase 1 **derives** punctuality on read; it does not persist classification rows.

---

## Export column dictionary (stable labels)

Use these exact headers / values for future CSV / PDF authority packs:

| Column | Example values |
|--------|----------------|
| Planned start | `07:00` (or ISO in file export) |
| Planned end | `08:00` |
| Actual start | `07:20` or blank |
| Actual end | `07:55` or blank |
| Start variance (min) | `+20`, `-5`, blank |
| Start punctuality | `Late` \| `Early` \| `On time` \| `Not assessed` |
| End variance (min) | `+12`, `-3`, blank |
| End punctuality | `Late` \| `Early` \| `On time` \| `Not assessed` |
| Planned duration | `60m` / minutes |
| Actual duration | `55m` / blank |
| Duration variance | `Exceeded` \| `Short` \| `On time` \| `Not assessed` |
| Variance (min) | `+15`, `-20`, blank |
| Status | Visit outcome (Completed, Missed, …) |

Mapper helper: `visitPunctualityExportFields({ start, end })`.

---

## Roadmap

| Phase | Scope |
|-------|--------|
| **1 (done)** | Shared helpers + Employee Visits columns + this doc |
| **2** | Clarify Dom Care settings copy that late-alert minutes drive punctuality classification |
| **3** | Optional persist on reconciliation; KPI dashboards; download punctuality report |

---

*Update this document when tolerance hierarchy or export labels change — renaming export strings breaks historical packs.*
