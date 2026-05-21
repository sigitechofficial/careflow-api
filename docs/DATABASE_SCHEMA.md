# Database schema (summary)

Prisma multi-schema PostgreSQL. See `prisma/schema.prisma` for the source of truth.

## Schedule Management — Phase 1 (`scheduling` schema)

### Enums

- `ScheduleStatus`: `NOT_BUILT`, `BUILDING`, `BUILT`, `FAILED`, `CANCELLED`
- `ScheduleBuildSource`: `TEMPLATE`, `WITHOUT_TEMPLATE`, `MANUAL`

### Models

| Model | Purpose |
|-------|---------|
| `ScheduleArea` | Scheduling zone/group (e.g. Croydon Transport). Optional `locationId`, `zoneId`. Unique `code`. Soft delete + audit columns. |
| `ScheduleBatch` | One active build per `scheduleDate` (partial unique index). Status, build source, template ref, metadata. |
| `ScheduleAreaStatus` | Per batch + area status. Unique `(scheduleBatchId, scheduleAreaId)`. |

### Relations

- `ScheduleArea` → `lookups.Location`, `lookups.Zone` (optional)
- `ScheduleAreaStatus` → `ScheduleBatch`, `ScheduleArea`, `identity.User` (`builtBy`)
- `ScheduleBatch` → `identity.User` (`builtBy`, created/updated/deleted)

Migration: `prisma/migrations/20260519120000_schedule_foundation/`

## Service User Flash Message (`service_users` schema)

### Enum

- `FlashMessageStatus`: `ACTIVE`, `EXPIRED`, `CLEARED`, `ARCHIVED`

### Model

| Model | Purpose |
|-------|---------|
| `ServiceUserFlashMessage` | Short profile alert per service user. `message` (max 150 in API), `displayUntil` (inclusive UTC calendar day), `isCurrent`, clear metadata, soft delete + audit user FKs. Historical rows retained when superseded or cleared. |

### Rules

- One current active non-expired message per service user (enforced in application transactions).
- Upsert archives prior current row to `ARCHIVED`.

Migration: `prisma/migrations/20260602120000_service_user_flash_messages/`

## Schedule Management — Phase 2 (`scheduling` schema)

### Enums

- `ScheduledJobStatus`, `ScheduledJobPriority`, `ScheduledVisitStatus`

### Models

| Model | Purpose |
|-------|---------|
| `ScheduleRun` | Optional run/group under a batch (date, times, area). |
| `ScheduledJob` | Service user job on a batch (times, priority, status, location). |
| `ScheduledVisit` | Visit line under a job. |
| `VisitAction` | Checklist/action on job or visit; `completedBy` → Employee. |

Migration: `prisma/migrations/20260520130000_schedule_jobs_visits/`

## Schedule Management — Phase 3 (`scheduling` schema)

| Model | Purpose |
|-------|---------|
| `JobAllocation` | Links employee to scheduled job/visit; status workflow; warning JSON; partial unique on active job+employee. |

Enum: `AllocationStatus` — `PENDING_CONFIRMATION`, `ALLOCATED`, `CONFIRMED`, `UNALLOCATED`, `CANCELLED`.

Migration: `prisma/migrations/20260521120000_job_allocations/`

| `CallOffVisit` | Call-off request for a service user; optional links to `ScheduledJob` / `ScheduledVisit`; approval workflow. |

Enum: `CallOffVisitStatus` — `REQUESTED`, `APPROVED`, `REJECTED`, `CANCELLED`.

Migration: `prisma/migrations/20260522120000_call_off_visits/`
