# Learning — course authoring: Phase 6 test results

Date: 13 Nov 2026 · Environment: local (API `localhost:3000`, admin `localhost:5173`, DB `careadmin`) · Branch work: uncommitted.

Scope: course authoring only (new course → content → quiz → completion → review/publish → versions).
The carer app learner screens are not built, so learner-side behaviour is covered by unit tests only.

## Automated checks

| Check | Result |
|---|---|
| API typecheck (`tsc -p tsconfig.build.json`) | 0 errors |
| API learning unit tests (`jest src/learning`) | 43 / 43 pass (8 suites) |
| Admin typecheck | 0 errors |
| Admin learning tests (`vitest src/features/learning`) | 2 / 2 pass |
| API lint on lines added by this work | 0 issues (formatting fixed only on our lines; 117 older issues on untouched lines left as they were) |
| Admin lint (`src/features/learning`) | 0 new errors; 3 older `no-restricted-imports` errors in files not touched |

Unit tests added in this work: quiz rules, publish check (type-specific), scoring over all questions,
file upload/signing, course type/delivery + code suggestion, draft completion rules.

## API end-to-end run (spec §19)

One script, run as Super Admin against the local API, on a fresh course
`E2E Fire awareness 56068` (`HEALTH_SAFETY-001`). **71 checks, 71 pass**
(one check was first reported failing because the script read the history before the
second assignment existed; re-read afterwards: v1 = 1 assignment, v2 = 1 — correct).

| Area | Checks | Covered |
|---|---|---|
| Course creation | 7 | missing title / category rejected, duplicate code 409, code suggested `HEALTH_SAFETY-001` then next free one, Draft v1 saved |
| Type & delivery | 4 | bad pair rejected on create and update, old types blocked for new courses, category does not set rules |
| Content | 13 | sections add / rename / reorder, text cleaned of `<script>`, edit, PNG + PDF upload, `.exe` rejected, video/PDF/image/link lessons, `http` video rejected, wrong file for type rejected, signed link 200 / unsigned 404, delete, move |
| Assessment | 12 | pass mark 0 and attempts 0 rejected, quiz create/edit, single / multiple / True-correct / False-correct, correct answers saved, two-correct single rejected, reorder, empty quiz blocks publish |
| Completion | 3 | required quiz + approval + certificate 365 d + CPD 60 + refresher saved on the draft; refresher without certificate rejected; optional lesson |
| Publishing | 12 | empty course blocked, invalid quiz blocked, practical without / inactive competency blocked, empty checklist rejected, valid course publishes, published content / details / quiz read-only, second publish fails cleanly |
| Versioning | 15 | v2 created as a full separate copy (files reused), v2 edits leave v1 alone, published delete blocked, change summary required, v2 publish, v1 Superseded with its own rules, old assignment stays on v1, new assignment gets v2, withdraw needs a reason / blocks new assignments / keeps old ones, archive keeps history |
| Compatibility | 4 | existing course `P0-TEST-FIRE` loads, its assignment still on v1, certificates list loads, no token → 401 |

Also checked in Phase 5: two publishes at the same moment → one 201, one 409, no half-published state.
Audit log for the E2E course: created, updated ×3, published ×2, withdrawn, reactivated.

## Admin UI walk-through

Course list shows the E2E courses with status. On the published `HEALTH_SAFETY-001` v2:
read-only banner with "Create new version (v3)", no active edit buttons on Content / Assessment /
Completion / Review, Edit details hidden, Preview as carer shows objectives, sections, file and link
lessons, version history shows v2 Published and v1 Superseded with publisher, change summary,
counts and assignments. Earlier phases each had their own live UI test (create form, lesson dialog
uploads, quiz dialogs, competency panel, completion rules, review + confirm popup).

## Not covered / known gaps

- Carer side: taking lessons and quizzes in the app, certificate issue on completion (unit tests only).
- Permission test with a lower role (only "no token → 401" was run live).
- Practical sign-off by an assessor has no screen yet: a course that requires it cannot be finished.
- Manager approval has an API endpoint but no admin screen.
- Refresher job reads the course setting, not the carer's version.
- Two quizzes in one version: not checked whether passing one marks the quiz step complete.
- The course list also shows archived courses (existing behaviour, not changed).

## Test data left in the local DB

`HEALTH_SAFETY-001` (published v2, 2 cancelled assignments), `E2E-PRAC-56068` (draft),
`E2E-EMPTY-56068` (archived), competency `E2E_EVAC_56068`, plus the earlier test courses
`SAFEGUARDING-001`, `P0-TEST-FIRE`, `FIRST_AID-001`.

---

# Course outline redesign: test results (13 Nov 2026)

Built per `LEARNING_COURSE_OUTLINE_PLAN.md`: five tabs, modules with Lessons and Quizzes, Final assessment tab, per-quiz Required / Optional, final-assessment gate, new fail rule. Migration `20270105090000_learning_quiz_modules` (additive, backup `db-backups/careadmin-before-learning-quiz-modules-20261113.dump`). Nothing committed.

| Check | Result |
|---|---|
| API typecheck | 0 errors |
| API unit tests (`src/learning` + `src/search`) | 61 / 61 pass (new: quiz progress rules 6, publish check updated) |
| API lint on lines added by this work | 0 issues |
| Admin typecheck / lint on changed files | 0 errors (1 old warning in LessonDialog) |
| Admin API checks (new rules) | 12 / 12 pass |
| Learner-side run on the real DB (service code, certificates/compliance stubbed) | 17 / 17 pass |
| Regression: Phase 6 API E2E script | 70 / 71 (same script-order false fail as before, re-verified) |
| Admin UI walk-through | pass (one bug found and fixed: question number after "Save and add next") |

Admin API checks: module quiz in module; optional stays optional; final forced required; quizzes keep order added; module from another course rejected; final cannot be made optional; module "required" cannot be switched off; empty module blocks publish; publish sets the quiz requirement; new version copies quizzes into the copied modules.

Learner run: module quiz locked until its lessons are done; final locked until all required lessons and required module quizzes are done (message counts what is left); failing 1 of 2 tries does not fail the course; passing on the 2nd try continues; an optional quiz out of tries does not fail the course; final out of tries fails the assignment; no extra try; happy path completes the course and issues the certificate once.

UI: five tabs; outline groups, counts, empty states, no arrows; Add quiz (Required / Optional) goes straight to "Add question 1"; Save and add next; Questions panel (edit / delete / back from question dialog); Final assessment tab (empty, list, add, always required); Finish and certificate lists required quizzes by name, optional count, new refresher wording; Review summary in module wording, "Go to Final assessment"; published course read-only on outline and final tabs; old quiz without a module shown in Final assessment.

## Known limits

- The carer learning API (`/learning/me`) cannot be used by any login today: carer accounts are refused by `PermissionsGuard` ("Staff access required") and staff logins have no employee record ("Employee context required"). That is why the learner run calls the service code directly. Needs fixing when the carer app Learn tab is built.
- Carer assignment status stays ASSIGNED while learning (no IN_PROGRESS); unchanged existing behaviour.
- Practical assessor sign-off and manager approval screens still not built.
- Module quiz gate (wait for that module's lessons) was my suggestion, built as part of "do it all"; easy to remove if not wanted.

Test data added: course SAFEGUARDING-003 "Outline E2E 86759" (v1 published, v2 draft), course OTH-86759, two test assignments (one FAILED, one COMPLETED) for local demo carers, plus the regression run's HEALTH_SAFETY-002 course set.

