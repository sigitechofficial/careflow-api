# Learning — course builder redesign (Course outline) plan

Date: 13 Nov 2026 · Status: **built and tested 13 Nov 2026 (uncommitted)** · results in `LEARNING_COURSE_AUTHORING_TEST_RESULTS.md`.

Agreed UI (mockups shown in chat, 13 Nov): five builder tabs
**Details → Course outline → Final assessment → Finish and certificate → Review and publish**.

## Decisions (user, 13 Nov)

| # | Decision |
|---|---|
| 1 | No re-ordering. Modules, lessons and quizzes stay in the order they were added (no arrows, no drag). |
| 2 | A carer's assignment fails only when they have used **all tries** on a **required** quiz. |
| 3 | A module with no lessons **blocks publishing**. |
| 4 | Old quizzes that are not in a module are shown in the **Final assessment** tab. |
| 5 | Module quizzes are **Required** or **Optional**, chosen when the quiz is added (can be changed later). |
| 6 | Final assessments live in their **own tab**, can be **more than one**, are **always required**, and are **optional for the course** (a training course can publish without one). An "Assessment only" course still needs at least one. |
| 7 | A carer can start a final assessment only after **all modules are covered**: every required lesson done and every required module quiz passed. Enforced on the server. |
| 8 | Adding a quiz opens the question dialog straight away ("Add question 1"), with **Save and add next** / **Save and close** / **Close**; a Questions panel lists, edits and deletes questions. |
| 9 | Module = the current "section". Inside each module the UI shows two groups: **Lessons** and **Quizzes**. |
| 10 | Refresher wording: "Assign this course again when a carer's certificate expires" + "Carers who have already finished this course get it again automatically on the day their certificate expires." |
| 11 | Details tab stays editable as today (code fixed after creation). |

## What stays as it is

- New course form, Details step, one Description.
- Lesson dialog (6 types, uploads, signed links), question form, quiz rules (`learning-quiz-rules.util`).
- Versions: only drafts editable, publish snapshot, version history, withdraw / re-activate / archive / un-archive.
- Publish check engine (`learning-publish-check.util`), publish confirm popup, withdrawn-course buttons.
- Courses list tabs.

## Verified facts this plan depends on (code, 13 Nov)

| Fact | Where |
|---|---|
| A quiz belongs to the course version only (`LearningAssessment.courseVersionId`); no module link, no order field | `prisma/schema.prisma` `LearningAssessment` |
| `LearningAssessment.isRequired` exists (default true) but nothing reads it | schema; `src/learning` |
| Completion keeps **one** quiz status per assignment: any passed quiz → COMPLETED; any failed attempt → FAILED **and the whole assignment FAILED**, even with tries left | `learning-completion.service.ts` `recordAssessmentResult` |
| A carer can start any quiz at any time; lessons are not checked | `learning-me.service.ts` `startAssessmentAttempt` |
| Required lessons are counted only in sections with `isRequired = true`; admin never sets it, API accepts it | `learning-completion.service.ts`, `CreateLearningSectionDto` |
| New version copies quizzes but has no module to map them to | `learning-courses.service.ts` `createVersion` |
| Carer app Learn tab not built | `care_employee` |

## Phases

### Phase A — Database (additive only)
Hand-written SQL migration, `pg_dump -Fc` backup first, `prisma migrate deploy`:
- `LearningAssessment.sectionId` UUID nullable, FK → `LearningCourseSection` (on delete cascade), index. `null` = final assessment.
- `LearningAssessment.displayOrder` INT default 0 (keeps the order quizzes were added).
No data changes; existing quizzes become final assessments (decision 4).

### Phase B — Backend
- Quiz create takes `sectionId` (a module of the same draft version) or none (final). Final assessments are always `isRequired = true`; module quizzes take Required / Optional.
- New items are appended (order = order added). Existing reorder endpoints are no longer used by the admin.
- `createVersion` copies each quiz into the matching copied module.
- Module (section) `isRequired` locked to true.
- **Completion:** the quiz step is done when every **required** quiz (module + final) has a passed attempt for this assignment (from attempts, not the single status). `requiresAssessment` on the version = "has any required quiz", set automatically.
- **Fail rule (decision 2):** a failed attempt marks the assignment FAILED only when no tries are left on a required quiz.
- **Final assessment gate (decision 7):** `startAssessmentAttempt` refuses a final assessment until all required lessons are done and all required module quizzes are passed. Module quizzes: no gate (see open point).
- **Publish check:** module with no lessons (blocker), quiz with no questions (blocker), Assessment-only course without a final assessment (blocker), existing checks kept, messages in module / quiz wording.
- Learner API returns quizzes with their module and whether a final assessment is locked.
- Unit tests for every rule above.

### Phase C — Admin: Course outline tab (replaces Content + module part of Assessment)
- Modules with **Lessons** and **Quizzes** groups, counts, empty states, "+ Add lesson", "+ Add quiz" (Required / Optional).
- Quiz flow from decision 8 (question dialog straight away, Questions panel).
- Edit / delete with confirms that say what goes with it; toasts; published read-only view. No arrows.

### Phase D — Admin: Final assessment tab (new)
- Empty state, list of final assessments (Required tag), "+ Add final assessment", same question flow, old quizzes shown here.

### Phase E — Admin: Finish and certificate tab (replaces Completion)
- Mandatory; "The carer finishes the course when" as a summary (required lessons, required module quizzes, final assessments, manager approval, practical sign-off on practical courses).
- Certificate: on/off, valid days, CPD, refresher with the wording in decision 10.

### Phase F — Admin: Review and publish
- Summary in module / quiz wording; problems with "Go to Course outline / Final assessment / Finish and certificate"; existing confirm popup and version history.

### Phase G — Tests and live check
- Update and re-run the E2E script (modules, required / optional quizzes, final gate, fail rule); admin walk-through of every mockup state; results in `LEARNING_COURSE_AUTHORING_TEST_RESULTS.md`.

## Open point (small)

- Should a **module quiz** also wait until that module's required lessons are done? My suggestion: yes, same idea as the final gate.

## Risks

- Completion and fail rules change how assignments finish. Covered by unit tests and the E2E run. Carers already on a published version keep that version's quizzes.
- The migration is additive; old rows stay valid. Live database is not touched until you say so.
