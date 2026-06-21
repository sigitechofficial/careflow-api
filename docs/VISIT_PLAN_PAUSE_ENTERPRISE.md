# Visit plan pause & suspension (enterprise)

## Two ways to pause visits

| Mechanism | When to use | Dates | Rota impact |
|-----------|-------------|-------|-------------|
| **Record Absences** (service user profile) | Hospital, holiday, short break with **known start/end** | Required start; optional end | Cancels visits in date range (`applyToSchedule`) |
| **Suspend visit plan** (this module) | Package must stay **off** until manual re-activation — funding review, safeguarding, commissioner embargo | Expected resume optional; **review due** default 7 days | Blocks `generateSchedule`; optional cancel future visits |

CQC / commissioner expectations: document **why**, **contingency/welfare**, **review date**, and **proportionality** (minimum pause time, regular review). See [Schedule lifecycle playbook](./SCHEDULE_LIFECYCLE_IMPACT_ROADMAP.md).

For a full scenario matrix (rota, carers, CQC, stakeholders), see [VISIT_PLAN_REAL_WORLD_SCENARIOS.md](./VISIT_PLAN_REAL_WORLD_SCENARIOS.md).

## End API (`POST …/end`)

- `reason` (required)
- `effectiveTo` (optional YYYY-MM-DD) — defaults to **today**. Future date = **scheduled closure** (plan stays ACTIVE until that day). Past date = retrospective end.
- `retrospectiveReason` (required when `effectiveTo` is before today)
- `cancelFutureVisits` (default true) — cancels from **effectiveTo** forward

Preview: `GET …/:planId/end-impact-preview?fromDate=YYYY-MM-DD`

## Suspend API (`POST …/suspend`)

- `pauseReasonCatalogId` (required) — seeded catalog (`HOSPITAL`, `FUNDING`, …)
- `reason` (required) — free-text detail + contingency summary
- `effectiveFrom` (optional) — today or past; rota cancels from this date (not future)
- `retrospectiveReason` (required when `effectiveFrom` is before today)
- `expectedResumeAt` (optional ISO date) — omit / null = indefinite
- `reviewDueAt` (optional) — defaults to **+7 days**
- `contingencyNotes` (optional)
- `cancelFutureVisits` (default true)

Preview: `GET …/:planId/suspend-impact-preview?fromDate=YYYY-MM-DD`

Creates: `VisitPlanStatusEvent` (SUSPENDED), amendment snapshot, audit log.

## Re-activate (`POST …/activate`)

- Optional `reactivationReason`
- Clears suspension fields on plan
- Creates `VisitPlanStatusEvent` (REACTIVATED) when resuming from SUSPENDED

## End vs suspend

- **Suspend** — temporary; same plan version can return to ACTIVE
- **End** — closes package (`effectiveTo`); not editable; use when client leaves or package is replaced
