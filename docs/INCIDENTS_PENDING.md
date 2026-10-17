# Incidents — pending tasks

Work agreed but deliberately left for later. Keep each item short: what, why, where.

## Suspension

- **Suspension pay (checked 8 Oct, skipped for later).** UK Payroll still includes a suspended
  carer: it enrols by payroll profile status READY and ignores `Employee.isActive`
  (`payroll-runs.service.ts` ~943–958); suspension doesn't touch the payroll profile. Salaried /
  hybrid carers keep their salary. Hourly / per-visit carers get £0 because their future visits are
  unallocated. UK suspension is normally on full pay (ACAS). Options: A) flag suspended days on the
  payroll run so the manager adds suspension pay (first check payroll allows a manual pay line);
  B) automatic average pay (e.g. last 12 weeks) for suspended days.

## Staff actions (built 8 Oct 2026)

- **Fines vs payroll (checked 8 Oct, skipped for later).** A fine has a salary month; if that
  month's UK payroll run is already closed the fine is never deducted (runs only take fines whose
  month is in their period). Fines also aren't in the minimum-wage check: the visit pay run adds an
  NMW top-up over visit/travel/waiting pay, but UK Payroll subtracts fines afterwards and
  `deductionWouldBreachNmw` (pay-compliance.util.ts) is unused. Direction discussed: fine is "due"
  with no month, next run takes only what minimum wage allows, rest stays due. PM note:
  https://claude.ai/artifact/USrXn7T9feDetmoXFJjmB1

- **Not yet:** the staff member's own record (Employee → Incidents tab) doesn't list their staff
  actions; warnings have no expiry date; no letter/document upload per action (use Supporting
  records); closing doesn't require a staff outcome when the allegation was against staff.

## Investigate tab (deferred from first release)

- **Investigation chronology** (evidence part B): repeatable timed entries (date/time, what
  happened, source), edit with reason + history, soft delete with reason. New table.
- **Statements / interviews + investigation documents** (evidence part C): extend
  `IncidentWitness` (method, taken by, correction history) — not a new table; documents reuse
  `IncidentAttachment` with `INVESTIGATION_DOCUMENT` / `WITNESS_EVIDENCE`.
- **Sign-off / approval** of the completed investigation.
- **Contributing factors:** stop "Unknown" being ticked with other factors; count factors in
  analytics (learning/trends); decide whether at least one factor is required to complete; consider
  adding fatigue/workload and lone working.
- **Staff risk assessments** do not exist (only service-user assessments), so "Risk assessment" in
  evidence/factors can only link a service user's record.

## Corrective measures

- **Open measures after closing (skipped 8 Oct, to do later).** Closing with open non-mandatory
  measures is allowed by design (`assertClosable`), but afterwards the measure can't be completed
  or cancelled ("This incident is closed") while it still shows in the assignee's My actions.
  Proposed: allow only complete / cancel (with reason) after close; warn at close; badge + list
  filter "Closed with open measures"; timeline "after closing". INC-025's risk assessment measure
  is stuck like this.
- **Course measure proof (skipped 8 Oct, to do later).** A course measure can be marked done while
  the learning assignment is still ASSIGNED (INC-025), and finishing the course doesn't complete
  the measure. Proposed: show course status on the card; no manual completion; complete
  automatically when the assignment is COMPLETED / PASSED; failed / cancelled keeps it open.

- **Tell the responsible person** when a measure is assigned (notification). Also: "My actions" only
  works when the admin login is linked to an employee (`User.employeeId`) — none are linked locally.
- **Course measures:** show the learning assignment's own progress (started / completed) on the
  measure card.
- **Policy acknowledgement:** staff reading and signing a policy is not built (the
  `PolicyAcknowledgement` table exists but nothing uses it), so the measure type is just
  "Policy update" for now.
- **Completing from "My actions":** care plan / risk assessment / policy measures need the updated
  record chosen, so My actions sends the user to the incident page to complete them.
- **Outcome & close overlap:** the outcome's "changes made" list repeats what corrective measures
  now record (care plan, risk assessment, policy, training…) — derive it from the measures instead.
- **Suspension lift does not restore rota:** visits removed when a carer was suspended are not
  re-allocated when the suspension is lifted; a manager must re-allocate them.

## Carer-app incidents

Done 8 Oct 2026: the app form asks the office Raise form's questions (when, where, what was done,
hospital, category details, staff on the visit, structured injuries with pins); app incidents get
the branch, Restricted privacy for staff / "not sure who" allegations, and carer edits reach the
register until the office starts the review. Still to do:

- **Report outside a visit — built 8 Oct, device test pending:** Me tab → "Report an incident"
  → today's visit (opens that visit's form) or "Not during a visit" (`POST /employee-app/incidents`,
  optional client, branch from the client or the carer's branch). No voice notes outside a visit.
- **Refused offline edit:** if a carer edits while offline and the office starts the review before
  it syncs, the sync is refused but the app shows no message (the server keeps the original).
- **Old app builds** still send the old form (no category details); the office completes them.
- **"Saved locally"** shows on every submitted log entry (hard-coded label), even when synced.
- **My alerts detail** shows only the date of "When it happened", not the time.

## Duty of Candour (built 8 Oct 2026)

- Plan + what was built: `docs/DUTY_OF_CANDOUR_PLAN.md`. Left: dark-mode visual check;
  restricted-incident access test with a user without clearance.

## Later

- Notifications & referrals (on hold): HR disciplinary, DBS, NMC, PiPoT / safeguarding referrals.
