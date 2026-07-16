# Visit delivery status (per-visit)

**Purpose:** Classify each visit’s lifecycle, punctuality, and duration exceptions so coordinators can see a clear picture on the visit itself (hub / workspace / employee visits). Dashboard KPIs are separate.

**Helpers**

- Backend: `src/scheduling/visit-delivery-assessment.util.ts`
- Backend reasons: `src/scheduling/visit-timing-exception-reason.util.ts`
- Admin UI: `VisitDeliveryStatusPanel`, mirrored utils under `care-admin/.../scheduling/utils/`

**API**

- Timeline / housekeeping day jobs include `deliveryAssessment`
- `GET /scheduled-jobs/:id` returns rich timeline fields plus `deliveryAssessment`, `timingException`, `cancellation`, `attendanceEvents`

## Lifecycle codes

Scheduled · Assigned · En route · In progress · Completed · Partially completed · Missed · Cancelled · Called off · Unplanned · Needs attention

## Timing codes

On time · Early arrival · Late start · Critically late · Not assessed

## Duration exception codes

Planned short visit (&lt;30 min) · Actual short visit · Early end · Overrun · Abnormally long open · Zero-duration · Negative/invalid duration · Partially completed

## Mandatory timing reason codes

When completing a visit with late / early / short / overrun (or invalid duration), `timingExceptionReasonCode` is required, with optional notes (`OTHER` requires notes). Stored on `ScheduledJob.metadata`.
