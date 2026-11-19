# Carer app learning API (contract)

Date: 13 Nov 2026. Part of LEARNING_CARER_APP_PLAN.md (Phase 1 + 3).
All routes: `JwtAuthGuard + EmployeeAppAuthGuard` (carer login), and only ever the signed-in carer's own records.
Dates are ISO strings (UTC). Cancelled and exempt assignments are never returned.

## Enums
- `courseType`: `COURSE | ASSESSMENT | PRACTICAL_COMPETENCY`
- `deliveryMethod`: `ONLINE | FACE_TO_FACE | VIRTUAL | WORKPLACE | BLENDED`
- `status` (assignment): `ASSIGNED | NOT_STARTED | IN_PROGRESS | AWAITING_ASSESSMENT | AWAITING_APPROVAL | COMPLETED | PASSED | FAILED | OVERDUE | EXPIRED`
- `contentType` (lesson): `TEXT | IMAGE | PDF | DOCUMENT | VIDEO | EXTERNAL_LINK` (older types may appear: show as a plain card)
- `questionType`: `SINGLE_CHOICE | MULTIPLE_CHOICE | TRUE_FALSE | SHORT_TEXT | LONG_TEXT`
- Session `eventStatus`: `SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED`
- Session `bookingStatus`: `INVITED | BOOKED | WAITLISTED | CANCELLED`; `attendanceStatus`: `INVITED | BOOKED | WAITLISTED | ATTENDED | PARTIALLY_ATTENDED | ABSENT | CANCELLED`

## GET /employee-app/learning
```json
{
  "counts": { "toDo": 3, "overdue": 1, "done": 2, "certificates": 1 },
  "assignments": [AssignmentSummary]
}
```
`AssignmentSummary`:
```json
{
  "id": "uuid", "courseId": "uuid", "title": "Safeguarding adults", "code": "SAFE-001",
  "categoryName": "Safeguarding", "description": "<p>html</p>",
  "courseType": "COURSE", "deliveryMethod": "ONLINE",
  "status": "IN_PROGRESS", "isOpen": true, "isMandatory": true,
  "dueAt": "…", "assignedAt": "…", "completedAt": null,
  "progressPercentage": 40, "estimatedDurationMinutes": 45,
  "lessonCount": 6, "lessonsDone": 2, "quizCount": 2, "requiredQuizzesLeft": 1,
  "needsSession": false, "nextSession": Session | null
}
```
- `isOpen`: true for ASSIGNED, NOT_STARTED, IN_PROGRESS, AWAITING_ASSESSMENT, AWAITING_APPROVAL, OVERDUE (the "To do" list). Others go in "Done" (FAILED/EXPIRED shown with their badge).
- `progressPercentage` counts required lessons only. `requiredQuizzesLeft`: required module quizzes and final assessments not passed yet.
- `nextSession`: the next upcoming session; if none, the latest booked session that has ended (waiting for attendance); else null.
- `needsSession`: true when the course has a classroom / virtual part (training course delivered Face to face, Virtual or Blended). The course is only finished after the trainer marks the carer Attended.
- Ordered: open first (overdue, then due date soonest, no due date last), then done (latest completed first).

## GET /employee-app/learning/assignments/:id
`AssignmentSummary` plus:
```json
{
  "objectives": "text or null",
  "passingScore": 80, "certificateEnabled": true,
  "modules": [{ "id": "uuid", "title": "Module 1", "description": null,
                "lessons": [Lesson], "quizzes": [Quiz] }],
  "finalAssessments": [Quiz],
  "sessions": [Session],
  "sessionAttended": false,
  "certificate": { "id": "uuid", "certificateNumber": "…", "issuedAt": "…", "expiresAt": null, "status": "ACTIVE" } | null
}
```
`Lesson`:
```json
{ "id": "uuid", "title": "…", "description": null, "contentType": "PDF",
  "contentBody": "<p>html</p> or null", "videoUrl": null, "externalUrl": null,
  "file": { "url": "/learning/files/<id>?exp=…&sig=…", "name": "x.pdf", "mimeType": "application/pdf", "size": 1234 } | null,
  "estimatedDurationMinutes": 10, "isRequired": true, "completed": false }
```
- `file.url` is a path on the API host (prefix with the API base URL). It needs no bearer token and expires after a short time: reload the detail to get a fresh link.

`Quiz`:
```json
{ "id": "uuid", "title": "…", "instructions": null, "isFinal": false, "isRequired": true,
  "passingScore": 80, "maximumAttempts": 3, "attemptsUsed": 1, "attemptsLeft": 2,
  "bestPercentage": 60, "passed": false, "outOfTries": false,
  "lockedReason": "Opens when you finish this module's lessons" | null,
  "questionCount": 5, "retakeAvailableAt": null, "hasAttemptInProgress": false }
```
- `attemptsLeft` null = unlimited.

`Session`:
```json
{ "attendeeId": "uuid", "eventId": "uuid", "title": "…", "deliveryMethod": "FACE_TO_FACE",
  "startAt": "…", "endAt": "…", "location": "Head office, Room 2" | null, "meetingUrl": "https://…" | null,
  "trainerName": "…" | null, "eventStatus": "SCHEDULED",
  "bookingStatus": "BOOKED", "attendanceStatus": "BOOKED",
  "cantAttendReason": null, "canSayCantAttend": true }
```
- `canSayCantAttend`: true while the session is SCHEDULED, has not started, and the carer has not already said they can't attend.

## POST /employee-app/learning/assignments/:id/lessons/:lessonId/complete
Body `{ "timeSpentSeconds": 120 }` (optional). Idempotent (safe to retry from the offline queue).
Returns `{ "completed": true, "progressPercentage": 50, "status": "IN_PROGRESS" }`.
Errors: 400 "This training is no longer open" (drop the queued item), 404 lesson/assignment not found (drop).

## GET /employee-app/learning/assignments/:id/quizzes/:quizId
The quiz to take (no correct answers):
```json
{ "id": "uuid", "title": "…", "instructions": null, "passingScore": 80, "maximumAttempts": 3,
  "attemptsUsed": 1, "attemptsLeft": 2, "lockedReason": null,
  "questions": [{ "id": "uuid", "questionType": "SINGLE_CHOICE", "questionText": "…", "points": 1,
                  "options": [{ "id": "uuid", "optionText": "…" }] }] }
```

## POST /employee-app/learning/assignments/:id/quizzes/:quizId/start
Returns `{ "attemptId": "uuid", "attemptNumber": 2 }`. Resumes an unfinished attempt. 400 with the lock / no tries / retake-later message.

## POST /employee-app/learning/assignments/:id/quizzes/:quizId/submit
Body `{ "answers": [{ "questionId": "uuid", "selectedOptionIds": ["uuid"], "textAnswer": null }], "timeSpentSeconds": 300 }`.
Needs a connection (not queued). Returns:
```json
{ "attemptId": "uuid", "percentage": 80, "passed": true, "passingScore": 80,
  "attemptsLeft": 1, "status": "COMPLETED" }
```
`status` is the assignment status after the result (FAILED when a required quiz is out of tries).

## GET /employee-app/learning/certificates
`[{ "id", "courseTitle", "certificateNumber", "issuedAt", "expiresAt", "status" }]`

## POST /employee-app/learning/sessions/:attendeeId/cant-attend
Body `{ "reason": "text, 3–500 chars" }`. Returns the updated `Session`. The office sees it on the training event and moves the carer to another session.

## Push
`data: { "type": "LEARNING", "assignmentId": "uuid" }`, sent when a course is assigned and when it becomes overdue. Tap opens the course.

## Overdue lock and start time (16 Nov 2026)
Plan: `LEARNING_OVERDUE_ACTIONS_PLAN.md`.
- `AssignmentSummary` (list + detail) gains:
  - `locked: boolean` — true when the course is OVERDUE. Lessons can be **read** but not completed; new quizzes cannot start.
  - `lockedMessage: string | null` — "This course is overdue and locked. Please speak to the office."
  - `completedLate: boolean` — finished after the due date.
  - `startedAt: string | null` — when the carer started.
- `POST /employee-app/learning/assignments/:id/start` (no body) — call when the carer taps "Start course" (first time). Records the start time and makes the course In progress. Idempotent; can be queued offline. Returns `{ startedAt, progressPercentage, status }`.
- While locked:
  - `.../lessons/:lessonId/complete` → 400 with the locked message (drop a queued item).
  - `.../quizzes/:quizId/start` → 400 with the locked message, **except** when that quiz has an unfinished attempt (`Quiz.hasAttemptInProgress`): it is resumed and can be submitted. If that finishes the course, it is completed late and managers are notified.
- The office can extend the due date: the course opens again (status back to In progress / Assigned) and the carer gets a push (`type: LEARNING`).

### Update 16 Nov 2026 (later): lock switched off
User decision: for now an overdue course is **not locked**. `locked` is always false and `lockedMessage` null (switch `LOCK_OVERDUE_COURSES` in `learning-review.catalog.ts`). New field `overdueMessage` (string|null) is set when the course is OVERDUE; show it as a warning. The carer can keep going; finishing after the due date sets `completedLate` and notifies managers.

### Carer late reason (16 Nov 2026)
User decision: when an overdue course is opened, the carer must say why it is late (required) before carrying on.
- `GET /employee-app/learning` returns `lateReasons: [{ code, label }]` (carer wording).
- `AssignmentSummary` gains `lateReasonRequired: boolean` (OVERDUE and no reason given yet) and `lateReason: { code, label, note, givenAt } | null`.
- `POST /employee-app/learning/assignments/:id/late-reason` body `{ reasonCode, note? }` — `note` required (3+ chars) when `reasonCode` is `OTHER`. 400 if the course is not overdue or the code is unknown. Needs a connection. Office managers get an in-app notification; the office sees it in the assignment history as "Carer's reason".
- While `lateReasonRequired` is true: lesson complete and quiz start return 400 "This course is overdue. Tell the office why before you carry on." (a quiz already in progress can still be resumed).

### Manager outcome (16 Nov 2026)
User decision: **face to face and workplace** courses only finish when a manager records **Passed** (Virtual unchanged).
- `AssignmentSummary` gains `needsManagerOutcome: boolean` and `outcome: { result: 'PASSED' | 'NOT_PASSED', note, decidedAt } | null`.
- When everything else is done the status becomes `AWAITING_APPROVAL` (show "Awaiting sign-off" + "Your manager will confirm if you passed.").
- Passed → `COMPLETED` (+ certificate when on). Not passed → `FAILED` with `outcome.result = NOT_PASSED` (show the manager's note: "Not passed — your manager will arrange more training."). The office may give the course again (a new assignment appears in To do).
- Push `type: LEARNING` on the outcome.
