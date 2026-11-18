# Learning: course start time, overdue lock and admin actions (plan)

Date: 16 Nov 2026 · Status: **built + tested locally (16 Nov), uncommitted**. Open points 1–5 answered: user accepted all suggestions.
Scope: Online training course first (user asked to decide flows one course type at a time); the overdue rules apply to every course type.

## User decisions (16 Nov)
1. Admin extends the due date → the lock opens.
2. Carer in the middle of a quiz when the course goes overdue → let them finish, show a warning, notify admin; the course is marked **completed late** and admin can act.
3. Reasons for not completing: a researched list.
4. Admin actions: extend due date, or mark "not completed" and record the action taken.
5. Actions are recorded in the system and linked to a policy that opens in one tap.
6. The carer sees that the course is locked and should speak to the office.

## Verified today (code)
| Area | Today | Where |
|---|---|---|
| Course start time | Saved only when the first lesson is completed (`progress.startedAt`); tapping "Start course" saves nothing | `learning-completion.service.ts` refreshProgress |
| Lesson record | Completion time + seconds from opening the lesson | `LearningContentItemCompletion`, `lesson_viewer_screen.dart:55` |
| Overdue | Daily job 02:30 UTC sets OVERDUE + one push; carer can still continue | `learning-jobs.ts`, `learning-me.service.ts` CLOSED statuses exclude OVERDUE |
| Extend due date | API only (`POST learning/assignments/:id/extend`), no admin button; status stays OVERDUE after extend | `learning-assignments.service.ts` extendDueDate |
| Reasons / actions / late flag | Not present | – |
| Disciplinary records | No disciplinary model. Supervision exists (`SupervisionSession`, `SupervisionAction`) | `schema.prisma` L1824 |
| Policy links | `PolicyLink` (moduleType `TRAINING`, scope `SECTION`, sectionKey) + admin `PolicyContextPanel` already used on the course page | `schema.prisma` L14466, `PolicyContextPanel.tsx` |

## Research (UK sources)
- **CQC Regulation 18**: staff must receive the training needed for their duties; training completed must be monitored and "appropriate action taken quickly when training requirements are not being met". CQC does not prescribe which action. ([CQC Reg 18](https://www.cqc.org.uk/guidance-regulation/providers/regulations-service-providers-and-managers/health-social-care-act/regulation-18))
- **Acas, performance problems**: first find out the reason (capability vs conduct, health/disability); for capability offer support, coaching, training; keep records; if informal steps fail, a performance improvement plan (PIP); dismissal is a last resort. ([Acas: problems with performance](https://www.acas.org.uk/performance-management/problems-with-an-employees-performance))
- **Acas Code (disciplinary)**: informal conversation (never by itself a formal warning) → first written warning → final written warning → dismissal; formal action needs a meeting, right to be accompanied, and appeal; serious cases may skip stages. ([Acas Code](https://www.acas.org.uk/acas-code-of-practice-on-disciplinary-and-grievance-procedures/html), [Acas guide](https://www.acas.org.uk/sites/default/files/2024-08/discipline-and-grievances-at-work-the-acas-guide.pdf)) A 2026 draft Code is in consultation only.
- **Barriers to training** (employer-reported): cost 81.8%, time for training 55.9%, access 36.7% ([DHSC skills survey Sept 2025](https://www.gov.uk/government/statistics/adult-social-care-workforce-skills-survey-september-2025/adult-social-care-workforce-skills-survey-september-2025-report)); paid/protected study time is critical and staff often train in their own time ([Nuffield Trust 2021](https://www.nuffieldtrust.org.uk/sites/default/files/2021-09/workforce-research-summary-final.pdf)); not all staff have access to online apps ([DHSC Skills Record blog](https://digitalhealth.blog.gov.uk/2025/08/29/dhsc-skills-record-working-in-care-alpha-reassessment/)).
- **Gap**: no UK source found that lists reasons carers miss mandatory training specifically. The reason list below is built from the barriers above plus Acas's "find the reason" (health, disability) and some practical items marked *(suggested)*.

## A. "Start course" records the start (small)
- New carer endpoint `POST employee-app/learning/assignments/:id/start`: sets `progress.startedAt` (only if empty), `lastAccessedAt`, and status ASSIGNED/NOT_STARTED → IN_PROGRESS. Idempotent; queued offline.
- The app calls it when the carer taps "Start course" (or opens the first lesson/quiz).

## B. Overdue lock (all course types)
- Lock starts when the daily job marks the assignment OVERDUE (02:30 UTC, already runs). **Open point 1.**
- Locked = carer API refuses: complete lesson, start quiz. Carer can still **view** the course.
- **Quiz already started before the lock**: the carer can submit it (decision 2). **Open point 2:** only that quiz, or the whole course?
- Completion after the due date → `completedLate = true` on the assignment; managers get an in-app notification "Priya Sharma completed Safeguarding Adults late (due 30 Nov, completed 2 Dec)". Certificate is issued as normal. **Open point 3.**
- App (decision 6): amber card "This course is overdue and locked. Please speak to the office." + chip "Overdue · Locked"; course page shows the same note, lessons greyed, quiz buttons disabled.

## C. Admin: Overdue review (new)
Learning → Assignments: rows become clickable → **Assignment detail** drawer (lessons with dates, quiz attempts with scores, sessions, certificate) and, for overdue or late assignments, a **Review** section with these actions:

1. **Extend due date**: new date + reason (required) → status back to In progress (or Assigned if not started), lock opens, push to the carer "Your due date for X is now 10 Dec". Audit.
2. **Record reason** (why not completed), from the list below.
3. **Mark not completed**: closes the assignment as *Not completed* (status `EXPIRED`, existing enum) and records the **action taken** from the list below. Optional: re-assign the course with a new due date in the same step.

**Reasons (pick one + note)**
| Reason | Basis |
|---|---|
| Not enough time / workload | Time 55.9% (DHSC 2025) |
| No paid or protected training time | Nuffield 2021 |
| Phone, app or internet problem | Access 36.7%; DHSC blog |
| Needs help using the app (digital skills) | Nuffield / DHSC digital skills |
| Sickness or health condition | Acas: health, disability |
| Annual leave or other absence | *(suggested)* |
| Personal or family circumstances | *(suggested)* |
| Did not know about the course | *(suggested)* |
| Needs learning or language support | Acas: reasonable adjustments |
| No reason given | *(suggested)* |
| Other (write) | – |

**Actions (pick one or more + note + optional follow-up date)**, grouped as Acas does:
| Group | Action | Basis |
|---|---|---|
| Support | Informal conversation (recorded) | Acas: informal first; never a warning by itself |
| Support | Protected time / extra support / help with the app | Acas capability support; Nuffield |
| Support | Supervision 1:1 booked | Reg 18 supervision; existing Supervision module (record only, no link yet) |
| Support | Re-assign the course with a new due date | Acas training |
| Support | Performance improvement plan (PIP) | Acas |
| Safety | Restrict duties until trained (e.g. no medication visits) | Reg 18 "appropriate action"; record only, the rota is **not** blocked |
| Formal | Invite to disciplinary / capability meeting | Acas Code |
| Formal | First written warning | Acas Code |
| Formal | Final written warning | Acas Code |
| Formal | Dismissal (last resort) | Acas Code |
| – | No further action | – |

- Formal actions show a reminder: "Formal action needs a meeting, the right to be accompanied and a right of appeal (Acas Code)." The system only **records** the decision; it does not run the HR process.
- Every record stores: reason, action(s), note, follow-up date, who, when, **policy version it followed**. History is kept (append only). Audit log.

## D. Policy link (decision 5)
- The policy itself is written in the **Policies** module (e.g. "Mandatory training non-completion policy"), then linked with `PolicyLink` moduleType `TRAINING`, scope `SECTION`, sectionKey `overdue-actions`.
- The Review section shows it with the existing `PolicyContextPanel`; one tap opens it. Each record saves the linked policy version id, so later we can see which version applied.
- If no policy is linked, the Review section shows "No policy linked yet. Link one in Policies" (actions still allowed). **Open point 4:** should I draft the policy text (Acas-based) for your HR to approve?

## E. Data (additive migration)
- `LearningAssignment.completedLate Boolean @default(false)`.
- New `LearningAssignmentReview`: id, assignmentId, employeeId, kind (`EXTENDED | REASON | NOT_COMPLETED`), reasonCode, actionCodes (text[]), note, previousDueAt, newDueAt, followUpAt, policyVersionId, createdById, createdAt.
- Reason/action codes kept in code (fixed lists, like other enums here), so the lists above can be changed without a migration.

## Open points (please answer)
| # | Question | My suggestion |
|---|---|---|
| 1 | Lock time: when the nightly job marks overdue (02:30 UTC the night after the due date)? | Yes |
| 2 | Quiz in progress at lock: finish only that quiz, or the whole course? | Only that quiz; if it finishes the course → completed late |
| 3 | Who is notified of late completion: everyone with "manage assignments" permission, or the carer's branch managers only? | Carer's branch managers (falls back to all with the permission) |
| 4 | Should I draft the policy text? | Yes, as a draft for HR approval |
| 5 | "Restrict duties": record only for now? | Yes (blocking the rota is a separate piece of work) |

## Not in this plan
- Running the HR disciplinary process (letters, meetings, appeals).
- Blocking rota allocation for restricted carers.
- Flows for Classroom / Virtual / Blended / Assessment / Practical (next, one by one).

## Build + test log (16 Nov)
- Migration `20270107090000_learning_assignment_reviews` (backup `db-backups/careadmin-before-learning-reviews-20261116.dump`).
- API: `POST employee-app/learning/assignments/:id/start`; lock in `LearningMeService` (lesson complete + new quiz refused while OVERDUE; an unfinished attempt can be resumed and submitted); `completedLate` + manager notification (`LearningNotificationHook.trainingManagerUserIds`: permission `learning.assignments.manage` + carer's branch via `UserLocation`, else everyone with it); `LearningAssignmentReviewsService` (`GET learning/assignments/:id/record`, `POST …/extend-with-reason`, `POST …/reviews`, `GET learning/assignment-review-options`); reasons/actions in `learning-review.catalog.ts`; push "New due date".
- Admin: Assignments rows open `AssignmentRecordSheet` (summary, lessons with times, quiz tries, sessions, certificate, Review with policy link, Extend / Record reason or action / Mark not completed, history). "Not completed" = status EXPIRED shown as Not completed; "Late" chip in the list.
- App (subagent): start call (offline queued), locked card/page/lesson/quiz, "Finish your quiz" resume, "Completed late" chip.
- Policy text draft: `POLICY_DRAFT_MANDATORY_TRAINING_NON_COMPLETION.md` (for HR approval; then publish in Policies and link to Training › Section `overdue-actions`).
- Tests: 54 unit pass; API + admin typecheck clean; `flutter analyze` clean; live API E2E **24/24**; admin drawer + extend form used in the browser; phone: locked card, locked course page, lesson read-only, extend → unlocked after refresh, Start course → start time saved.
- Not tested on the phone: "Finish your quiz" late flow and "Completed late" chip (API-tested only); admin "Mark not completed" form (API-tested only); push (phone Wi-Fi has no internet).

## Change (16 Nov 2026, later): lock switched off
User: "for now only show overdue with a warning in admin and app, and let the carer continue". `LOCK_OVERDUE_COURSES = false` in `learning-review.catalog.ts` (lock code kept, off). App shows `overdueMessage` as a warning; finishing late still sets `completedLate` and notifies managers. Admin drawer shows "Overdue · carer can still finish (late)". Extend / reason / not completed unchanged.

## Manager outcome + drawer details (16 Nov 2026, user decision)
- **Face to face and Workplace** courses (any course type) complete only when a manager records **Passed** (`courseNeedsManagerOutcome` in `learning-completion.util.ts`). Virtual unchanged. Face to face still needs the session marked Attended. Passed also covers the practical sign-off.
- When everything else is done the assignment becomes `AWAITING_APPROVAL` ("Awaiting sign-off") and managers get "Training outcome needed".
- `POST learning/assignments/:id/outcome` {result PASSED|NOT_PASSED, note (required for Not passed), reassignDueAt?}. Passed → refresh → Completed + certificate. Not passed → FAILED; optionally given again. `POST learning/assignments/:id/assign-again` {dueAt, note?} for FAILED / EXPIRED (old record kept; the old `reassign` endpoint cancels, so it is not used). Review kinds `OUTCOME_PASSED`, `OUTCOME_NOT_PASSED`, `ASSIGNED_AGAIN` (migration `20270109090000`). Push to the carer.
- Admin drawer: Outcome card (Passed / Not passed, note, give again), "Give the course again" card, quiz "View answers" per try (each question, carer's answer, right answer, explanation), "Optional" tag, can't-attend label with time.
- App: "Awaiting sign-off" note, "Not passed" chip + manager's note, "passed by your manager" note, hints for In person / Workplace.
- Tests: live E2E 14/14 (F2F awaiting → not passed + given again → passed + certificate; workplace passed; online refused; drawer answers + optional), 54 unit, typechecks + analyze clean, browser + phone checked.
