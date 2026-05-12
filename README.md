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
- **Masking**: `AuditLogsService` masks known sensitive keys (`password`, `refreshToken`, `pin`, etc.) in JSON payloads before persist.
- **Auth logging**: login success/failure, refresh, logout, password change, forgot/reset placeholders write to `LoginHistory`, `AuditLog`, and/or `SecurityEvent` as appropriate.
- **Employee logging**: CRUD and sub-resources (documents, compliance, reviews, emergency contacts, employment, skills, certifications, non-core activities) emit `AuditLog` rows; sensitive views emit `DataAccessLog` where wired.

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
