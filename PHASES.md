# Backend Development Phases

Detailed module checklists:
- `docs/phases/EMPLOYEE_MANAGEMENT.md`
- `docs/phases/SERVICE_CARE_MANAGEMENT.md`
- `docs/phases/SCHEDULING_MANAGEMENT.md`

## Phase 0 — Project Setup
Status: IN PROGRESS
- [x] Create NestJS project
- [x] Install dependencies (pnpm)
- [ ] Setup PostgreSQL database locally
- [x] Add Prisma
- [x] Connect Prisma with PostgreSQL (env + schema)
- [x] Add environment variables (`.env.example`)
- [x] Add validation pipe (global)
- [x] Add exception filter (global)
- [x] Add response interceptor (global)
- [x] Add Swagger
- [x] Add seed setup (`prisma/seed.ts`)

## Phase 1 — Auth, Users, Roles, Permissions
Status: IN PROGRESS
- [x] User model
- [x] Role model
- [x] Permission model
- [x] RolePermission model
- [x] Login API
- [x] Refresh token API
- [x] Forgot password placeholder
- [x] Reset password placeholder
- [x] Change password API
- [x] JWT strategy + guard
- [x] Permission guard + `@Permissions()` decorator
- [x] Seed default roles and permissions + Super Admin user

## Phase 2 — Employee Management (Core + Profile)
Status: IN PROGRESS
- [x] Employee model
- [x] Personal details (GET/PATCH)
- [x] Emergency contacts (GET/POST/PATCH/DELETE)
- [x] Employee list API (pagination + search + basic filters/sort)
- [x] Employee detail API
- [x] Add employee API
- [x] Edit employee API
- [x] Soft delete employee API
- [x] Active/inactive API (employee `isActive`)
- [x] Status update API (`PATCH /employees/:id/status`)
- [ ] Employment details
- [ ] Skills
- [ ] Work certifications
- [ ] Documents (upload + download + delete)
- [ ] Staff reviews
- [ ] Non-core activities
- [ ] Working pattern
- [x] Employment compliance (enterprise: types, requirements, records, reports)
- [x] Compliance reports (summary / missing / expired / expiring / pending / detail)
- [ ] Holiday records
- [ ] Employee leaving records
- [ ] Employee reports and analytics
- [ ] RBAC reporting

## Phase 3 — Employee Skills, Certifications, Documents
Status: TODO
- [ ] Skills model
- [ ] Work certifications model
- [ ] Employee documents model
- [ ] File upload service
- [ ] Skill APIs
- [ ] Certification APIs
- [ ] Document APIs

## Phase 4 — Employee Reviews and Compliance
Status: TODO
- [ ] Staff reviews model
- [ ] Compliance records
- [ ] Missing compliance logic
- [ ] Expiring compliance logic
- [ ] Review APIs
- [ ] Compliance APIs

## Phase 5 — Non-Core Activity, Working Pattern, Holiday
Status: TODO
- [ ] Non-core activity model
- [ ] Working pattern model
- [ ] Holiday model
- [ ] Date range validation
- [ ] Payroll/on-call flags
- [ ] APIs for each section

## Phase 6 — Employee Reports and Dashboard
Status: TODO
- [ ] Staff status chart API
- [ ] Compliance expiry chart API
- [ ] Skill pie chart API
- [ ] Review pie chart API
- [ ] Staff summary report
- [ ] Staff analysis report
- [ ] Employee leaving report
- [ ] Holiday report
- [ ] Employee detail report

## Phase — Employee Compliance (Enterprise)
Status: IN PROGRESS
- [x] Create ComplianceType model (expanded) + enums
- [x] Create ComplianceRequirement model
- [x] Create EmployeeCompliance model (expanded workflow + status enum)
- [x] Create EmployeeComplianceDocument model
- [x] Create ComplianceVerification model
- [x] Create ComplianceReminder model
- [x] Create Compliance Types APIs
- [x] Create Compliance Requirements APIs
- [x] Create Employee Compliance APIs (CRUD, documents, verify/reject, no-longer-required)
- [x] Add document upload/download/delete
- [x] Add verify/reject workflow
- [x] Add no-longer-required workflow
- [x] Add missing / expired / expiring / pending logic + reports
- [x] Add compliance summary report
- [x] Add compliance detail report
- [x] Add audit logging + data access logging for downloads
- [x] Add seed data + permissions
- [x] Add Swagger tags/DTOs (core)
- [x] Add unit tests (status calculator)
- [ ] Install `@nestjs/schedule` and register daily cron calling `runDailyComplianceCheck()`
- [ ] Integration / e2e tests for compliance APIs

## Phase 7 — Scheduling Dependencies
Status: TODO
- [ ] Employee picker API
- [ ] Carer filter API
- [ ] Employee capacity API
- [ ] Employee availability API
- [ ] Zone-based employee API
- [ ] Bank/agency/employed filter API

## Phase 8 — Service Care Dependencies
Status: TODO
- [ ] Employee/carer lookup for observations
- [ ] Employee/carer lookup for medication records
- [ ] Employee/carer lookup for care notes
- [ ] Employee activity history API

## Phase 9 — Testing and Hardening
Status: TODO
- [ ] Unit tests
- [ ] Integration tests
- [ ] Seed data testing
- [ ] Permission testing
- [ ] Audit log testing
- [ ] API docs review

## Phase 10 — Audit Activity Tracking
Status: IN PROGRESS
- [x] Create AuditLog model
- [x] Create LoginHistory model
- [x] Create SecurityEvent model
- [x] Create DataAccessLog model
- [x] Create ExportLog model
- [x] Create AuditLogsModule
- [x] Create AuditLogsService
- [x] Add audit read APIs
- [x] Add audit filters and pagination
- [x] Add auth audit logging
- [x] Add employee audit logging
- [x] Add document access logging
- [x] Add report view logging
- [x] Add permission `audit_logs.read`
- [x] Add sensitive data masking
- [x] Add Swagger docs (audit controller + DTOs)
- [ ] Wire Service Care / Scheduling sensitive views when modules ship

## Phase — Service User Core
Status: IN PROGRESS
- [x] Create ServiceUser model (+ lookups, contacts, address, references, assignment, photo models)
- [x] Create service user list API
- [x] Create service user detail API
- [x] Create add / edit / soft delete / status APIs
- [x] Create contact APIs
- [x] Create address APIs
- [x] Create assignment APIs
- [x] Create photo upload/delete APIs
- [x] Add search/filter/pagination
- [x] Add RBAC permissions + seed
- [x] Add audit logs + data access logs (detail view)
- [x] Add Swagger docs
- [x] Add seed data for lookups
- [x] Add e2e tests (`test/service-users.e2e-spec.ts`)
- [ ] Broader integration tests / CI hardening

## Phase — Service User Funding
Status: IN PROGRESS
- [x] Create `FundingType` model
- [x] Create `Funder` model
- [x] Create `ServiceUserFunding` model (+ `ServiceUser.currentFundingId`)
- [x] Add funding type APIs
- [x] Add funder APIs
- [x] Add service user funding APIs
- [x] Add primary funding logic
- [x] Add approval workflow
- [x] Add end funding workflow
- [x] Add RBAC permissions
- [x] Add audit logging
- [x] Add seed data
- [x] Add Swagger docs
- [x] Add README documentation
- [ ] Add automated tests (e2e/unit)

## Phase — Service User Live-in Service Profile

Status: IN PROGRESS

Tasks:
- [x] Create LiveInServiceType model
- [x] Create LiveInLevelOfCare model
- [x] Create LiveInScanType model
- [x] Create ServiceUserLiveInProfile model
- [x] Create preferred carers model
- [x] Create blocked carers model
- [x] Create contract document model
- [x] Add live-in lookup APIs
- [x] Add live-in profile APIs
- [x] Add preferred carers APIs
- [x] Add blocked carers APIs
- [x] Add contract document upload/download/delete
- [x] Add validation rules
- [x] Add RBAC permissions
- [x] Add audit logging
- [x] Add data access logging
- [x] Add seed data
- [x] Add Swagger docs
- [x] Add tests (`test/service-user-live-in-profile.e2e-spec.ts`; requires migrated DB)

## Future Phase — Service User Care Profile
- [ ] About Me
- [ ] Life History
- [ ] Photos Gallery
- [ ] Calendar
- [ ] Hospital/Absence

## Future Phase — Service User Care Plans
- [ ] Care plans
- [ ] Risk sections
- [ ] Safety/contingency plans
- [ ] Consent fields
- [ ] Care plan review
- [ ] Care plan history

## Future Phase — Service User Observations
- [ ] Observation types
- [ ] Weight, blood sugar, blood pressure, temperature, oxygen, pulse, fluid monitor, falls, bowel, meals, NEWS2
- [ ] Observation reports

## Future Phase — Service User Medication
- [ ] Medication list
- [ ] Regular medication chart
- [ ] PRN chart
- [ ] Medication event history
- [ ] Medication reports

## Future Phase — Service User Visits
- [ ] Visit list
- [ ] Add/edit visit
- [ ] Visit frequency
- [ ] Visit checklist
- [ ] Visit medications
- [ ] Call-off visits

## Future Phase — Service User Reports
- [ ] Detailed care report
- [ ] Observation report
- [ ] Care plan report
- [ ] Housepack report
- [ ] Service user details report

## Phase — Real-time Notifications with WebSocket and Sound

Status: IN PROGRESS

Tasks:

- [x] Create Notification model
- [x] Create NotificationRecipient model
- [x] Create NotificationPreference model with soundEnabled
- [x] Create NotificationsModule
- [x] Create NotificationsGateway
- [x] Add JWT socket authentication
- [x] Add user-specific socket rooms
- [x] Add notification REST APIs
- [x] Emit notification:new
- [x] Emit unread count updates
- [x] Add frontend socket client
- [x] Add NotificationBell
- [x] Add NotificationDropdown
- [x] Add notification toast
- [x] Add notification sound hook
- [x] Add sound preference toggle
- [x] Add README docs
- [x] Add tests (unit / component)

Future:

- [ ] Redis Socket.IO adapter for multi-server scaling
- [ ] Email notifications
- [ ] SMS notifications
- [ ] BullMQ queues
- [ ] Notification templates

## Phase — Service User Medication

Status: IN PROGRESS

- [x] Create medication lookup models
- [x] Seed medication lookups
- [x] Create ServiceUserMedication model
- [x] Create MedicationPack model
- [x] Create MedicationPackItem model
- [x] Create MedicationAllergy model
- [x] Create MedicationSchedule model
- [x] Create MedicationAdministrationEvent model
- [x] Create MedicationSupportProfile model
- [x] Create MedicationReview model
- [x] Create MedicationStockRecord model
- [x] Add medication list APIs
- [x] Add medication pack APIs
- [x] Add allergy APIs
- [x] Add support profile API
- [x] Add schedule APIs
- [x] Add administration event APIs
- [x] Add regular chart endpoint
- [x] Add PRN chart endpoint
- [x] Add medication report endpoints
- [x] Add RBAC permissions
- [x] Add audit logging
- [x] Add data access logging
- [x] Add notification hooks
- [x] Add Swagger docs
- [ ] Add broader e2e tests

Future (medication):

- [ ] Advanced stock control
- [ ] MAR export
- [ ] Pharmacy integration
- [ ] Medication review reminders
- [ ] Advanced alerts

## Phase — Service User Calendar

Status: IN PROGRESS

- [x] Create CalendarEventType model
- [x] Create ServiceUserCalendarEvent model
- [x] Seed calendar event types
- [x] Add calendar event type APIs
- [x] Add service user calendar event APIs
- [x] Add day/week/month calendar view API
- [x] Add global service users calendar API
- [x] Add RBAC permissions
- [x] Add audit logging
- [x] Add data access logging
- [x] Add notification hooks
- [x] Add Swagger docs
- [x] Add frontend Service Users Calendar page
- [x] Add info icon beside page title
- [x] Add hover tooltip explaining page purpose
- [x] Add day/week/month frontend views
- [x] Add calendar event dialog/form
- [x] Add filters
- [ ] Add tests

Future:

- [ ] Recurring event expansion
- [ ] Reminder scheduler
- [ ] Calendar export
- [ ] Read-only Scheduling overlay
- [ ] External calendar sync

## Phase — Initial Assessment Checklist

Status: IN PROGRESS

- [x] Create InitialAssessmentTemplate model
- [x] Create InitialAssessmentSection model
- [x] Create InitialAssessmentQuestion model
- [x] Create InitialAssessmentSubmission model
- [x] Create InitialAssessmentAnswer model
- [x] Seed default 28-section checklist
- [x] Add template APIs
- [x] Add section APIs
- [x] Add question APIs
- [x] Add service user assessment APIs
- [x] Add answer save API
- [x] Add submit workflow
- [x] Add review workflow
- [x] Add risk summary API
- [x] Add care plan trigger API
- [x] Add RBAC permissions
- [x] Add audit logging
- [x] Add data access logging
- [x] Add notification hooks
- [x] Add Swagger docs
- [x] Add e2e tests

Future:

- [ ] Frontend dynamic checklist renderer
- [ ] Care Plan generation from triggers
- [ ] PDF export
- [ ] Versioned assessment templates
- [ ] Advanced risk scoring
- [ ] Manager review dashboard

