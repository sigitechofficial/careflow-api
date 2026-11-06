# Supervision & appraisals

Goal: show CQC that every carer gets the support, supervision and appraisal Regulation 18(2)(a) requires,
with NICE QS123 statement 6 (practice-based supervision at least every 3 months for home care workers) as the
headline measure, and let each organisation configure its own rules.

## Model

- **ReviewType** (lookups): Supervision, Clinical Supervision, Probation Review, Induction Check-in, Care
  Certificate Sign-off, Annual Appraisal… with `defaultIntervalDays` (Supervision = 90).
- **EmployeeReview**: the due-date tracker per carer and type (last done, next due, status). Status is worked
  out from the dates on every read (`employee-review-schedule.util.ts`).
- **Schedules** (`ReviewType.scheduleKind`, one engine in `employee-review-schedule.util.ts`, collected for
  everyone by `review-dues.ts`):
  - `REPEATING`: every N days; the first one `firstDueAfterStartDays` after the start date (supervision 90,
    spot check 90 with the first at 30, appraisal 365, policy briefings 365 with the first at 7).
  - `MILESTONES`: days after the start date, then stops (probation 30/90/180, induction 7/14/21/28, Care
    Certificate 84). A review counts for the milestone whose window it falls in (halfway from the previous one).
  - `EVENT`: only once recorded, optional follow-up gap (return to work; performance plan every 14 days; team
    meetings are not chased per carer).
  - `audience`: `NMC_REGISTRANTS` (staff with an NMC PIN) for clinical supervision (90 days) and NMC
    revalidation (3 years).
  New starters come due from their start date before anything is recorded (`meta.upcoming` on the review
  lists). Sources and the comparison are in the session notes: NICE QS123 s6, CQC Reg 18, Skills for Care,
  NMC.
- **SupervisionSession**: the record of one meeting: format (one-to-one, group, observed practice, remote),
  supervisor, form answers, summary, confidential notes, agreed actions, signatures, addenda.
  Completing a session moves each carer's EmployeeReview for that type on (last done = held date).
- **Forms**: each review type points at a Care Pathway staff form (`ReviewType.supervisionFormId`), built and
  published in Care Pathway → Form builder. A session keeps a snapshot of the form (`formSnapshot`: sections and
  fields with their ids) and answers keyed `sectionId:fieldId`, the same keys the admin form renderer uses. Care
  Pathway saves a form by replacing its sections and fields, so the snapshot is what keeps a past record stable.
  A session not yet answered picks up a form republished since it was booked. 13 default forms are seeded once
  (`prisma/seed-data/supervision-forms.ts`), with Yes/No and pick-list questions wherever the answer is evidence
  (spot checks especially).
- **Named supervisor**: `EmployeeEmployment.supervisorUserId`, set on the staff record. Gets the carer's reminders
  and runs their sessions by default.
- **SupervisionReminderLog**: one row per reminder (review, due date, kind), so each is sent once.

Lifecycle: `SCHEDULED → IN_PROGRESS → (supervisor signs) → AWAITING_SIGN_OFF → (each carer signs or records
disagreement) → COMPLETED`, or `CANCELLED` with a reason. Content is editable only before the supervisor signs.
Signed records are never edited: corrections are dated addenda (who and when are recorded). Every change is in
the audit log (module `SUPERVISION`).

## Phases

1. **Foundation (done):** restore review-type intervals, seed review types, API sets next due and status.
2. **Sessions (done):** sessions recorded on Care Pathway forms, actions with carry-forward, two-party sign-off,
   group sessions, confidential notes, addenda, Settings → Supervision.
3. **Planning and reminders (done):** named supervisor, auto-book the next session, hourly job
   `supervision-reminders` (sends from the configured hour; reminders before and after the due date, escalation
   to branch managers, carer push, email), dashboard tiles (overdue, due soon, never supervised, % supervised in
   the last 3 months, awaiting sign-off). Still to do: spot checks booked on real visits, incident "Supervision"
   action creates a session, caseload limits.
4. **Evidence for CQC:** supervision matrix with PDF/Excel export, reports by branch and supervisor.
5. **Carer app and tidy-up:** carers prepare, read and sign in the app; retire the "Supervision 1…8" compliance
   document types; appraisal template linked to Learning.

## Settings

| Where | Setting | Default |
|---|---|---|
| Settings → Lookup data → Review types | Interval (days) per type | Supervision 90, Appraisal 365, … |
| Settings → Supervision | Carer must sign before a session completes | Yes |
| Settings → Supervision | Carer can record that they disagree | Yes |
| Settings → Supervision | Required questions must be answered before signing | Yes |
| Settings → Supervision | Confidential notes section | Yes |
| Settings → Supervision | Book the next session when one is completed | No |
| Settings → Supervision → Reminders | Send reminders / time (organisation time zone) | Yes / 08:00 |
| Settings → Supervision → Reminders | Days before the due date (0 = on the day) | 14, 7, 1, 0 |
| Settings → Supervision → Reminders | Days after the due date | 1, 7, 14 |
| Settings → Supervision → Reminders | Tell branch managers when overdue by (0 = never) | 7 days |
| Settings → Supervision → Reminders | "Due soon" window | 14 days |
| Settings → Supervision → Reminders | Remind supervisor / push carer / managers on every reminder / email | Yes / Yes / No / Yes |
| Settings → Supervision → Forms | Care Pathway staff form per review type | Seeded defaults |

Reminders: each configured day is a threshold, and the latest one crossed is sent once per due date, so a day
the job did not run is caught up and a long-overdue review gets one reminder, not one per missed day. Carers with
no named supervisor: branch managers get the reminders. Before-due reminders are skipped when a session is
already booked by the due date. Staff who turn "Supervision due" off in their notification preferences get no
notification or email.

Later: count spot checks as supervision, supervisor caseload limit, probation / induction / Care Certificate
schedules, appraisal anchor, incident and return-to-work triggers, compliance target %, exclusions.

## Permissions

| Key | Seeded to |
|---|---|
| `supervision.read` | Senior Carer/Nurse, Care Coordinator, Manager, HR, Admin |
| `supervision.manage` | Senior Carer/Nurse, Care Coordinator, Manager, Admin |
| `supervision.read_confidential` | Manager, Admin |
| `supervision.settings` | Admin |

Super Admin has all of them.
