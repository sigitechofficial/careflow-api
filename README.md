# CareAdmin backend

NestJS API for the Care Admin platform: **PostgreSQL**, **Prisma** (multi-schema), **JWT** auth, **RBAC** permissions, and **Swagger** under `/api/docs`.

**Full local setup (database, frontend, both servers):** see the [root README](../README.md).

Default dev user from seed: `admin@careadmin.local` / `Admin@12345` (see `prisma/seed.ts`).

**Phase tracker:** [`PHASES.md`](PHASES.md) · **Module detail:** [`docs/phases/`](docs/phases/)

**Employee RBAC → login roles:** When employment is saved, matching users can receive identity role updates from the employee’s RBAC level (email match; Super Admin excluded). See **`docs/phases/EMPLOYEE_MANAGEMENT.md`** → *RBAC level and identity permissions*.

## Local setup (quick)

```powershell
pnpm install
copy .env.example .env
# Edit DATABASE_URL and JWT secrets in .env

pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm run prisma:seed

pnpm run start:dev
```

API: http://localhost:3000 · Swagger: http://localhost:3000/api/docs

### Care pathway gallery & form icons

```powershell
pnpm run sync:gallery-images    # from uploads/gallery-images/*.png
pnpm run prisma:seed
pnpm run refresh:form-icons       # update existing forms to gallery PNGs
```

See `prisma/seeds/data/GALLERY_IMPORT.md`.

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm run start:dev` | Dev server with watch |
| `pnpm run build` | Compile NestJS |
| `pnpm exec prisma migrate dev` | Apply migrations |
| `pnpm run prisma:seed` | Seed database |
| `pnpm run prisma:studio` | Prisma Studio UI |
| `pnpm run sync:gallery-images` | Import gallery PNGs into `uploads/care-pathway/imported` |
| `pnpm run refresh:form-icons` | Refresh form `pictureUrl` from gallery |
| `pnpm run test` / `test:e2e` | Jest unit / e2e tests |

## Audit activity module

Immutable audit data lives in the **`audit`** Postgres schema. The `AuditLogsModule` exposes **read-only** HTTP APIs (no update/delete on audit rows).

### Tables (Prisma)

| Model | Purpose |
|--------|---------|
| `AuditLog` | Domain actions (`module`, `action`, `eventType` — VIEW/CREATE/UPDATE/DELETE/EXPORT/SECURITY/SYSTEM, optional `recordType` / `recordId`, `oldValues` / `newValues` JSON, IP, user agent, `status`) |
| `LoginHistory` | Login/logout/refresh outcomes (`event`, `email`, `failureReason`, `status`) |
| `SecurityEvent` | Security-oriented events (`eventType`, `severity`, `metadata`) |
| `DataAccessLog` | Sensitive reads (`accessType`: VIEW, DOWNLOAD, EXPORT, PRINT) |
| `ExportLog` | Report/export operations (`exportType`, `filters`, `fileName`, `recordCount`) |

### Read APIs

Base path: **`/audit-logs`** (all require JWT + permission **`audit_logs.read`**).

| Method | Path |
|--------|------|
| GET | `/audit-logs` — paged audit log list (enriched with service user name, item label, readable summary) |
| GET | `/audit-logs/:id` — single audit log |
| GET | `/audit-logs/event-types` — filter labels for `eventType` enum |
| GET | `/audit-logs/login-history` |
| GET | `/audit-logs/security-events` |
| GET | `/audit-logs/data-access` |
| GET | `/audit-logs/exports` |

`GET /audit-logs` query: pagination (`page`, `limit`), `search`, `userId`, `serviceUserId`, `module`, `action`, `eventType`, `recordType`, `recordId`, `status`, `dateFrom`, `dateTo` (UTC day bounds), `ipAddress` (partial match), `sortBy`, `sortOrder`. Other list endpoints use their own DTOs (`severity` on security events, etc.).

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
4. Regenerate the committed OpenAPI artifact after controller/DTO changes: `pnpm run openapi:export` (writes `openapi/openapi.json`).

Swagger tag: **Audit Logs** — same surface as `/api/docs`.

### Later modules

Service Care and Scheduling should call `AuditLogsService.logAudit`, `logDataAccess`, and `logExport` from their services for care plans, medication, schedules, and exports—reuse the same enums/DTO patterns as the Employee module.

## Service User Medication (MAR foundation)

Clinical medication data lives in the **`service_users`** schema (types, routes, categories, frequencies, administration rounds, medications, packs, schedules, administration events, medication-specific allergies, support profile, reviews, and placeholder stock movements).

- **Regular vs PRN**: `MedicationKind.REGULAR` supports scheduled rounds; `PRN` records administrations with mandatory free-text reason or notes.
- **Medications** (Swagger: **Service User Medications** tag): list/create/update/delete; `POST .../medications/:medicationId/restore` for archived rows; `GET .../medications/activity-log` for per–service-user medication audit trail; status end reason (`MANUAL` vs `END_DATE`) on end workflow.
- **Charts** (Swagger: **Medication Charts** tag):
  - `GET /service-users/:id/medication-chart/regular` — MAR grid. Query: `month=YYYY-MM` **or** `dateFrom` + `dateTo` (≤93 days); optional `medicationIds` (comma-separated UUIDs). Response includes `medications[]` (rows × `days[]` cells), `legend`, `summary` (today only: due / recorded / missed N+R / review), and `monthStats` (**MAR completion to date**):
    - `completionThroughDate`, `scheduledToDate`, `documented`, `stillOpen`, `given`, `notGiven`, `marCompletionPercent`, `prnAdministered`
    - Deprecated aliases: `due` → `stillOpen`, `recorded` → `documented`, `compliancePercent` → `marCompletionPercent`
    - Completion window: `periodStart` → `min(today UTC, periodEnd)` (past months use the full period; future days in the current month are excluded)
    - `marCompletionPercent` = `documented ÷ (documented + stillOpen)` — documentation completeness (CQC/NICE), not % physically given
  - `GET /service-users/:id/medication-chart/regular/export` — HTML (default), `format=pdf|csv|xlsx`, or multi-month Excel via `months=`. `preview=true` skips export audit (UI preview).
  - `GET /service-users/:id/medication-chart/prn?dateFrom=&dateTo=` — PRN events grouped by medication.
- **Reports** (tenant-wide or per SU): `GET /medication-reports/administered|stock-levels|late-administrations|audit` with `dateFrom` / `dateTo` and optional `serviceUserId` or `allServiceUsers=true` (requires appropriate permissions).
- **Late administrations**: compared with `scheduledDateTime`; threshold minutes from env `MEDICATION_LATE_THRESHOLD_MINUTES` (default **30**).
- **Permissions** (seed): `service_users.medications.*` keys — Super Admin all; Admin/Manager/Care Coordinator clinical coordination set; **Senior Carer/Nurse** read + administer + write; **Carer/Domestic** read charts + **administer**; delete/reviews delete/reports export tightened to Admin/Manager.
- **Audit / data access**: creates/updates/deletes, administrations, chart views, and report generation emit `AuditLog` (`AuditModule.MEDICATION`) and `DataAccessLog` (VIEW) per product rules. Controlled-drug and missed/refused paths call optional **in-app notification** hooks (`MEDICATION_ALERT`) when `NotificationsModule` is available (recipient list is placeholder until routing is defined).
- **Seed**: medication lookup tables + optional **Blister Pack 2025** demo on the first service user (idempotent).

### Swagger

All medication routes are documented at **`http://localhost:3000/api/docs`** (Bearer auth). **14 tags**, **59 routes** — charts, administration, supply, medications, schedules, lookups, status codes, time slots, reports, reviews, allergies, packs, support profile.

Every route includes standard error docs via `ApiMedicationStandardResponses()`: **400** / **404** (`ApiErrorResponseDto` with examples), **401**, **403**. Critical routes include **golden wire examples** (`{ success, message, data, meta }`) via `ApiEnvelopeOkResponse` — see `src/common/swagger/medication-api.examples.ts`.

```bash
pnpm run openapi:export   # writes openapi/openapi.json (full API, 340+ paths)
pnpm test -- --testPathPatterns=medication-api.examples|medication-openapi.contract
```

Product spec: `canvases/medication.md` **§16.7**.

**Future (sw-9):** CI on each PR — run `pnpm run openapi:export`, then `git diff --exit-code openapi/openapi.json` so the committed spec cannot drift from controllers. Tracked in `canvases/enterprise-design-plan.canvas.tsx` (Track D) and `canvases/medication.md` §34.

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
pnpm exec prisma db seed
```

## Service User Flash Message

A **flash message** is a short temporary alert shown on a service user profile until a selected **display-until** date. It is **not** a care note, care plan, or clinical record — it is an urgent visible note for staff (e.g. “Call daughter before visit”, “Do not use back entrance”, “Service user at hospital”).

| Topic | Behaviour |
|--------|-----------|
| **Current message** | At most one **current** non-expired `ACTIVE` row per service user (`isCurrent=true`). |
| **Upsert** | `PUT /service-users/:id/flash-message` archives the previous current row (`ARCHIVED`, `isCurrent=false`) and creates a new `ACTIVE` row. |
| **Clear** | `DELETE` or `PATCH .../clear` sets `CLEARED`, `isCurrent=false`, `clearedAt` / `clearedById`, optional `clearReason`. History rows are retained (no hard delete). |
| **Expiry** | After the inclusive display-until calendar day (UTC), reads mark the row `EXPIRED` and return no current message. A daily cron is TODO when `@nestjs/schedule` is added. |
| **Validation** | `message` required, max **150** characters (trimmed). `displayUntil` required as `YYYY-MM-DD`, today or future. |
| **History** | `GET /service-users/:id/flash-message/history` — paginated, filter by `status`, `dateFrom`, `dateTo`, sort. |

### API

| Method | Path | Permission |
|--------|------|------------|
| GET | `/service-users/:id/flash-message` | `service_users.flash_message.read` (or `service_users.read`) |
| PUT | `/service-users/:id/flash-message` | `service_users.flash_message.update` (or `service_users.update`) |
| DELETE | `/service-users/:id/flash-message` | `service_users.flash_message.delete` |
| PATCH | `/service-users/:id/flash-message/clear` | `service_users.flash_message.delete` |
| GET | `/service-users/:id/flash-message/history` | `service_users.flash_message.history.read` |

### Permissions (seed)

- **Super Admin**: all flash message keys.
- **Admin / Manager / Care Coordinator**: read + update; delete/clear for Admin, Manager, Care Coordinator.
- **Senior Carer/Nurse**: read + update.
- **History read**: Admin, Manager, **Privacy Officer**.

### Audit and data access

- **Audit** (`AuditModule.FLASH_MESSAGE`): viewed, created, updated, archived, cleared, deleted, expired, history viewed.
- **Data access** (`AuditModule.SERVICE_USER`, `ServiceUserFlashMessage`, `VIEW`): current message and history list.

### Notifications

Optional in-app notifications (`SERVICE_USER_UPDATED`) to key worker, named nurse (when linked to a user account), and Admin/Manager users — failures are logged and do not block the API.

### Swagger

Tag: **Service User Flash Messages**. Log in via `POST /auth/login`, authorize Bearer token, then call the endpoints above.

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

## Schedule Management — Phase 1 (Foundation)

PostgreSQL schema **`scheduling`** holds schedule **areas/zones**, **batches** (one active batch per calendar date), and **per-area build status** for the operational rota UI. This is separate from the **Service User Calendar** (`service_users` schema), which tracks appointments and reminders for individual service users.

| Concern | Schedule Management | Service User Calendar |
|--------|---------------------|------------------------|
| Purpose | Build daily/area rota batches | SU appointments, reviews, birthdays |
| Schema | `scheduling` | `service_users` |
| Phase 1 scope | Batch + area status only | Events + views (existing) |

### Phase 1 APIs

| Method | Path | Permission |
|--------|------|------------|
| GET | `/schedule-areas` | `schedule_areas.read` |
| GET | `/schedule-areas/:id` | `schedule_areas.read` |
| POST | `/schedule-areas` | `schedule_areas.create` |
| PATCH | `/schedule-areas/:id` | `schedule_areas.update` |
| DELETE | `/schedule-areas/:id` | `schedule_areas.delete` |
| GET | `/schedules` | `schedules.read` |
| GET | `/schedules/previous` | `schedules.read` (+ data access log) |
| GET | `/schedules/status?date=YYYY-MM-DD` | `schedules.status.read` (+ audit + data access) |
| GET | `/schedules/:id` | `schedules.read` |
| POST | `/schedules/build` | `schedules.build` |
| PATCH | `/schedules/:id/status` | `schedules.update` |
| DELETE | `/schedules/:id` | `schedules.delete` |

### Permissions (seed)

| Permission | Super Admin | Admin | Manager / Care Coordinator / Staff Allocation |
|------------|-------------|-------|--------------------------------------------------|
| `schedule_areas.*` | ✓ | ✓ | — |
| `schedules.read`, `schedules.build`, `schedules.status.read` | ✓ | ✓ | ✓ |
| `schedules.create`, `schedules.update`, `schedules.delete` | ✓ | ✓ | — |

### Schedule status behaviour

`GET /schedules/status?date=2026-05-05` returns the date, optional batch summary, and **all active schedule areas**. If no batch exists for that date, every area is returned with status **`NOT_BUILT`**. If a batch exists, stored `ScheduleAreaStatus` rows are merged in.

### Build schedule

`POST /schedules/build` creates or updates the **ScheduleBatch** for the date and upserts **ScheduleAreaStatus** rows for selected areas (or all active areas when `areaIds` is omitted). Selected areas are marked **`BUILT`**. Batch status becomes **`BUILT`** when every active area has a built status; otherwise **`BUILDING`**.

**Optional `jobs` array** — each item creates a **ScheduledJob** (and default or explicit **ScheduledVisit** rows) linked to the batch. Example:

```json
{
  "scheduleDate": "2026-05-19",
  "buildSource": "WITHOUT_TEMPLATE",
  "areaIds": ["…"],
  "jobs": [
    {
      "serviceUserId": "…",
      "scheduleAreaId": "…",
      "jobName": "Morning call",
      "scheduledStartDateTime": "2026-05-19T08:00:00.000Z",
      "scheduledEndDateTime": "2026-05-19T09:00:00.000Z",
      "visits": [{ "visitName": "Morning call", "scheduledStartDateTime": "2026-05-19T08:00:00.000Z" }]
    }
  ]
}
```

Without `jobs`, behaviour matches Phase 1 (batch + area status only).

## Schedule Management — Phase 2 (Jobs, Visits, Runs)

| Method | Path | Permission |
|--------|------|------------|
| GET/POST/PATCH/DELETE | `/scheduled-jobs`, `/scheduled-jobs/:id` | `scheduled_jobs.*` |
| PATCH | `/scheduled-jobs/:id/status` | `scheduled_jobs.status.update` |
| GET/POST/PATCH/DELETE | `/scheduled-visits`, `/scheduled-visits/:id` | `scheduled_visits.*` |
| PATCH | `/scheduled-visits/:id/status` | `scheduled_visits.status.update` |
| GET/POST/PATCH/DELETE | `/schedule-runs`, `/schedule-runs/:id` | `schedule_runs.*` |
| GET/POST/PATCH/DELETE | `/visit-actions`, `/visit-actions/:id` | `visit_actions.*` |

**Data model:** `ScheduleBatch` → `ScheduleRun` (optional grouping) → `ScheduledJob` → `ScheduledVisit` + `VisitAction`. Jobs reference **ServiceUser**; visit actions may record **Employee** as `completedBy`. Updating visit status can roll up simple job status (e.g. all visits completed → job `COMPLETED`).

**Permissions:** Super Admin all; Admin full scheduling set; Manager / Care Coordinator / Staff Allocation get read/create/update/status on jobs, visits, runs, and visit actions (not delete on jobs/visits for operators — delete reserved Admin/Super Admin via seed).

```bash
pnpm exec prisma migrate deploy --name schedule_jobs_visits
pnpm exec prisma generate
pnpm exec prisma db seed
```

## Schedule Management — Phase 3 (Allocation)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/job-allocations` | `job_allocations.read` |
| GET | `/job-allocations/:id` | `job_allocations.read` |
| GET | `/scheduled-jobs/:id/allocations` | `job_allocations.read` |
| POST | `/scheduled-jobs/:id/allocate` | `job_allocations.create` |
| POST | `/scheduled-jobs/:id/unallocate` | `job_allocations.delete` |
| POST | `/scheduled-jobs/:id/allocations/:allocationId/confirm` | `job_allocations.confirm` |

**Allocate body:** `{ employeeId, scheduledVisitId?, force?, notes? }`. Validation runs modular checks (availability, time conflict, weekly capacity, dom-care/live-in blocked & preferred carers, role metadata, compliance). If warnings exist and `force` is false, blocking warnings return **400**; non-blocking warnings create **`PENDING_CONFIRMATION`** with `requiresConfirmation: true`. Confirm via the confirm endpoint. When active allocations ≥ `requiredCarers`, job status becomes **`ALLOCATED`**.

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
```

## Schedule Management — Phase 4 (Timelines & Filters)

Read-only timeline APIs (audit + data access logged). Date ranges: day, week (Monday UTC), month (`YYYY-MM`). Capacity report limited to **31 days**.

| Method | Path | Permission |
|--------|------|------------|
| GET | `/schedule-timelines/jobs/day-runs` | `schedule_timelines.read` |
| GET | `/schedule-timelines/jobs/day-timeline` | `schedule_timelines.read` |
| GET | `/schedule-timelines/employees/day-runs` | `schedule_timelines.read` |
| GET | `/schedule-timelines/job-carer/day-starts` | `schedule_timelines.read` |
| GET | `/schedule-timelines/employees/day` | `schedule_timelines.read` |
| GET | `/schedule-timelines/employees/week?weekStart=` | `schedule_timelines.read` |
| GET | `/schedule-timelines/employees/month?month=YYYY-MM` | `schedule_timelines.read` |
| GET | `/schedule-timelines/service-users/day` | `schedule_timelines.read` |
| GET | `/schedule-timelines/service-users/week` | `schedule_timelines.read` |
| GET | `/schedule-timelines/employee-capacity` | `schedule_timelines.read` or `employee_capacity.read` |
| POST | `/schedule-filters/jobs` | `schedule_filters.jobs` |
| POST | `/schedule-filters/carers` | `schedule_filters.carers` |
| POST | `/schedule-filters/customers` | `schedule_filters.customers` |

## Schedule Management — Phase 5 (Housekeeping & Call-off)

### Housekeeping

| Method | Path | Permission |
|--------|------|------------|
| GET | `/scheduled-jobs-housekeeping/jobs-not-started` | `scheduled_jobs_housekeeping.read` |
| GET | `/scheduled-jobs-housekeeping/jobs-needing-attention` | `scheduled_jobs_housekeeping.read` |
| GET | `/scheduled-jobs-housekeeping/day-jobs?date=` | `scheduled_jobs_housekeeping.read` |
| PATCH | `/scheduled-jobs-housekeeping/jobs/:id/complete` | `scheduled_jobs_housekeeping.complete` |
| PATCH | `/scheduled-jobs-housekeeping/jobs/:id/cancel` | `scheduled_jobs_housekeeping.cancel` |

### Call-off visits

| Method | Path | Permission |
|--------|------|------------|
| GET | `/call-off-visits` | `call_off_visits.read` |
| GET | `/call-off-visits/:id` | `call_off_visits.read` |
| POST | `/call-off-visits` | `call_off_visits.create` |
| PATCH | `/call-off-visits/:id` | `call_off_visits.update` |
| DELETE | `/call-off-visits/:id` | `call_off_visits.delete` |
| PATCH | `/call-off-visits/:id/approve` | `call_off_visits.approve` |
| PATCH | `/call-off-visits/:id/reject` | `call_off_visits.reject` |

Call-off requests start as `REQUESTED`. **Approve** sets linked job/visit status to `CALLED_OFF` and notifies allocated carers.

## Schedule Management — Phase 6 (Reports)

JSON report APIs under `/schedule-reports`. Pass `export=true` to log export intent (file generation placeholder). Date range max **93 days** (employee capacity **31 days**).

| Method | Path | Permission |
|--------|------|------------|
| GET | `/schedule-reports/report-types` | `schedule_reports.read` |
| GET | `/schedule-reports/visit-detail` | `schedule_reports.read` |
| GET | `/schedule-reports/daily-carer-allocation` | `schedule_reports.read` |
| GET | `/schedule-reports/call-off-visits` | `schedule_reports.read` |
| GET | `/schedule-reports/employee-capacity` | `schedule_reports.read` |
| GET | `/schedule-reports/service-user-visits` | `schedule_reports.read` |
| GET | `/schedule-reports/service-user-time-analysis` | `schedule_reports.read` |
| GET | `/schedule-reports/scheduled-jobs-status` | `schedule_reports.read` |

### Migrations & seed

```bash
pnpm exec prisma migrate dev --name schedule_foundation
pnpm exec prisma generate
pnpm exec prisma db seed
```

Seeds ten schedule areas (Croydon Transport, Croydon 1–5, Merton, Haringey, Bexley, Greenwich) idempotently by `code`, linking to existing **Location** / **Zone** lookups when names match.

### Swagger

Authorize with a seeded user (e.g. `admin@careadmin.local`), open `/api`, and use tags **Schedules** and **Schedule Areas**.

### Audit & data access

- Audit: `schedule_batch_*`, `schedule_build_requested`, `schedule_status_viewed`, `schedule_area_*`
- Data access (`AuditModule.SCHEDULING`, `VIEW`): previous schedules list, schedule status modal

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

## Care Pathway

Configuration APIs under **`care_pathway`** schema modules: wizard overview, **form selection** (defaults per form type), **care plan text** (templates + `@` preview), **pathway checklists/actions**, and **picture gallery** (standard + uploaded images). Form Builder UI/API is not included in this release.

- Permissions: `care_pathway.read`, `form_selection.*`, `care_plan_text.*`, `pathway_checklists.*`, `pathway_actions.*`, `picture_gallery.*`
- Seed: `prisma/seeds/care-pathway.seed.ts` (run via `pnpm exec prisma db seed`)
- Docs: [docs/API_ENDPOINTS.md](./docs/API_ENDPOINTS.md), [docs/DATABASE_SCHEMA.md](./docs/DATABASE_SCHEMA.md)

CareAdmin UI: **Settings → Care Pathway** (`care_pathway.read`).

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
