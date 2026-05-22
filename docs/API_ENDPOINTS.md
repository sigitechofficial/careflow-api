# API Endpoints (summary)

Full Swagger: `/api` when the API is running.

## Schedule Management — Phase 1

### Schedule areas

| Method | Path | Permission |
|--------|------|------------|
| GET | `/schedule-areas` | `schedule_areas.read` |
| GET | `/schedule-areas/:id` | `schedule_areas.read` |
| POST | `/schedule-areas` | `schedule_areas.create` |
| PATCH | `/schedule-areas/:id` | `schedule_areas.update` |
| DELETE | `/schedule-areas/:id` | `schedule_areas.delete` |

### Schedules

| Method | Path | Permission |
|--------|------|------------|
| GET | `/schedules` | `schedules.read` |
| GET | `/schedules/previous` | `schedules.read` |
| GET | `/schedules/status?date=YYYY-MM-DD` | `schedules.status.read` |
| GET | `/schedules/:id` | `schedules.read` |
| POST | `/schedules/build` | `schedules.build` |
| PATCH | `/schedules/:id/status` | `schedules.update` |
| DELETE | `/schedules/:id` | `schedules.delete` |

See [README.md](../README.md) → *Schedule Management* for behaviour notes.

## Schedule Management — Phase 2

### Scheduled jobs

| Method | Path | Permission |
|--------|------|------------|
| GET | `/scheduled-jobs` | `scheduled_jobs.read` |
| GET | `/scheduled-jobs/:id` | `scheduled_jobs.read` |
| POST | `/scheduled-jobs` | `scheduled_jobs.create` |
| PATCH | `/scheduled-jobs/:id` | `scheduled_jobs.update` |
| PATCH | `/scheduled-jobs/:id/status` | `scheduled_jobs.status.update` |
| DELETE | `/scheduled-jobs/:id` | `scheduled_jobs.delete` |

### Scheduled visits

| Method | Path | Permission |
|--------|------|------------|
| GET | `/scheduled-visits` | `scheduled_visits.read` |
| GET | `/scheduled-visits/:id` | `scheduled_visits.read` |
| POST | `/scheduled-visits` | `scheduled_visits.create` |
| PATCH | `/scheduled-visits/:id` | `scheduled_visits.update` |
| PATCH | `/scheduled-visits/:id/status` | `scheduled_visits.status.update` |
| DELETE | `/scheduled-visits/:id` | `scheduled_visits.delete` |

### Schedule runs

| Method | Path | Permission |
|--------|------|------------|
| GET | `/schedule-runs` | `schedule_runs.read` |
| GET | `/schedule-runs/:id` | `schedule_runs.read` |
| POST | `/schedule-runs` | `schedule_runs.create` |
| PATCH | `/schedule-runs/:id` | `schedule_runs.update` |
| DELETE | `/schedule-runs/:id` | `schedule_runs.delete` |

### Visit actions

| Method | Path | Permission |
|--------|------|------------|
| GET | `/visit-actions` | `visit_actions.read` |
| POST | `/visit-actions` | `visit_actions.create` |
| PATCH | `/visit-actions/:id` | `visit_actions.update` |
| DELETE | `/visit-actions/:id` | `visit_actions.delete` |

## Schedule Management — Phase 3 (Allocations)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/job-allocations` | `job_allocations.read` |
| GET | `/job-allocations/:id` | `job_allocations.read` |
| GET | `/scheduled-jobs/:id/allocations` | `job_allocations.read` |
| POST | `/scheduled-jobs/:id/allocate` | `job_allocations.create` |
| POST | `/scheduled-jobs/:id/unallocate` | `job_allocations.delete` |
| POST | `/scheduled-jobs/:id/allocations/:allocationId/confirm` | `job_allocations.confirm` |

## Schedule Management — Phase 4

### Timelines (GET, read-only)

| Path | Permission |
|------|------------|
| `/schedule-timelines/jobs/day-runs` | `schedule_timelines.read` |
| `/schedule-timelines/jobs/day-timeline` | `schedule_timelines.read` |
| `/schedule-timelines/employees/day-runs` | `schedule_timelines.read` |
| `/schedule-timelines/job-carer/day-starts` | `schedule_timelines.read` |
| `/schedule-timelines/employees/day` | `schedule_timelines.read` |
| `/schedule-timelines/employees/week` | `schedule_timelines.read` |
| `/schedule-timelines/employees/month` | `schedule_timelines.read` |
| `/schedule-timelines/service-users/day` | `schedule_timelines.read` |
| `/schedule-timelines/service-users/week` | `schedule_timelines.read` |
| `/schedule-timelines/employee-capacity` | `schedule_timelines.read` or `employee_capacity.read` |

### Filters (POST)

| Path | Permission |
|------|------------|
| `/schedule-filters/jobs` | `schedule_filters.jobs` |
| `/schedule-filters/carers` | `schedule_filters.carers` |
| `/schedule-filters/customers` | `schedule_filters.customers` |

## Schedule Management — Phase 5

### Housekeeping

| Path | Permission |
|------|------------|
| GET `/scheduled-jobs-housekeeping/jobs-not-started` | `scheduled_jobs_housekeeping.read` |
| GET `/scheduled-jobs-housekeeping/jobs-needing-attention` | `scheduled_jobs_housekeeping.read` |
| GET `/scheduled-jobs-housekeeping/day-jobs` | `scheduled_jobs_housekeeping.read` |
| PATCH `/scheduled-jobs-housekeeping/jobs/:id/complete` | `scheduled_jobs_housekeeping.complete` |
| PATCH `/scheduled-jobs-housekeeping/jobs/:id/cancel` | `scheduled_jobs_housekeeping.cancel` |

### Call-off visits

| Path | Permission |
|------|------------|
| GET/POST `/call-off-visits` | `call_off_visits.read` / `call_off_visits.create` |
| GET/PATCH/DELETE `/call-off-visits/:id` | read / update / delete |
| PATCH `/call-off-visits/:id/approve` | `call_off_visits.approve` |
| PATCH `/call-off-visits/:id/reject` | `call_off_visits.reject` |

## Service User Flash Message

| Method | Path | Permission |
|--------|------|------------|
| GET | `/service-users/:id/flash-message` | `service_users.flash_message.read` |
| PUT | `/service-users/:id/flash-message` | `service_users.flash_message.update` |
| DELETE | `/service-users/:id/flash-message` | `service_users.flash_message.delete` |
| PATCH | `/service-users/:id/flash-message/clear` | `service_users.flash_message.delete` |
| GET | `/service-users/:id/flash-message/history` | `service_users.flash_message.history.read` |

See [README.md](../README.md) → *Service User Flash Message*.

## Care Pathway

| Method | Path | Permission |
|--------|------|------------|
| GET | `/care-pathway/overview` | `care_pathway.read` |
| GET/POST/PATCH/DELETE | `/pathway-checklists` (+ nested items) | `pathway_checklists.*` |
| GET/POST/PATCH/DELETE | `/pathway-actions` (+ checklist links) | `pathway_actions.*` |
| GET/PATCH | `/form-selection` (+ typed form lists) | `form_selection.*` |
| GET/POST/PATCH/DELETE | `/care-plan-text` | `care_plan_text.*` |
| GET | `/care-plan-text/categories` | `care_plan_text.read` |
| POST | `/care-plan-text/:id/preview` | `care_plan_text.preview` |
| GET | `/picture-gallery/standard`, `/uploaded`, `/search` | `picture_gallery.read` |
| POST | `/picture-gallery/uploaded` | `picture_gallery.upload` |
| DELETE | `/picture-gallery/uploaded/:id` | `picture_gallery.delete` |

See [README.md](../README.md) → *Care Pathway* and [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) → `care_pathway` schema.

## Schedule Management — Phase 6

| Path | Permission |
|------|------------|
| GET `/schedule-reports/report-types` | `schedule_reports.read` |
| GET `/schedule-reports/visit-detail` | `schedule_reports.read` |
| GET `/schedule-reports/daily-carer-allocation` | `schedule_reports.read` |
| GET `/schedule-reports/call-off-visits` | `schedule_reports.read` |
| GET `/schedule-reports/employee-capacity` | `schedule_reports.read` |
| GET `/schedule-reports/service-user-visits` | `schedule_reports.read` |
| GET `/schedule-reports/service-user-time-analysis` | `schedule_reports.read` |
| GET `/schedule-reports/scheduled-jobs-status` | `schedule_reports.read` |
