# Scheduling Management — Phase Plan

## Phase 1 — Foundation

Status: **DONE** (backend implemented)

- [x] `ScheduleArea`, `ScheduleBatch`, `ScheduleAreaStatus` models (`scheduling` schema)
- [x] Schedule area CRUD APIs
- [x] Schedule batch list / previous / status / build placeholder APIs
- [x] RBAC permissions + seed areas
- [x] Audit + data access logging

See [README.md](../../README.md) → *Schedule Management — Phase 1*.

## Phase 2 — Scheduled Jobs and Visits

Status: **IN PROGRESS** (backend implemented)

- [x] `ScheduleRun`, `ScheduledJob`, `ScheduledVisit`, `VisitAction`
- [x] CRUD APIs + build schedule `jobs[]` payload
- [x] Permissions, audit, Swagger

## Phase 3 — Allocation and Carer Assignment

Status: **IN PROGRESS** (backend implemented)

- [x] `JobAllocation` model and APIs
- [x] Allocate / unallocate / confirm workflow
- [x] Modular validation checks + audit + notifications

## Phase 4 — Timeline Views and Filters

Status: **COMPLETED**

- [x] Timeline read APIs (jobs, employees, service users, capacity)
- [x] Filter jobs / carers / customers POST APIs
- [x] Audit + data access logging

## Phase 5 — Housekeeping and Call-off Visits

Status: **COMPLETED**

- [x] Housekeeping list APIs + complete/cancel
- [x] `CallOffVisit` model + CRUD + approve/reject
- [x] Audit logging + notification hooks

## Phase 6 — Reports

Status: **COMPLETED**

- [x] Report types catalog + JSON report endpoints
- [x] Audit/data access + export log placeholder (`export=true`)

**Next:** Frontend integration or advanced scheduling rules.

---

## Later phases

Status: TODO

## Goal
Scheduling system that depends on Employee data for filters, timelines, and capacity reporting.

## Dependencies
- Employee module (employment type, role/designation, work area, zones/areas, working patterns, compliance flags)
- Lookups module (roles, job titles, grades, zones, locations)
- Auth + RBAC permissions

## TODO — Core features
- [ ] Employee/carer filters API (employed/bank/agency)
- [ ] Role/designation filters API
- [ ] Area/zone filters API
- [ ] Employee day timeline API
- [ ] Employee week timeline API
- [ ] Employee month timeline API
- [ ] Employee capacity report API

## TODO — Data model (to be designed)
- [ ] Shift / rota models
- [ ] Availability and constraints (working patterns, holidays, non-core activities)
- [ ] Assignment rules + validation

