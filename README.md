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

### Permissions (seed)

`service_users.read|create|update|delete|status.update`, `service_users.contacts.*`, `service_users.address.read|update`, `service_users.assignments.read|update`, `service_users.photos.upload|delete`, `service_users.lookups.read`. **Super Admin** receives all keys automatically. **Admin**, **Manager**, and **Care Coordinator** receive read/create/update for core and sub-resources plus photo upload and lookups read (not delete/status update/photo delete by default — see `prisma/seed.ts`).

### File uploads

Photos are stored under `{UPLOAD_BASE_PATH}/service-users/photos` (default `uploads/...`). Static hosting uses `UPLOAD_BASE_PATH` in `main.ts`. Max size: `MAX_UPLOAD_FILE_SIZE_MB` or `UPLOAD_MAX_FILE_SIZE_BYTES` (see `src/config/app.config.ts`).

### Seed lookups

Statuses, titles, genders, marital statuses, care types, funding types, risk levels, and relationship types are upserted in `prisma/seed.ts`.

### Deferred (later phases)

Care plans, observations, medication, visits, reports, hospital/absence, calendar, flash messages, body map, initial assessment, and gallery-style photo management beyond a single profile image.

## Employee Compliance (enterprise)

Compliance is **not** hard-coded on the `Employee` model. The chain is: **ComplianceType** (master, in `lookups`) → **ComplianceRequirement** (who must hold what, scoped by role/work area/job title/contract/location; `zoneId` reserved until employment has zone data) → **EmployeeCompliance** (per-employee record with workflow and persisted `EmployeeComplianceStatus`) → **EmployeeComplianceDocument** (evidence files under `uploads/employees/compliance/`) → **ComplianceVerification** (audit trail of actions).

- **Status rules:** Effective status is computed with UTC calendar-day boundaries (see `compliance-status.calculator.ts`); list APIs return the computed value as `status` and expose `persistedStatus` for debugging. `runDailyComplianceCheck()` batch-recomputes stored `status` (call from a future `@nestjs/schedule` cron — not wired yet; see `EmployeeComplianceService`).
- **Permissions:** `compliance_types.*`, `compliance_requirements.*`, `employees.compliance.*` (including `create`, `delete`, `verify`, `reject`, `documents.*`, `reports.read` / `reports.export`). Seed grants read/report keys to Admin, Manager, HR, and Privacy Officer; Super Admin gets all.
- **Migrations:** `pnpm exec prisma migrate deploy` (or `migrate dev`) after pull; then `pnpm exec prisma db seed` for types/requirements.
- **Key routes:** `GET/POST/PATCH/DELETE /compliance-types`, `GET/POST/PATCH/DELETE /compliance-requirements`, `GET/POST/PATCH/DELETE /employees/:id/compliance`, document routes under `.../compliance/:complianceId/documents`, reports under `GET /employee-compliance/summary|missing|expired|expiring|pending-review|report|detail-report`.
- **Chart summary:** `GET /employees/chart-summary` compliance SQL excludes rows with `isNoLongerRequired` so the dashboard matches the compliance module.

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
