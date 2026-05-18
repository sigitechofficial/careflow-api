# CareAdmin backend

NestJS API for the Care Admin platform: **PostgreSQL**, **Prisma** (multi-schema), **JWT** auth, **RBAC** permissions, and **Swagger** under `/api`.

Default dev user from seed: `admin@careadmin.local` / `Admin@12345` (see `prisma/seed.ts`).

**Employee RBAC → login roles:** When employment is saved, matching users can receive identity role updates from the employee’s RBAC level (email match; Super Admin excluded). See **`docs/phases/EMPLOYEE_MANAGEMENT.md`** → *RBAC level and identity permissions*.

## Scripts

```bash
pnpm install
pnpm run start:dev
pnpm exec prisma migrate dev
pnpm exec prisma db seed
```

## Audit activity module

Immutable audit data lives in the **`audit`** Postgres schema. The `AuditLogsModule` exposes **read-only** HTTP APIs (no update/delete on audit rows).

### Tables (Prisma)

| Model | Purpose |
|--------|---------|
| `AuditLog` | Domain actions (`module`, `action`, optional `recordType` / `recordId`, `oldValues` / `newValues` JSON, IP, user agent, `status`) |
| `LoginHistory` | Login/logout/refresh outcomes (`event`, `email`, `failureReason`, `status`) |
| `SecurityEvent` | Security-oriented events (`eventType`, `severity`, `metadata`) |
| `DataAccessLog` | Sensitive reads (`accessType`: VIEW, DOWNLOAD, EXPORT, PRINT) |
| `ExportLog` | Report/export operations (`exportType`, `filters`, `fileName`, `recordCount`) |

### Read APIs

Base path: **`/audit-logs`** (all require JWT + permission **`audit_logs.read`**).

| Method | Path |
|--------|------|
| GET | `/audit-logs` — paged audit log list |
| GET | `/audit-logs/:id` — single audit log |
| GET | `/audit-logs/login-history` |
| GET | `/audit-logs/security-events` |
| GET | `/audit-logs/data-access` |
| GET | `/audit-logs/exports` |

Query DTOs support pagination (`page`, `limit`), `search`, filters (`userId`, `module`, `action`, `recordType`, `recordId`, `status`, `eventType`, `severity`, `dateFrom`, `dateTo`, `sortBy`, `sortOrder`).

### Permissions

- Seed includes **`audit_logs.read`**.
- **Super Admin** receives all permissions (including audit read).
- **Privacy Officer** and **Admin** receive **`audit_logs.read`** by default (see `prisma/seed.ts`).

### Behaviour

- **Immutability**: application code must not expose PATCH/DELETE for audit tables.
- **Masking**: `AuditLogsService` masks known sensitive keys (`password`, `refreshToken`, `pin`, `keySafeNumber`, etc.) in JSON payloads before persist.
- **Auth logging**: login success/failure, refresh, logout, password change, forgot/reset placeholders write to `LoginHistory`, `AuditLog`, and/or `SecurityEvent` as appropriate.
- **Employee logging**: CRUD and sub-resources (documents, compliance, reviews, emergency contacts, employment, skills, certifications, non-core activities) emit `AuditLog` rows; sensitive views emit `DataAccessLog` where wired.
- **Service User logging**: Service User Phase 1 writes `AuditLog` for lifecycle, contacts, address, assignments, and photos; `GET /service-users/:id` writes `DataAccessLog` (VIEW) plus `service_user_profile_viewed`. Address `keySafeNumber` is masked in audit JSON.

### Migrations

After pulling schema changes:

```bash
pnpm exec prisma migrate dev --name audit_activity
pnpm exec prisma generate
```

### Testing audit output

1. Seed DB and log in as a user with `audit_logs.read`.
2. Perform login, employee updates, document download, etc.
3. Call `GET /audit-logs` (and sibling endpoints) with your bearer token.

### Later modules

Service Care and Scheduling should call `AuditLogsService.logAudit`, `logDataAccess`, and `logExport` from their services for care plans, medication, schedules, and exports—reuse the same enums/DTO patterns as the Employee module.

## Service User Medication (MAR foundation)

Clinical medication data lives in the **`service_users`** schema (types, routes, categories, frequencies, administration rounds, medications, packs, schedules, administration events, medication-specific allergies, support profile, reviews, and placeholder stock movements).

- **Regular vs PRN**: `MedicationKind.REGULAR` supports scheduled rounds; `PRN` records administrations with mandatory free-text reason or notes.
- **Charts**: `GET /service-users/:id/medication-chart/regular?month=YYYY-MM` builds a month grid with per-day statuses from events and schedules. `GET .../medication-chart/prn?dateFrom=&dateTo=` lists PRN events grouped by medication.
- **Reports** (tenant-wide or per SU): `GET /medication-reports/administered|stock-levels|late-administrations|audit` with `dateFrom` / `dateTo` and optional `serviceUserId` or `allServiceUsers=true` (requires appropriate permissions).
- **Late administrations**: compared with `scheduledDateTime`; threshold minutes from env `MEDICATION_LATE_THRESHOLD_MINUTES` (default **30**).
- **Permissions** (seed): `service_users.medications.*` keys — Super Admin all; Admin/Manager/Care Coordinator clinical coordination set; **Senior Carer/Nurse** read + administer + write; **Carer/Domestic** read charts + **administer**; delete/reviews delete/reports export tightened to Admin/Manager.
- **Audit / data access**: creates/updates/deletes, administrations, chart views, and report generation emit `AuditLog` (`AuditModule.MEDICATION`) and `DataAccessLog` (VIEW) per product rules. Controlled-drug and missed/refused paths call optional **in-app notification** hooks (`MEDICATION_ALERT`) when `NotificationsModule` is available (recipient list is placeholder until routing is defined).
- **Seed**: medication lookup tables + optional **Blister Pack 2025** demo on the first service user (idempotent).

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm exec prisma db seed
```

## Service Users (Phase 1 — core)

PostgreSQL schema **`service_users`** holds Service User entities, domain lookups (status, title, gender, marital status, care type, funding type, risk level, relationship types), contacts, address, references, assignment rows, and photo metadata. **JWT + RBAC** protect all routes; **Swagger** tags: Service Users, Service User Contacts, Service User Address, Service User Assignments, Service User Photos, Service User Lookups.

### Commands

```bash
npx prisma migrate dev --name service_user_core
npx prisma generate
npx prisma db seed
pnpm start:dev
```

Open Swagger at `http://localhost:3000/api/docs` (or your `SWAGGER_PATH`), authorize with **Bearer** token from `POST /auth/login`, then exercise Service User endpoints.

### API overview

| Area | Method | Path |
|------|--------|------|
| Core | GET | `/service-users` — list (pagination, search, filters, sort) |
| Core | GET | `/service-users/:id` — detail (audit + data access log) |
| Core | POST | `/service-users` |
| Core | PATCH | `/service-users/:id` |
| Core | DELETE | `/service-users/:id` — soft delete |
| Core | PATCH | `/service-users/:id/status` |
| Contacts | GET/POST | `/service-users/:id/contacts` |
| Contacts | PATCH/DELETE | `/service-users/:id/contacts/:contactId` |
| Address | GET | `/service-users/:id/address` |
| Address | PATCH | `/service-users/:id/address` |
| Assignments | GET | `/service-users/:id/assignments` |
| Assignments | PATCH | `/service-users/:id/assignments` |
| Photo | POST | `/service-users/:id/photo` — multipart field `file` (JPEG/PNG/WebP) |
| Photo | DELETE | `/service-users/:id/photo` — clears profile photo |
| Lookups | GET | `/service-user-lookups` and `/service-user-lookups/...` segments |
| Live-in | GET | `/live-in-lookups` (+ `service-types`, `levels-of-care`, `scan-types`) |
| Live-in | GET/POST/PATCH/DELETE | `/service-users/:id/live-in-profile` (+ `status`, `preferred-carers`, `blocked-carers`, `contract-documents`, download) |

### Permissions (seed)

`service_users.read|create|update|delete|status.update`, `service_users.contacts.*`, `service_users.address.read|update`, `service_users.assignments.read|update`, `service_users.photos.upload|delete`, `service_users.lookups.read`, and **`service_users.live_in_profile.*`** (profile, carers, documents, lookups — see Live-in section below). **Super Admin** receives all keys automatically. **Admin**, **Manager**, and **Care Coordinator** receive read/create/update for core and sub-resources plus photo upload and lookups read (not delete/status update/photo delete by default — see `prisma/seed.ts`).

### File uploads

Photos are stored under `{UPLOAD_BASE_PATH}/service-users/photos` (default `uploads/...`). Static hosting uses `UPLOAD_BASE_PATH` in `main.ts`. Max size: `MAX_UPLOAD_FILE_SIZE_MB` or `UPLOAD_MAX_FILE_SIZE_BYTES` (see `src/config/app.config.ts`).

### Seed lookups

Statuses, titles, genders, marital statuses, care types, funding types, risk levels, and relationship types are upserted in `prisma/seed.ts`.

## Service User Funding (enterprise)

**Funding** means who pays for the service user’s care and under which arrangement. This is separate from the demographic **Service User Funding Type** lookup on `ServiceUser` (e.g. high-level category on the person record).

| Concept | Role |
|--------|------|
| **FundingType** | Classification of funding (Private, Local Authority, NHS, Direct Payment, Mixed, Self-Funded, Family Funded, Unknown). Seeded with stable `code` values. |
| **Funder** | Organisation or entity that pays (e.g. Croydon Council, NHS CHC). Optionally linked to a `FundingType`. |
| **ServiceUserFunding** | A dated arrangement for one service user: type, optional funder, status, references, amounts, primary flag, approval metadata, soft delete. **Source of truth** for funding history; `ServiceUser.currentFundingId` points at the current primary row when set. |

### API (JWT + permissions)

| Area | Method | Path |
|------|--------|------|
| Funding types | GET/POST/PATCH/DELETE | `/funding-types`, `/funding-types/:id` |
| Funders | GET/POST/PATCH/DELETE | `/funders`, `/funders/:id` |
| Per service user | GET | `/service-users/:id/funding` (paginated list) |
| Per service user | GET/PATCH/DELETE | `/service-users/:id/funding/:fundingId` |
| Per service user | POST | `/service-users/:id/funding` |
| Workflow | PATCH | `.../funding/:fundingId/status`, `.../set-primary`, `.../approve`, `.../end` |
| References only | PATCH | `/service-users/:id/funding` — NHS number / Social Services ref (unchanged) |

Swagger tags: **Funding Types**, **Funders**, **Service User Funding**.

### Permissions (seed)

`funding_types.*`, `funders.*`, `service_users.funding.read|create|update|delete|status.update|approve|set_primary`. **Super Admin** gets all. **Admin**, **Manager**, and **Care Coordinator** get read/create/update for lookups and service-user funding plus status and set-primary; **delete** and **approve** (and lookup **delete**) are also granted to **Admin** and **Manager** (see `prisma/seed.ts`).

### Business rules

- Multiple `ServiceUserFunding` rows per user; at most one **primary**; setting primary clears others and updates `currentFundingId`.
- **Approve** sets `approvedAt` / `approvedById`, optional `approvalReference`, and status **APPROVED** (future start date) or **ACTIVE** (started or no start date).
- **End** sets status **ENDED**, `endDate`, clears primary/current pointer when applicable.
- Soft delete only; primary cleared on delete.

### Migrate and seed

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm exec prisma db seed
```

### Swagger

Authorize with **Bearer** from `POST /auth/login`, then open `/api/docs` and try **Funding Types**, **Funders**, and **Service User Funding** operations.

### Deferred (later phases)

Care plans, observations, visits, reports, flash messages, body map, and gallery-style photo management beyond a single profile image.

## Service User Calendar

**Service User Calendar** manages date-based events for service users (birthdays, appointments, reviews, reminders). It is **separate from Scheduling**, which handles visits, jobs, and carer allocation.

### Purpose

Staff use the calendar to see upcoming birthdays, GP/hospital appointments, care reviews, medication reviews, family/social events, assessments, and care-plan review dates.

### Data model (schema `service_users`)

| Model | Role |
|--------|------|
| `CalendarEventType` | Lookup: `CUSTOMER_EVENT`, `BIRTHDAY`, `APPOINTMENT`, `GP_APPOINTMENT`, etc. (seeded with colours) |
| `ServiceUserCalendarEvent` | Event row: title, `startDateTime`, optional `endDateTime`, `allDay`, `status`, reminders, notify flags |

Event statuses: `SCHEDULED`, `COMPLETED`, `CANCELLED`, `MISSED`, `RESCHEDULED`.

### API (JWT + permissions)

| Area | Method | Path |
|------|--------|------|
| Event types | GET/POST/PATCH/DELETE | `/calendar-event-types`, `/calendar-event-types/:id` |
| Per-user events | GET/POST/PATCH/DELETE | `/service-users/:id/calendar/events`, `.../events/:eventId` |
| Status | PATCH | `/service-users/:id/calendar/events/:eventId/status` |
| Calendar view | GET | `/service-users/:id/calendar?view=DAY\|WEEK\|MONTH&date=YYYY-MM-DD` |
| Global calendar | GET | `/service-users/calendar/events?dateFrom=&dateTo=` (required range) |

**Calendar views:** `DAY` = selected UTC day; `WEEK` = Sun–Sat week containing `date`; `MONTH` = full month. Response includes `events` and `groupedByDate`.

### Permissions

- `service_users.calendar.read` — list/view (global + per user)
- `service_users.calendar.create` / `.update` / `.delete` / `.status.update` / `.export`
- `service_users.calendar_event_types.*` — lookup admin (Admin/Super Admin for mutations)

Seeded to Super Admin; read/create/update/status to Admin, Manager, Care Coordinator; delete to Admin/Manager.

### Audit and data access

- Audit: `service_user_calendar_event_*`, `service_user_calendar_view_opened`, `service_user_global_calendar_viewed`, `calendar_event_type_*`
- **DataAccessLog** (VIEW) on calendar view, event list/detail, and global calendar

### Notifications

When `reminderBeforeMinutes` or notify flags are set on create/update, in-app notifications are sent via `NotificationsService` (types such as `APPOINTMENT_REMINDER`, `BIRTHDAY_REMINDER`). A full reminder **scheduler** is not implemented yet.

### Frontend

- Global page: `/service-users/calendar` — title **Service Users Calendar**, info icon tooltip explaining difference from Scheduling
- Profile tab: **Calendar** on Edit Service User

### Migrate and seed

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm exec prisma db seed
```

Swagger: tags **Service User Calendar** and **Calendar Event Types** at `/api/docs`.

## Initial Assessment Checklist (template-based)

Structured **initial assessment** for a selected service user: care needs, risks, equipment, environment, nutrition, medication support, communication, and emotional wellbeing. This complements the legacy **`ServiceUserInitialAssessment`** 1:1 profile (`/service-users/:id/initial-assessment`) — the new module uses reusable templates, sections, questions, submissions, and answers.

### Data model (schema `service_users`)

| Model | Role |
|--------|------|
| `InitialAssessmentTemplate` | Reusable checklist definition (`isDefault`, `version`) |
| `InitialAssessmentSection` | 28 numbered sections (Mobility, Amputation, … Emotional wellbeing) |
| `InitialAssessmentQuestion` | Checkbox/text items with `riskFlag`, `carePlanTrigger` |
| `InitialAssessmentSubmission` | Per service user + template; workflow status |
| `InitialAssessmentAnswer` | One row per question per submission (upserted) |

**Statuses:** `DRAFT` → `IN_PROGRESS` → `SUBMITTED` → `REVIEWED` (or `ARCHIVED` / `CANCELLED`).

### API (JWT + permissions)

| Area | Method | Path |
|------|--------|------|
| Templates | GET/POST/PATCH/DELETE | `/initial-assessment-templates`, `.../default`, sections, questions |
| Submissions | GET/POST/PATCH/DELETE | `/service-users/:id/initial-assessments`, `.../latest`, `.../:submissionId` |
| Answers | GET/PATCH | `.../:submissionId/answers` |
| Workflow | PATCH | `.../submit`, `.../review`, `.../status` |
| Reports | GET | `.../summary`, `.../risk-summary`, `.../care-plan-triggers` |

### Permissions

- `service_users.initial_assessment.read|create|update|delete|submit|review|export`
- `initial_assessment_templates.read|create|update|delete|manage_default`

Super Admin: all. Care Coordinator: read/create/update/submit. Admin/Manager/Senior Carer: review. Template mutations: Admin.

### Audit and data access

- Audit: `initial_assessment_*` actions on template/section/question/submission/answers/submit/review/summary views
- **DataAccessLog** (VIEW) on list/detail/answers/summary/risk/triggers

### Seed

Default template **Initial Assessment Checklist** v1 with **28 sections** and representative questions (idempotent). Run:

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm exec prisma db seed
```

E2E: `pnpm test:e2e --testPathPatterns=initial-assessment`

Swagger tags: **Initial Assessments**, **Initial Assessment Templates**.

## Service User Live-in Service Profile

**Live-in Service Profile** models arrangements where carers **stay overnight, live in, or provide extended-duration support** for a service user (from the “Live in Service Profile” tab on Edit Service User).

### Data model (schema `service_users`)

| Model | Role |
|--------|------|
| `LiveInServiceType`, `LiveInLevelOfCare`, `LiveInScanType` | Lookups (seeded codes; soft-deletable) |
| `ServiceUserLiveInProfile` | **One row per service user** (`serviceUserId` unique): enabled flag, custom setup, FKs to lookups + optional `ServiceUserContact` as resident contact, care instructions, dates, `LiveInProfileStatus`, `numberOfCarers` |
| `ServiceUserLiveInPreferredCarer` / `ServiceUserLiveInBlockedCarer` | Junction to `Employee`; unique per profile + employee; mutual exclusion enforced in service |
| `ServiceUserLiveInContractDocument` | File metadata (`fileUrl` under `/uploads/service-users/live-in-contracts/`); soft delete |

### API (JWT + permissions)

| Area | Method | Path |
|------|--------|------|
| Lookups | GET | `/live-in-lookups`, `/live-in-lookups/service-types`, `/live-in-lookups/levels-of-care`, `/live-in-lookups/scan-types` |
| Profile | GET | `/service-users/:id/live-in-profile` — **DataAccessLog** (VIEW) + audit `live_in_profile_viewed` when a profile exists |
| Profile | POST | `/service-users/:id/live-in-profile` — create or reactivate soft-deleted profile |
| Profile | PATCH | `/service-users/:id/live-in-profile` |
| Profile | DELETE | `/service-users/:id/live-in-profile` — soft delete; clears preferred/blocked rows; soft-deletes contract rows |
| Profile | PATCH | `/service-users/:id/live-in-profile/status` |
| Preferred carers | GET/POST | `.../live-in-profile/preferred-carers` |
| Preferred carers | DELETE | `.../live-in-profile/preferred-carers/:employeeId` |
| Blocked carers | GET/POST | `.../live-in-profile/blocked-carers` |
| Blocked carers | DELETE | `.../live-in-profile/blocked-carers/:employeeId` |
| Contracts | GET | `.../live-in-profile/contract-documents` |
| Contracts | POST | `.../live-in-profile/contract-documents` — multipart field **`file`** (PDF, DOC, DOCX, JPG, PNG) |
| Contracts | GET | `.../live-in-profile/contract-documents/:documentId/download` — **requires** `service_users.live_in_profile.documents.download`; **DataAccessLog** (DOWNLOAD) + audit |
| Contracts | DELETE | `.../live-in-profile/contract-documents/:documentId` |

Swagger tags: **Live-in Lookups**, **Service User Live-in Profile**.

### Permissions (seed)

- `service_users.live_in_profile.read|create|update|delete|status.update`
- `service_users.live_in_profile.carers.read|manage`
- `service_users.live_in_profile.documents.read|upload|download|delete`
- `service_users.live_in_profile.lookups.read`

**Super Admin** receives all keys. **Admin**, **Manager**, and **Care Coordinator** receive read/create/update/status, carers, documents (including download), and lookups; **delete** on the live-in profile is additionally granted to **Admin** and **Manager** only (see `prisma/seed.ts`).

### File uploads

Contracts are stored under `{UPLOAD_BASE_PATH}/service-users/live-in-contracts` (default `uploads/...`). Max size: **`MAX_UPLOAD_FILE_SIZE_MB`** (default **10**) or **`UPLOAD_MAX_FILE_SIZE_BYTES`** when set (same pattern as other upload modules).

### Audit and data access

- Profile **GET** and contract **download** write **`DataAccessLog`** with module `SERVICE_USER` and metadata including `serviceUserId` / `liveInProfileId`.
- Create/update/delete/status, carers, and contracts emit **`AuditLog`** actions such as `live_in_profile_created`, `live_in_contract_uploaded`, etc. (see `audit-action.enum.ts`).

### Migrate and seed

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm exec prisma db seed
```

### Swagger

Authorize with **Bearer** from `POST /auth/login`, then use tags **Live-in Lookups** and **Service User Live-in Profile**.

## Employee Compliance (enterprise)

Compliance is **not** hard-coded on the `Employee` model. The chain is: **ComplianceType** (master, in `lookups`) → **ComplianceRequirement** (who must hold what, scoped by role/work area/job title/contract/location; `zoneId` reserved until employment has zone data) → **EmployeeCompliance** (per-employee record with workflow and persisted `EmployeeComplianceStatus`) → **EmployeeComplianceDocument** (evidence files under `uploads/employees/compliance/`) → **ComplianceVerification** (audit trail of actions).

- **Status rules:** Effective status is computed with UTC calendar-day boundaries (see `compliance-status.calculator.ts`); list APIs return the computed value as `status` and expose `persistedStatus` for debugging. `runDailyComplianceCheck()` batch-recomputes stored `status` (call from a future `@nestjs/schedule` cron — not wired yet; see `EmployeeComplianceService`).
- **Permissions:** `compliance_types.*`, `compliance_requirements.*`, `employees.compliance.*` (including `create`, `delete`, `verify`, `reject`, `documents.*`, `reports.read` / `reports.export`). Seed grants read/report keys to Admin, Manager, HR, and Privacy Officer; Super Admin gets all.
- **Migrations:** `pnpm exec prisma migrate deploy` (or `migrate dev`) after pull; then `pnpm exec prisma db seed` for types/requirements.
- **Key routes:** `GET/POST/PATCH/DELETE /compliance-types`, `GET/POST/PATCH/DELETE /compliance-requirements`, `GET/POST/PATCH/DELETE /employees/:id/compliance`, document routes under `.../compliance/:complianceId/documents`, reports under `GET /employee-compliance/summary|missing|expired|expiring|pending-review|report|detail-report`.
- **Chart summary:** `GET /employees/chart-summary` compliance SQL excludes rows with `isNoLongerRequired` so the dashboard matches the compliance module.

---

## Real-time in-app notifications (WebSocket + PostgreSQL)

Notifications are stored in PostgreSQL (`notifications` schema: `Notification`, `NotificationRecipient`, `NotificationPreference`). **WebSocket** (Socket.IO, namespace `/notifications`) is only used for live delivery to signed-in users — there is **no Redis** in this phase; scaling to multiple API instances will require a **Redis adapter for Socket.IO** (see TODO below).

### WebSocket

- **Namespace:** `/notifications` (client URL example: `https://<api-host>/notifications` with Socket.IO path `/socket.io`).
- **Auth:** send the JWT access token as `auth: { token: "<accessToken>" }` (or `Authorization: Bearer <token>` on the handshake). Temporary inspector tokens are rejected. Rooms are derived from the JWT (`user:<userId>` and `role:<roleName>`); the client cannot subscribe to another user’s id.
- **Server → client events:** `notification:new`, `notification:read`, `notification:read-all`, `notification:dismissed`, `notification:unread-count`.
- **Client → server events (optional; REST is primary):** `notification:subscribe`, `notification:unsubscribe`, `notification:mark-read`, `notification:mark-all-read`, `notification:dismiss`.

### REST APIs

| Method | Path | Permission |
|--------|------|--------------|
| GET | `/notifications` | `notifications.read` |
| GET | `/notifications/unread-count` | `notifications.read` |
| GET | `/notifications/:id` | `notifications.read` |
| PATCH | `/notifications/:id/read` | `notifications.update` |
| PATCH | `/notifications/read-all` | `notifications.update` |
| PATCH | `/notifications/:id/dismiss` | `notifications.dismiss` |
| GET | `/notification-preferences` | `notifications.preferences.read` |
| PATCH | `/notification-preferences` | `notifications.preferences.update` |
| POST | `/notifications` | `notifications.create` |

`POST /notifications` creates rows for recipients who have **in-app** enabled for that notification type, emits `notification:new` (with `playSound` derived from **sound** preference and self-recipient rule), and pushes updated unread counts.

### User preferences

`NotificationPreference` uses a **composite primary key** `(userId, type)` (no separate surrogate id). Columns: `inAppEnabled` (default true), `soundEnabled` (default true), and reserved `emailEnabled` / `smsEnabled` / `pushEnabled` (defaults false) for future channels. PostgreSQL enforces **`soundEnabled` ⇒ `inAppEnabled`** via a check constraint; the API applies the same rule when saving.

### Frontend sound behaviour

The SPA uses the Web Audio API (soft beeps by severity) and, if present, tries `/sounds/notification.mp3` first. Sound **never** plays until the user has interacted with the page (pointer/key), respects the server `playSound` flag and per-type `soundEnabled`, and is **throttled** (at most once per ~2s). Preferences are not stored in `localStorage`.

### Limitations & future work

- **Single instance:** without Redis, WebSocket fan-out works for one Node process only.
- **TODO:** add **Redis Socket.IO adapter** when running multiple backend replicas so every instance can deliver to connected clients.

---

## NestJS starter (reference)

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

Further NestJS documentation: [https://docs.nestjs.com](https://docs.nestjs.com).

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
