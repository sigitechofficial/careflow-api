# Service Care Management — Phase Plan

Status: Phase 1 (Service User core) **implemented** in backend; care delivery features **pending**.

## Goal

Enable carers and coordinators to manage **Service Users** (people receiving care) with RBAC, audit trails, and structured profile data—then extend to observations, medication, care plans, and reporting.

## Dependencies

- Employee module (key worker / named nurse assignments reference `Employee`)
- Auth + RBAC permissions
- Location lookups (`Location`) for assignment and filtering
- `AuditLogsModule` + `DataAccessLog` for sensitive profile access

---

## Done — Phase 1: Service User Core (backend)

- [x] Prisma schema `service_users` with `ServiceUser`, `ServiceUserContact`, `ServiceUserAddress`, `ServiceUserReference`, `ServiceUserAssignment`, `ServiceUserPhoto`
- [x] Domain lookups: `ServiceUserStatus`, `ServiceUserTitle`, `ServiceUserGender`, `ServiceUserMaritalStatus`, `ServiceUserCareType`, `ServiceUserFundingType`, `ServiceUserRiskLevel`, `RelationshipType`
- [x] APIs: list/detail/create/update/soft-delete/status; nested contacts, address, assignments; profile photo upload/delete; lookup read endpoints
- [x] Search/filter/pagination/sort on list
- [x] Permissions + seed (Super Admin all; Admin / Manager / Care Coordinator subset — see `prisma/seed.ts`)
- [x] Audit logs for mutations + profile view; **data access log** on `GET /service-users/:id`
- [x] Mask `keySafeNumber` in audit payloads
- [x] Swagger tags and DTOs
- [x] Seed lookup rows
- [x] E2E tests: `test/service-users.e2e-spec.ts`

---

## Pending — Service User extended profile

- [ ] About Me
- [ ] Life History
- [ ] Photos gallery (beyond single profile image)
- [ ] Calendar
- [ ] Hospital / absence

## Pending — Care plans and risk

- [ ] Care plans, risk sections, safety/contingency, consent, review/history

## Pending — Observations

- [ ] Types (weight, blood sugar, BP, temperature, SpO2, pulse, fluids, falls, bowel, meals, NEWS2, reports)

## Done — Medication (MAR foundation, backend)

- [x] Prisma models: lookups (type, route, category, frequency, round, not-given reason), `MedicationPack` / `MedicationPackItem`, `ServiceUserMedication`, `MedicationSchedule`, `MedicationAdministrationEvent`, `MedicationAllergy` (medication module), `MedicationSupportProfile`, `MedicationReview`, `MedicationStockRecord`
- [x] REST APIs under `service-users/:id/...` and `medication-lookups`, `medication-reports`
- [x] RBAC keys `service_users.medications.*` + seed role bundles
- [x] Audit + data access logging for sensitive reads and mutations
- [x] Optional `MEDICATION_ALERT` notification hook (recipient list placeholder)

## Pending — Medication (advanced)

- [ ] MAR PDF/export, pharmacy integration, stock par levels, automated review reminders

## Pending — Visits

- [ ] Visits list, add/edit, frequency, checklist, medications, call-offs

## Pending — Reports

- [ ] Care report, observation report, care plan report, housepack, service user details export

## Pending — Cross-cutting (Service Care)

- [ ] Care observations module (create/list/detail)
- [ ] Care actions module (create/complete/list)
- [ ] Medication administration records (create/administer/list)
- [ ] Care notes module (create/update/list)
- [ ] Employee/carer lookup endpoints tuned for Service Care flows
- [ ] Additional RBAC keys for clinical write paths as modules ship
