# Visit tasks by time: edge cases

Last updated 5 Oct 2026. These are the edge cases found while building "visit tasks follow the visit time" and while testing it. Each item says what happens now, the decision if there is one, and a suggested fix.

## What is built (summary)

- **Due time.** Each planned task has a `dueTime` (HH:mm), set in the Tasks Planner. The Add dialog asks for it and pre-fills the client's slot start time. The table has a Due time column.
- **One visit per day.** Each task goes to one visit on the client's day:
  1. A visit whose time covers the task's time gets it.
  2. If two visits cover it (back-to-back, or overlapping), the visit that started later gets it.
  3. If no visit covers it, the nearest visit gets it, labelled "nearest visit". If two are equally near, the earlier one wins.
- **Nearest-visit grace.** Each client has a grace limit for the nearest-visit move. The default is 60 minutes. An empty value means no limit. A task further away than the grace goes to no visit.
- **Cancelled and called-off visits keep their tasks.** The tasks are not moved. The visit page shows "Not done · visit cancelled", and the planner badge shows "Visit cancelled on X of Y days". If a live visit exists at the same time (a replacement), it takes the tasks.
- **Planner warnings for the next 7 days.**
  - A card listing days that have tasks but no visit.
  - A card listing tasks that won't reach any visit.
  - A badge on each task row: "Not linked to any visit · reason" or "Not linked on X of Y days · reason".
- **The eMAR "Medication prompt" is not placed by the task rule.** It follows medicine due times, shows once per visit, and is labelled with the first dose due in that visit.
- **Main code:**
  - `src/visit-tasks/visit-task-window.util.ts` (`placeVisitTasksForDay`, `loadVisitTaskPlacement`)
  - `src/service-user-visit-tasks/service-user-visit-tasks.service.ts` (planner coverage)

---

## A. eMAR / medicines

### A1. A dose on a visit boundary shows on both visits (open)
- **Now:** a dose due at 07:00, with visits 06:00–07:00 and 07:00–08:00, appears in both visits' medicine lists. The Medication prompt also appears on both. The rule counts both the start and the end of a visit (`dueTimeFallsInHmWindow` in `src/service-user-visit-plans/visit-medication-window.util.ts`).
- **Risk:** "given" is checked per day, so the second visit normally shows the dose as given. But the carer app works offline. If the first carer's record hasn't synced, the second carer sees the dose as not given, so there is a **double-dose risk**.
- **Recommended:** use the task rule for medicines. Each dose goes to one visit; on a boundary, the later visit. If only the earlier visit exists, the dose stays on it. Do **not** move medicines to the "nearest visit".
- **Decision:** pending. To be discussed later.

### A2. A dose with no visit covering its time shows nowhere (open)
- **Now:** medicines never move to the nearest visit. A dose outside every visit window appears on no visit, and nothing warns about it.
- **Suggested:** a planner or medication warning such as "Dose 07:30 has no visit on Tue 06/10". Use the same style as the task warnings.

### A3. One prompt when a visit spans two rounds (by design)
- A visit covering both midday and afternoon doses shows **one** Medication prompt. Its label is the first dose due in that visit. The medicine list still shows every dose.

### A4. Old visits made under the old timezone (data)
- The org timezone is now Europe/London. It used to be Asia/Karachi. Visits created before the switch show 4 hours early on London time, for example a 08:00 visit showing as 04:00. That changes which medicines (and tasks) match each visit.
- **Locally:** James Okafor's 5 Oct visits were recreated in London time, without carers allocated. The "LEADTEST" visits (lead/support testing) are still in Karachi time.
- **Before go-live:** check for live data in the same state.

---

## B. Visit tasks

### B1. Task done, then its time is changed, so it shows pending on another visit the same day (open)
- **Example:** washing is done at the 08:00 visit. Later that day, the planner time changes to 19:00. Washing now also shows as pending on the 19:00 visit, and the carer may do it again.
- **Decision (5 Oct):** leave as is for now.
- **Proposed fix:** on the other visit, show it as "Already done today · 08:00 visit" and leave it out of progress. Treat only COMPLETED as done; PARTIAL and DECLINED stay pending, with a note.

### B2. The label on a completed task shows the new planner time (open, minor)
- **Example:** the task was done on the 16:00 visit when it was due 16:30. After the planner time changes to 19:00, that visit shows "Due 19:00".
- **Suggested:** for a completed task, show the due time it had when it was done, or hide the time.

### B3. Overlapping client visits are not checked (open)
- Nothing stops overlapping visits for the same client, for example 06:00–07:00 and 06:30–08:00. Only carer double-booking is checked (`src/job-allocations/allocation-checks.service.ts`).
- For tasks: when visits overlap, the visit that started later gets the task. This is unit-tested, not tested from admin.
- **Decision needed:** add an overlap check? If yes, decide where: visit-plan slots, day visits (manual or drag), or both.

### B4. The slot range is only a label (decision pending)
- Morning shows "07:00–10:00", but a Morning task can have any time, for example 06:00 or 11:00. It still goes to whichever visit covers that time.
- **Decision needed:** keep the due time inside the slot range, or leave it free?

### B5. A task can have only one time per day (open)
- The same task can't be due twice in one round, for example a turn at 06:00 and at 10:00. The unique key is `serviceUserId + medicationRoundCode + taskCatalogueTaskId`.
- **Workaround:** add it in two different rounds.
- **Proper fix:** allow several times per task, the way medicine schedules work.

### B6. Planner warnings only look 7 days ahead (by design)
- The "no visit", "won't reach any visit" and row badges cover today plus 6 days. Problems further ahead are not shown.

### B7. Cancelled visit: resetting a task requires reinstating the visit (existing rule)
- `resetJobTask` refuses with "Reinstate a cancelled visit before resetting a task". This rule existed before this work and was not changed.

### B8. Missed visits keep their tasks (by design, confirm)
- MISSED visits are counted as normal visits, so their tasks count as missed with the visit. Only CANCELLED and CALLED_OFF are treated as cancelled.

---

## C. Not tested yet

- The carer app label ("Due 10:00 · moved to nearest visit", "Not done · visit cancelled") on a real phone or simulator. Only the API response and Flutter analyze were checked.
- The family-portal visit task list. It needs a portal login.
- Time-critical tasks on the admin timeline with the new dueTime. This is covered by code, not by a manual test.

## D. Known test failures, not from this work

- **Backend:** `EmployeeAppAuthService › blocks a second login…` and `employee-app-body-map-pins.util › reads bodyMapPins…`.
- **Admin:** 4 tests in `schedule-jobs-timeline-viewport.util.test.ts` and `schedule-jobs-timeline.util.test.ts`.
