# Care app sign-up and account delete — pending work

Built 19 Nov 2026 (backend, admin, carer app). Not committed yet. This file lists what is still open.
Each item says whether it is a **bug**, a **check**, a **decision** or a **go-live step**.

## Bugs

1. **FIXED 20 Nov 2026 — "Mark done" on a sign-up or delete task left the request stuck.**
   - My tasks shows the normal **Start** and **Mark done** buttons on `CARER_SIGNUP` and
     `CARER_DELETION_REQUEST` tasks (`careflow-admin/src/features/role-tasks/components/RoleTaskRow.tsx`,
     `closedOnPage` only covers Learning and Survey tasks).
   - If someone clicks **Mark done**, the task closes but the carer stays `PENDING` (or the delete request
     stays `PENDING`) and no open task reminds anyone.
   - Fix: treat these tasks like Learning/Survey tasks — no Start/Mark done/Reopen; they close only by
     Approve/Decline on the staff record.
   - Reproduced 20 Nov 2026 (phone + Chrome): "Bug Demo Carer" signed up on the phone; Super Admin clicked
     Mark done in My tasks. Only the Super Admin role's task closed (Admin, Branch Admin, Manager tasks stayed
     OPEN — one task per role); the staff record still showed "waiting for approval" and the carer's login still
     got "Approval pending". For Super Admin the request has vanished from To do.

2a. **FIXED 20 Nov 2026 (approval card asks for hours; warning dialog with an hours box) — an approved sign-up carer could not be given visits.** Allocation is refused with "This carer has no
   contracted weekly hours. Set their weekly hours first (Employment → Working hours)". Approve does not set
   contracted hours. Found in the 19 Nov delete test. Options: ask for contracted hours on the approval card,
   or tell the approver to set them on the Employment tab.

## Checks

2. **CHECKED 20 Nov 2026 (local DB) — most reviewers cannot act on the task they get.** Tasks go to Manager,
   Branch Admin, Admin and Super Admin, but locally only Super Admin has both `employees.update` (approve a
   sign-up) and `employees.delete` (approve a delete). Branch Admin has `employees.update` only; Admin and Manager
   have neither (Super Admin passes every permission in `PermissionsGuard`). Live role permissions not checked.
   Decide: send tasks only to roles that hold the permission, or give these roles the permission.
   Original note: **Can every reviewer approve a delete?** Delete-request tasks go to Manager, Branch Admin, Admin and
   Super Admin (`CARER_REVIEW_ROLE_NAMES` in `src/carer-signup/carer-signup.service.ts`), but approving needs
   `employees.delete`. Check which of these roles have that permission; a role without it sees a task it
   cannot finish.
3. **GPS nearest-branch suggestion** is untested: no branch (`scheduling.ScheduleArea`) has latitude/longitude
   locally, so carers always pick from the list. Fill branch coordinates on live, then test.
4. **Apple guideline 5.1.1(v)**: in-app account deletion is required; here it waits for a manager. Not verified
   that Apple accepts deletion that needs approval. Check before App Store submission.

## Decisions (business)

5. **Same email cannot sign up again.** A declined or deleted carer's email stays taken
   ("An account already uses this email address"). Keep, or allow re-use?
6. **The carer is not told when they are approved or declined.** They only find out at login. Push cannot work
   (no device token before first login); an email could.
7. **Anyone can sign up** (no email verification, by decision). Fake sign-ups would create tasks and
   notifications. Only a rate limit (5 per 15 minutes per IP) slows this down.
8. **A deleted carer stays logged in until the app reopens or the connection returns** (existing
   `SessionRevalidator` behaviour, same as an office delete).
9. Old test tasks keep "Bexley ISF - Bexley" in their saved description (new ones use "London · Bexley").

## Go-live steps

10. Commit and deploy the migrations `20270121090000_care_app_signup` and
    `20270121100000_employee_document_compliance_type`. Check whether the live database already has
    `EmployeeDocument.complianceTypeId` (the migration is safe either way: `IF NOT EXISTS`).
11. The production API the app uses (`api-allforcare`, `production` branch) is far behind `main`; sign-up,
    delete requests and My tasks changes need `main` deployed there first.

## Tested 19 Nov 2026 — delete with future visits (passed)

- Test carer "Delete Visits Tester" (Croydon 4): signed up, approved, contracted hours set, 3 future visits
  for Edie Marsh assigned through the normal allocate API.
- Carer asked to delete in the Care app API → staff-record card listed the 3 visits (date, time, client), and
  the My tasks card showed "Future visits: 3 will be unassigned if approved" (added in this test).
- Approved → `scheduleImpact.jobsUnallocated = 3`; the 3 visits are back to `UNALLOCATED`, the allocation rows
  are kept (inactive) for history, the employee is soft-deleted.

## Fixed 20 Nov 2026

- Sign-up / delete tasks in My tasks: one "Review sign-up →" / "Review delete request →" button (no Start,
  Mark done or Reopen); the API refuses to close or reopen these tasks. Done cards say "Approved" / "Declined"
  by whom; a task closed earlier without a decision says "Not decided yet" and that the request still waits.
- Staff-record approval card: "What the carer entered" summary, contracted hours per week, "Approve carer".
  Approving without hours opens "Contracted hours not added" with an hours box: "Approve with these hours" or
  "Approve without hours". After approval a "Carer approved — still to add" dialog (and a card) lists contracted
  hours, working pattern, compliance documents and payroll details, each with "Go to <tab>".
- Branch names on the approval card match "Zone · Branch". Sign-in access says the Care app sign-up is waiting
  for approval instead of "is inactive".

## Tested 20 Nov 2026 — visits after approval, with and without hours (passed)

- "Review Wording Carer" approved with 20 contracted hours (hours box in the warning dialog) → assigning a future
  visit worked ("Allocation created — confirmation required").
- "No Hours Carer" approved with "Approve without hours" (dialog shows: "If you approve without hours, no visits
  can be assigned to this carer until their contracted hours are added on the Employment tab.") → assigning a
  visit was refused: "This carer has no contracted weekly hours…". No allocation was created.
- Local test data left: Review Wording Carer is allocated to one Edith Marsh visit (c? 68b20855…).

## Done 20 Nov 2026 — every review role can decide

- Manager, Branch Admin, Admin and Super Admin can approve / decline sign-ups and delete requests
  (`canDecideCarerRequest` in `carer-signup.service.ts`), even without `employees.update` / `employees.delete`.
  Branch-limited users only for carers in their branches (`assertEmployeeInScope`).
- New page `/employee/<id>/review` (opens with `employees.read`): the task's Review button and the notification
  go there. "Go to <tab>" buttons show only to users who can edit staff records; others see a note.
- Tested: Admin (company-wide, no edit/delete permission) approved a sign-up and a delete; a Manager from
  another branch got "Employee not found".

## Tested 20 Nov 2026 — delete account end to end on the phone (passed)

- Review Wording Carer (20 h, one future Edith Marsh visit on 21 Nov) logged in on the phone → Me → My profile →
  "Delete my account" → reason "I am leaving care work" → "Send delete request" → "Delete request waiting for
  your manager".
- Approved in the admin by Company Admin (Admin role) 6 s later; the 4 role tasks closed "Approved", the visit went
  back to UNALLOCATED, the employee was soft-deleted.
- Reopening the app showed the login screen; logging in again gave "Invalid email or password".
