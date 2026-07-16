# Electronic Call Monitoring (ECM)

**Purpose:** Field attendance evidence — who checked in/out, when, and where — for CQC / commissioner packs.

**Related**
- Employee app APIs: `careadmin-backend/src/employee-app/`
- Attendance evidence: `VisitAttendanceEvent` (schema `scheduling`)
- Late alerts: `LateVisitAlertJob` + `LateVisitAlertLog`
- Punctuality display: [VISIT_PUNCTUALITY.md](./VISIT_PUNCTUALITY.md)
- Flutter blueprint: `care-employee-app/README.md`

---

## What is live today

| Capability | Status |
|------------|--------|
| `POST /employee-app/visits/:jobId/check-in` | Live — GPS + geofence + append-only event |
| `POST /employee-app/visits/:jobId/complete` | Live — writes CHECK_OUT attendance event |
| `VisitAttendanceEvent` table | Append-only ECM evidence (per employee / allocation) |
| Geofence policy | Soft: require reason when outside; hard block when `domRestrictJobOutsideGeofence` |
| Late-visit monitor | Cron every 5 min when `domLateVisitAlertRequired`; in-app notify + dedupe log |
| Admin visit hub | **Office workspace only** — does not create ECM GPS events |
| Flutter carer app | Not shipped — APIs ready |

---

## Evidence model

### `VisitAttendanceEvent` (do not update after insert)

| Field | Meaning |
|-------|---------|
| `eventType` | `CHECK_IN` \| `CHECK_OUT` \| `EN_ROUTE` |
| `employeeId` / `jobAllocationId` | Per-carer ECM (double-up ready) |
| `occurredAt` / `deviceCapturedAt` | Server vs device clock |
| `clientEventId` | Offline idempotency (unique when present) |
| `latitude` / `longitude` / `accuracyMeters` | GPS |
| `isMockLocation` | Spoof / mock GPS flag |
| `outsideGeofence` / `distanceMeters` / reason | Geofence exception |
| `verificationMethod` | `MOBILE_GPS` (default), future NFC/QR/office |
| `identityConfirmed` | Carer confirmed client identity |

Job `metadata.employeeApp.checkIn/checkOut` remains for workspace UI compatibility; **authoritative audit trail is `VisitAttendanceEvent`**.

### Geofence policy

```
1. Evaluate distance vs job/SU coordinates + org radius/tolerance
2. If outside AND domRestrictJobOutsideGeofence → reject check-in
3. If outside AND not restricted → require outsideGeofenceReason
4. If no GPS coords → treat as within area (cannot verify)
```

### Late-visit alerts

Uses Dom Care settings:

- `domLateVisitAlertRequired`
- `domLateVisitAlertMinutes`
- `domLateVisitAlertNotification` / Email / Text (email/SMS currently logged until providers wired)

Cron: every 5 minutes UTC. Dedupes with `LateVisitAlertLog` unique `(scheduledJobId, LATE_START)`.

---

## Office vs field

| Path | ECM GPS? | Use |
|------|----------|-----|
| Carer mobile app → employee-app APIs | Yes | Primary ECM |
| Admin “Record visit” / complete dialog | No (manual times) | Back-office correction |
| `/scheduling/visits/$jobId` hub | No | Office workspace only |

---

## Next ECM steps

1. Ship Flutter check-in/out against these APIs  
2. Wire email/SMS providers for late alerts  
3. GeoFence / Spoof schedule reports from `VisitAttendanceEvent`  
4. Per-carer overlap verification for double-up  
5. `EN_ROUTE` event from travel screen  

---

## Phase 1 foundation (in progress)

| Piece | Location | Status |
|-------|----------|--------|
| `EcmVisitEvaluation` | Prisma `scheduling` | Persists planned snapshot + four variances + classifications |
| `ecm-timing.util.ts` | `src/ecm/` | Arrival / departure / duration / missed triage |
| `ecm-settings-resolver.util.ts` | `src/ecm/` | 6-level precedence + `appliedSettingsLevel` |
| `EcmEvaluationService` | `src/ecm/` | Upsert on check-in/out (safe, non-blocking) |
| Attendance evidence | `VisitAttendanceEvent` | Remains append-only source of truth |
| `GET /ecm/visits/live-dashboard` | `EcmVisitsController` | Live buckets + counts |
| `GET /ecm/visits/:jobId` | `EcmVisitsController` | Full ECM detail + attendance events |
| `POST /ecm/visits/:jobId/evaluate` | `EcmVisitsController` | Force re-evaluate |

ECM lifecycle statuses are **parallel** to `ScheduledJobStatus` — rota statuses are not replaced.

Missed triage codes: `POTENTIAL_MISSED` ≠ `CONFIRMED_MISSED` ≠ `FALSE_ECM_ALERT` ≠ `DISPUTED`.

Permissions: `ecm.read`, `ecm.monitor`, `ecm.exceptions.manage`, `ecm.attendance.amend`, `ecm.reports.export`, `ecm.settings.manage`.

---

*Update this document when ECM policy or evidence schema changes.*
