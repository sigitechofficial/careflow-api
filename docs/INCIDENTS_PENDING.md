# Incidents — pending tasks

Work agreed but deliberately left for later. Keep each item short: what, why, where.

## Suspension

- **Payroll impact of suspension (check before changing suspension).** In the UK a suspended
  carer is normally on full pay. Suspending a carer from an incident currently sets the employee
  to inactive / status "Inactive" (`IncidentsService.suspendCarer` → `employees.update({ isActive: false })`).
  Check whether payroll (UK Payroll / Office salaries) skips inactive employees. If it does, a
  suspended carer would silently drop out of pay — suspension needs its own state instead of
  "inactive".

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

## Later

- Notifications & referrals (on hold): HR disciplinary, DBS, NMC, PiPoT / safeguarding referrals.
