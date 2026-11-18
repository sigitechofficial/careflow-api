# Learning in the carer app: plan

Date: 13 Nov 2026 · Status: **building (approved 13 Nov; suggestions 1–3 accepted, decision 4 numbers still open)**. API contract: `LEARNING_CARER_APP_API.md`.

## Build log (13 Nov)
- Migration `20270106090000_learning_session_attendees` (attendee `assignmentId`, `cantAttendReason`, `cantAttendAt`), applied locally after backup `db-backups/careadmin-before-learning-sessions-20261113.dump`.
- Completion: a training course delivered Face to face / Virtual / Blended also needs the session marked **Attended** (`courseNeedsSession`). Lessons and required quizzes still count as before (admin can mark pre-reading lessons optional).
- Carer API `employee-app/learning/*` (`LearningCarerAppService`, reuses `LearningMeService` rules).
- Push `LEARNING` (`LearningPushService`): course assigned (per carer), overdue (sent once), session booked, session cancelled. Message kinds `training-assigned`, `training-sessions`, `training-due` (overdue only).
- **Not built (waiting for decision 4 numbers):** due-soon push, certificate-expiring push, session reminders. The existing due-soon / expiring in-app notifications run daily and are unchanged.
- Training events: course required (training course with a session), created as Scheduled, book only carers with the course assigned (capacity checked), attendance only once the session has started, attended → completion refresh, cancel → push to booked carers, can't delete a session with attendance.
- Admin: Training events list (course, carers booked/attended/can't attend), schedule form with course / trainer / places / meeting link, session dialog (book carers, mark Attended / Partly / Absent, remove, can't-attend reasons, cancel session).
Mockups: 6 app screens shown in chat on 13 Nov (My learning, online course, lesson + quiz, result, classroom course, notifications).

Goal: a carer sees every course assigned to them in the app, gets a push when one is assigned, takes online courses in the app (lessons + quizzes + certificate), and sees classroom / virtual sessions for face-to-face courses.

## Verified today (code, 13 Nov)

| Area | Today | Where |
|---|---|---|
| App Learn tab | Static mock, "coming soon" buttons, no API calls | `care_employee/lib/presentation/pages/learn/learn_tab.dart:47` |
| App architecture | GetX, `data/domain/presentation` layers, Hive cache + `SyncQueue` outbox, Dio client, carer endpoints under `/employee-app/*` | `core/network/dio_client.dart`, `core/offline/sync_queue.dart`, `api_endpoints.dart` |
| Patterns to copy | My surveys (list, offline banner, shimmer), Survey form (questions, drafts), survey push tap | `pages/me/my_surveys_screen.dart`, `survey_form_screen.dart`, `survey_push.dart`, `visit_push_router.dart` |
| Learner API | Exists (`/learning/me/*`) but **no login can use it**: carers are refused by `PermissionsGuard` ("Staff access required"), staff have no employee record | `learning-me.controller.ts:17`, `permissions.guard.ts:38` |
| Carer endpoints | Protected by `EmployeeAppAuthGuard` (carer account + employeeId) | `employee-app/guards/employee-app-auth.guard.ts` |
| Assignment notification | In-app row only; **no phone push** | `learning-notification.hook.ts:40`, `notifications.service.ts` |
| Phone push | `FcmPushService.sendToEmployees` (surveys use type `SURVEY`) | `fcm-push.service.ts:130`, `survey-reminders.service.ts:649` |
| Lesson files for carers | Learner detail returns raw `fileId`; no signed link | `learning-me.service.ts` `getAssignment` |
| Classroom training | `LearningTrainingEvent` + `Attendee` exist (time, location, meeting link, trainer, capacity, booking + attendance status) but **not linked to assignments or completion**, no reminders, admin UI create/delete only, no carer endpoint | `schema.prisma` L13005–13058, `learning-training-events.service.ts` |
| Assign | Carers only (role contains "carer"), all mandatory | `learning-assignments.service.ts` (13 Nov) |

## Phases

### Phase 1: Carer learning API (backend)
- New `employee-app/learning` controller with `EmployeeAppAuthGuard` (carer logins), reusing `LearningMeService`. Endpoints: dashboard counts, my assignments (to do / done), assignment detail (modules, lessons, quizzes with lock reasons), complete lesson, start / submit quiz, my certificates.
- Lesson files: signed, short-lived links in the detail (same signing as admin).
- Assignment list items carry the course delivery method (Online / Classroom / Virtual / Workplace) so the app shows the right screen.
- Staff `/learning/me` stays as it is.
- Tests: guard, ownership (a carer only sees their own), locks, file links.

### Phase 2: Push notifications
- New push type `LEARNING` (with assignment id) via `FcmPushService`, keeping the in-app notification.
- Sends: course assigned; due soon / overdue (existing job, add push); certificate expiring; classroom session reminder (Phase 3). Timings: decision 4.
- App: `learning_push.dart` + tap handler that opens the course.

### Phase 3: Face-to-face / virtual sessions
- Database (additive): link a session attendee to the carer's assignment (`LearningTrainingEventAttendee.assignmentId`, nullable).
- Admin: training event detail page: course, trainer, capacity, status Scheduled, attendee list (add carers who have the course assigned), mark Attended / Absent, cancel event.
- Completion: marking Attended completes the classroom part of the course (decision 1).
- Carer API: "my sessions" in the assignment detail (date, time, place, meeting link, trainer, my status).
- Reminder job for sessions (decision 4).

### Phase 4: App screens (Flutter)
- Data: models, remote datasource, repository on `OfflineFirstRepository` (cache list + detail in Hive); lesson completions queued in `SyncQueue` so they work offline; quiz submit needs a connection.
- Screens (per mockups): My learning (counts + To do / Done), Online course (modules, locks, final assessment), Lesson viewer (text, image, PDF/Word, video link, web link), Quiz (one question at a time, tries and pass mark), Result (pass / try again / failed), Certificate, Classroom / virtual session.
- Replace the static Learn tab; routes; push tap.
- Static checks: `flutter analyze` on touched files. You run the app on your phone; I list exactly what to test.

### Phase 5: Testing
- API unit + live API run (carer login on a test carer not used on your phone), admin check of sessions and attendance, device test list for you.

## Decisions needed

| # | Question | My suggestion |
|---|---|---|
| 1 | Classroom course: does the trainer marking **Attended** finish the course automatically? | Yes, if the course has no required quiz; if it has one, the carer still passes it in the app (blended). |
| 2 | How does a carer get into a session? (a) admin adds them when assigning / from the session page, (b) carer books a session in the app | (a) for now; booking later. |
| 3 | Can a carer press "Can't attend"? | Yes, with a reason; the admin sees it and moves them to another session. |
| 4 | Reminder timings: session (e.g. day before / hour before?), due date (how many days before?) | Your numbers. I won't pick them. |

## Not in this plan
- Carer self-enrol / suggested courses, learning pathways, automatic assignment rules (separate work).
- Certificate PDF download (shows in app as a card first; PDF later).
- Assign from the course page (agreed: later).

## Risks
- New carer endpoints must only ever return the signed-in carer's own data: covered by ownership checks + tests.
- Push volume: reminders only for open, mandatory assignments.
- Migration is additive; live DB untouched until you say so.

## Test results (13 Nov)
- Unit: 62 pass (learning + message delivery), incl. 5 new session-completion tests. API + admin typecheck clean. Flutter: `flutter analyze` on the 24 touched files: no issues.
- Live API E2E (local, test carers Tom / Grace, not the phone carer): **38/38 pass**: carer guard, own-records only, list/detail shape, quiz lock → lessons → fail → pass → COMPLETED, closed course refuses lessons, session create rules, eligible carers, capacity, attendance not before start, carer sees date/place/trainer, can't attend (reason check, office sees it), lessons done + not attended stays open, attended → COMPLETED, cancel session. Push attempted and logged (skipped: test carers have no phone).
- Admin: Training events list and session dialog checked in the browser.
- Not tested: the app on a device (needs a full rerun), real push delivery on a phone.
