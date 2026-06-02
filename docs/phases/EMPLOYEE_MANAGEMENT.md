
# Employee Management — Phase Plan

**Local setup:** [root README](../../../README.md) · **Tracker:** [PHASES.md](../../PHASES.md)

**Status:** **MOSTLY COMPLETED** — core employee lifecycle, compliance engine, temporary inspectors, and staff UI are shipped; advanced reporting and daily compliance cron remain.

---

## At a glance — Done vs pending

### Done (high level)

| Area | What is in place |
|------|-------------------|
| **Backend — core** | Prisma `employees` models; `GET/POST/PATCH/DELETE` employees; `PATCH …/status`; `GET /employees/chart-summary` |
| **Backend — personal** | Personal details CRUD path; **photo upload** `POST …/personal-details/photo`; static **`/uploads/`** |
| **Backend — contacts & patterns** | Emergency contacts CRUD; working patterns CRUD |
| **Backend — profile** | Employment (incl. **RBAC → identity role sync** when personal email matches a `User`), skills, certifications, documents, reviews, non-core activity, holidays, leaving records |
| **Backend — compliance** | Enterprise compliance (types, requirements, employee records, documents, verification history, status calculator, **report GETs**); chart summary excludes `isNoLongerRequired` |
| **Backend — temporary inspector** | Model, migrations, admin CRUD APIs, JWT login/refresh/logout/me, guarded Nest behaviour |
| **Frontend — staff** | Staff list, charts, add/edit navigation; **permission-aware** Add/Edit |
| **Frontend — wizard** | Add/edit tabs; Zod; lookups; create + personal + employment + **photo file**; **emergency contacts inline**; **weekly working pattern** save to API; **UK postcode lookup** (postcodes.io) |
| **Frontend — auth & nav** | Routes gated with `employees.read` / `create` / `update`; sidebar + audit alignment with Nest keys; **Playwright** smoke (`tests/e2e/employee-flow.spec.ts`, optional full path with `E2E_*` env) |
| **Frontend — temp inspector** | Admin page; login tab; narrow inspector session UX |

### Pending (high level)

| Area | What remains |
|------|----------------|
| **Backend — reporting** | Rich **employee reports / analytics** beyond chart summary; dedicated **compliance report** pipelines if product wants more than current report GETs; **RBAC reporting** |
| **Backend — operations** | **`@nestjs/schedule`** (or external cron) calling **`EmployeeComplianceService.runDailyComplianceCheck()`** daily |
| **Frontend — patterns** | **Fortnight ↔ API**: second week of rotas if product needs true 2-week patterns in DB (today: standard Mon–Sun only is persisted; fortnight grid is preview) |

---

## Done — Backend (Prisma `employees` schema)

- [x] Database models: `Employee`, `EmployeePersonalDetail`, `EmployeeEmergencyContact`
- [x] Employee core APIs
  - [x] `GET /employees` (pagination + search + basic filters/sort)
  - [x] `GET /employees/:id`
  - [x] `POST /employees`
  - [x] `PATCH /employees/:id`
  - [x] `DELETE /employees/:id` (soft delete)
  - [x] `PATCH /employees/:id/status`
- [x] **Dashboard chart summary** — `GET /employees/chart-summary` (`employees.read`)
  - Staff totals: employees with non-deleted personal detail; active/inactive via `EmployeeStatus` names (case-insensitive)
  - Compliance: counts from `EmployeeCompliance` expiry vs now + 30 days (aggregated in SQL; excludes `isNoLongerRequired` rows)
  - Skills: top skill types by `EmployeeSkill` counts (raw `GROUP BY` + lookup names)
  - Reviews: reviewed vs outstanding from `EmployeeReview.status` heuristics
- [x] Personal details APIs
  - [x] `GET /employees/:id/personal-details`
  - [x] `PATCH /employees/:id/personal-details`
  - [x] **`POST /employees/:id/personal-details/photo`** — multipart image (JPEG/PNG/WebP/GIF, 2 MB cap); writes under `uploads/employees/photos/` and sets `photoUrl` to `/uploads/...` (`employees.update`)
- [x] **Static uploads** — Nest serves `uploads/` at `/uploads/` so browser `img`/`src` can load stored photos
- [x] Emergency contacts APIs
  - [x] `GET /employees/:id/emergency-contacts`
  - [x] `POST /employees/:id/emergency-contacts`
  - [x] `PATCH /employees/:id/emergency-contacts/:contactId`
  - [x] `DELETE /employees/:id/emergency-contacts/:contactId`

## Done — Backend (profile sections)

- [x] Employment details (`EmployeeEmployment`)
- [x] **RBAC level → identity permissions** — after `PATCH .../employment`, if the employee’s **personal email** matches an active **User** (case-insensitive), that user’s **managed** identity roles are replaced from employment **`RBACLevel`** (see `src/employee-employment/rbac-employment-sync.*`). Users with **Super Admin** are never modified. Cleared RBAC removes only the managed worker/manager roles (see doc section below).
- [x] Skills (`EmployeeSkill`)
- [x] Work certifications (`EmployeeWorkCertification`)
- [x] Documents (`EmployeeDocument`)
- [x] Staff reviews (`EmployeeReview`)
- [x] Non-core activities (`EmployeeNonCoreActivity`)
- [x] Working patterns (`EmployeeWorkingPattern`)
- [x] **Enterprise employment compliance** — master types, scoped requirements, per-employee records, evidence documents, verification history, and report APIs (see below).

### Enterprise compliance (backend)

| Layer | Prisma / API |
|--------|----------------|
| **ComplianceType** | `lookups.ComplianceType` — `code`, `category`, `hasExpiry`, `requiresDocument`, `requiresVerification`, CRUD under `/compliance-types` (`compliance_types.*`). |
| **ComplianceRequirement** | `employees.ComplianceRequirement` — optional `roleId`, `workAreaId`, `jobTitleId`, `contractTypeId`, `locationId`, `zoneId` (v1: requirements with `zoneId` do not match employees until employment has a zone). CRUD `/compliance-requirements`. |
| **EmployeeCompliance** | `employees.EmployeeCompliance` — workflow fields (`submittedAt`, `verifiedAt`, `rejectedAt`, `isNoLongerRequired`, …), enum `status`, optional `requirementId`. `/employees/:id/compliance` (`employees.compliance.*`). |
| **EmployeeComplianceDocument** | Evidence files via `POST …/documents` (multer → `uploads/employees/compliance/`). |
| **ComplianceVerification** | Immutable action log per change. |
| **ComplianceReminder** | Table ready for scheduled reminders (**scheduler not wired** — see Pending). |

**Status calculation:** `src/employee-compliance/compliance-status.calculator.ts` — UTC day boundaries; `MISSING` when documents are required but absent; `REQUIRED` when a row exists but not yet complete; `PENDING_REVIEW` after submit when verification is required; expiry checks before `VALID`. `GET` list/detail returns computed `status` plus `persistedStatus`.

**Reports:** `GET /employee-compliance/summary|missing|expired|expiring|pending-review|report|detail-report` (`employees.compliance.reports.read`). Query DTO: `employee-compliance-report-query.dto.ts`.

**Dashboard chart:** `GET /employees/chart-summary` excludes compliance rows with `isNoLongerRequired = true` from the compliance aggregate SQL.

- [x] Holidays (`EmployeeHoliday`)
- [x] Leaving records (`EmployeeLeavingRecord`)
- [x] **Temporary inspector logins** — model `employees.TemporaryInspector`; APIs:
  - [x] `GET /temporary-inspectors/service-user-options` — placeholder resident list for the UI (`employees.read`)
  - [x] `GET /temporary-inspectors` — list saved inspectors with derived Active/Expired from `validTo` (`employees.read`)
  - [x] `POST /temporary-inspectors` — create (hashed password; optional `serviceUserKeys[]`; empty = all service users; `employees.update`)
  - [x] `DELETE /temporary-inspectors/:id` — soft delete (`employees.update`)
  - [x] Migration `20260512060412_temporary_inspector` — apply with `npx prisma migrate dev` (or deploy) after pull
  - [x] Migration `20260512100000_temporary_inspector_refresh_token` — adds `refreshTokenHash` for inspector refresh tokens
  - [x] Migration `20260512120000_temporary_inspector_service_user_keys_array` — `serviceUserKey` → `serviceUserKeys` (`TEXT[]`, empty = all service users)
- [x] **Temporary inspector sign-in (JWT)** — no email; uses **username + password**:
  - [x] `POST /auth/login/temporary-inspector` — public; validates active window (`validFrom`…`validTo`), password, issues access + refresh JWTs with payload `typ: 'ti'` (access and refresh)
  - [x] `POST /auth/refresh` — supports refresh tokens issued to inspectors (rotates `TemporaryInspector.refreshTokenHash`)
  - [x] `POST /auth/logout` — clears inspector refresh hash when `accountKind === 'temporary_inspector'`
  - [x] `GET /auth/me` — returns `RequestUser` including `accountKind`, synthetic `email` (`ti+{username}@inspector.care.local`), `roles` `["Temporary Inspector"]`, `permissions` `["temporary_inspector.session"]`, plus `firstName` / `lastName` / `username`
  - [x] `POST /auth/change-password` — **403** for temporary inspector accounts (no password-change flow in-app)
  - [x] JWT strategy — if access token payload has `typ: 'ti'`, loads inspector context (re-checks validity window on each request; expired window ⇒ 401)
  - [x] Seed permission `temporary_inspector.session` (for DB consistency; inspector JWT permissions are also issued from code)

## Pending — Backend

- [ ] **Scheduled compliance job** — install `@nestjs/schedule` (or use an external scheduler) and invoke **`EmployeeComplianceService.runDailyComplianceCheck()`** on a daily cadence.
- [ ] **Employee reports & analytics** — fuller implementations beyond chart summary + existing compliance report GETs (exports, scheduled reports, cross-module dashboards, etc., as product defines).
- [ ] **Compliance reporting productisation** — if needed: packaged “summary + detail” report flows distinct from current HTTP report endpoints.
- [ ] **RBAC reporting** — audit / exports for identity role assignments vs employment RBAC (product-defined).

---

## RBAC level and identity permissions (employment sync)

**What it does:** Saving employment (`PATCH /employees/:id/employment`) runs an **automatic sync** so a **login user** tied to that employee can receive **identity** `Role` assignments aligned with the employment **RBAC level** lookup (`lookups.RBACLevel`).

**How the user is linked:** There is no `User` ↔ `Employee` foreign key. Sync uses **email equality**: `EmployeePersonalDetail.email` must match `User.email` (case-insensitive). If there is no email or no matching user, sync is skipped (no error).

**Who is never touched:** If the matched user has the **Super Admin** identity role, sync **does nothing** (avoids changing highly privileged accounts).

**What gets replaced:** Only **managed** identity roles listed in `IDENTITY_ROLES_MANAGED_BY_EMPLOYMENT_RBAC` (`careadmin-backend/src/employee-employment/rbac-employment-sync.config.ts`) are removed before assigning the mapped role. Other roles (e.g. **Care Coordinator**, **HR**) are left unchanged.

**Mapping:** `RBACLevel.name` → `Role.name` is defined in `RBAC_LEVEL_TO_IDENTITY_ROLE_NAME` in the same config file. If an RBAC level name is not in the map, sync tries an **exact** identity `Role.name` match. If no role exists, a server warning is logged and no role is assigned (managed roles were still cleared).

**Clearing RBAC:** If `rbacLevelId` is cleared (null), managed roles are **removed** and no replacement role is assigned — ensure the user still has any **non-managed** roles they need, or set RBAC again.

**Code:** `RbacEmploymentSyncService` (`rbac-employment-sync.service.ts`) is invoked from `EmployeeEmploymentService.update` inside the same Prisma transaction as the employment upsert.

**Operational warning:** Do not reuse the same **personal email** for **IT administrator accounts** as for **employee records** unless you intend RBAC sync to change that user’s roles.

---

## Frontend — Employee area (`care-admin`)

### Done — Staff list & dashboard (`EmployeePage`)

- [x] Route `/employee/staff-list` (and sibling tab routes) with layout/title
- [x] Staff table backed by **`GET /employees`** when `VITE_API_BASE_URL` is set and a real JWT is present (pagination meta; status filter via lookups)
- [x] **Dashboard tiles** load **`GET /employees/chart-summary`**: Staff Status (bars), Compliance / Skills / Reviews (Recharts pies), with loading and empty/error states
- [x] Navigate to **Add** and **Edit** from the list (edit uses `GET /employees/:id` to bootstrap); **Add** / **Edit** gated by **`employees.create`** / **`employees.update`**

### Done — Add / Edit Employee (`/employee/add`, `/employee/$employeeId/edit`)

- [x] Edit route reuses add wizard: `EditEmployeePage` → `AddEmployeePage` with `editEmployeeId`
- [x] Tabbed UI: Personal Details, Employment, Working Pattern (preview + persisted week)
- [x] Zod validation for personal step (aligned with `CreateEmployeeDto` + personal PATCH fields); `photoUrl` accepts `https?://` or **`/uploads/...`** from upload
- [x] Zod validation for employment step (required work area, role, location; numeric hours/rates)
- [x] `react-hook-form` with field-level errors and hints
- [x] Tooltips (Radix) on key fields via help icon
- [x] Lookups from **`GET /lookups/employee`** when API URL + accepted token
- [x] Create flow: **`POST /employees`** then **`PATCH .../personal-details`**
- [x] Employment flow: **`PATCH .../employment`** after employee exists
- [x] **Photo: file input** — **`POST .../personal-details/photo`** when an employee id exists; on add, first save then flush queued file; preview + remove (clears via PATCH when saved)
- [x] **`resolveMediaUrl()`** — staff list avatars prefix API base for relative `/uploads/...` paths
- [x] Banners for success / API errors; link back to staff list
- [x] `.env.example` documents `VITE_API_BASE_URL`
- [x] **Emergency contacts inline** on Personal tab — `EmployeeEmergencyContactsEditor` (`GET`/`POST`/`PATCH`/`DELETE` `/employees/:id/emergency-contacts`) after an employee id exists
- [x] **Working pattern persistence** — `EmployeeWeeklyPatternEditor`: standard Mon–Sun week saved via `GET`/`POST`/`DELETE` `/employees/:id/working-patterns` (fortnight grid remains a local planning preview)
- [x] **UK postcode lookup** — postcodes.io from `lookupUkPostcode()`; fills town / default country when empty (search icon by Postcode)
- [x] **Playwright E2E** — `tests/e2e/employee-flow.spec.ts` (login smoke always; add-employee path when `E2E_API_BASE_URL`, `E2E_LOGIN_EMAIL`, `E2E_LOGIN_PASSWORD` are set). `playwright.config.ts` passes `VITE_API_BASE_URL` from `E2E_API_BASE_URL` to the dev server for those runs
- [x] **Route guards & nav** — TanStack routes use `employees.read` / `employees.create` / `employees.update`; sidebar employee links carry matching `permission`; `Permission` + `ROLE_PERMISSIONS` include Nest keys (`audit_logs.read`, etc.); audit menu accepts `audit.read` or `audit_logs.read`

### Done — Temporary Inspector (`/employee/temp-inspector`)

- [x] **`TempInspectorPage`** loads **`GET /temporary-inspectors`** and **`GET /temporary-inspectors/service-user-options`** when API URL + JWT are set; **Save** → **`POST /temporary-inspectors`**; row delete → **`DELETE /temporary-inspectors/:id`**
- [x] **Resident scope** — `MultiSelect`: pick **one or more** placeholder residents, or leave empty for **all service users**; stored as `serviceUserKeys` on the server; **tooltip** + “How this works” describe scope behaviour
- [x] **Valid from / to** — `datetime-local` inputs; status in table derived server-side from `validTo` vs now
- [x] **Inspector sign-in UX** — on **`/auth/login`**, API mode shows tabs **Staff (email)** vs **Temporary inspector** (username + password → **`POST /auth/login/temporary-inspector`**). Admin page shows a short “How they sign in” note with link to Sign in.
- [x] **Inspector session in SPA** — role `temporary_inspector`, permission `temporary_inspector.session`; **sidebar** shows only **Home** and **Service Users** (All + Calendar). **Routes:** scheduling requires `schedule.read`; accidents require `incidents.read`; **Add Service User** requires `employees.read` (inspectors are redirected to `/` if they hit a guarded URL directly).

### Pending — Frontend

- [ ] **Fortnight ↔ API** — sync the second week of the UI grid to persisted `EmployeeWorkingPattern` rows (or a dedicated “week 2” model) if the product requires true **2-week rotas** in the database.

---

## Notes

- **Local full stack:** set `VITE_API_BASE_URL` (e.g. `http://localhost:3000`), run CareAdmin backend, sign in with a user that has `employees.read`, `employees.create`, `employees.update`, and `lookups.read`, then use Staff List, charts, Add Employee, and Edit.
- **Auth:** With `VITE_API_BASE_URL` set, staff use **`POST /auth/login`**; temporary inspectors use **`POST /auth/login/temporary-inspector`** (Sign in → **Temporary inspector** tab). Without API URL, demo users produce mock tokens that **will not** authenticate the API (see `care-admin/src/auth/README.md`).
- **Audit:** backend audit logging covers employee create/update and related modules; frontend should not log sensitive values.
- **Employment RBAC → login roles:** When employment is saved, a user whose **email** matches the employee’s **personal email** may have **managed** identity roles updated from the employment **RBAC level** (Super Admin users excluded). Details: **RBAC level and identity permissions** section above.
- **Temporary inspectors:** Apply migrations for `TemporaryInspector` (including **`refreshTokenHash`** and **`serviceUserKeys`** text array). Admin UI needs **`employees.read`** / **`employees.update`**. Inspectors sign in with **username + password** only inside **Valid from–to**; JWT carries `temporary_inspector.session` (narrow UI access). **`serviceUserKeys`** (empty = all) is stored for future service-user APIs (picker is still **placeholder** in `service-user-options.seed.ts`). Run **`npx prisma db seed`** (or equivalent) if you need the `temporary_inspector.session` permission row in an existing DB.
