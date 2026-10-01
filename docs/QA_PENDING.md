# QA Pending Items

Items found during go-live QA that were reviewed and deliberately **deferred**. Each entry records the evidence, the options discussed and the decision status, so it can be picked up later without re-investigation.

---

## P-001 — "Pending confirmation" carer can clock in before a manager confirms

- **Found:** 2026-10-01 local QA (visits agent, issue #89 in the QA list)
- **Area:** Scheduling / job allocations → carer app clock-in
- **Status:** Deferred (product owner: skip for now)

**What happens today**

1. Admin assigns a carer and the allocation checks raise a *soft* warning — e.g. carer on holiday (`EMPLOYEE_ON_HOLIDAY`), outside working pattern (`EMPLOYEE_NOT_AVAILABLE`), over weekly hours (`CAPACITY_EXCEEDED`), role mismatch (`ROLE_MISMATCH`), compliance expiring (`COMPLIANCE_WARNING`), non-core activity (`EMPLOYEE_ON_NCA`).
2. The allocation is saved as `PENDING_CONFIRMATION` (`src/job-allocations/job-allocations.service.ts:120-127`). A user with `job_allocations.confirm` must press **Confirm** in the allocate dialog (`careflow-admin/.../ScheduleJobAllocateDialog.tsx`).
3. Before that confirmation, the visit already appears in the carer app and the carer can clock in and complete it (reproduced by QA via the carer API).

Hard blocks (`TIME_CONFLICT`, `BLOCKED_CARER`, `COMPLIANCE_BLOCK`) are not affected — those cannot be assigned at all.

**Options discussed**

- **A (recommended):** show the visit in the app as "Awaiting office confirmation" and block clock-in until confirmed.
- **B:** keep current behaviour.

**Decision:** pending.

---

## Lead / support carer — follow-ups from live test (2026-10-01)

Found while live-testing the lead-carer and support clock-out changes in admin (Chrome) and the carer app (Android). All **deferred** by the product owner.

| ID | Issue | Area | Evidence / notes |
|---|---|---|---|
| P-002 | Admin "Record visit" has no per-carer **"Did not attend"**. It requires actual start/end for every carer ("Enter carer times — Each assigned carer needs a valid actual start and end time"), pre-fills the absent carer's start with the planned time, and leaves the attending carer's actual end blank. Closing a visit from admin therefore pays the absent carer and bypasses the "absent carer → pay held for review" rule. | Admin scheduling / billing | Reproduced on Fatima Al-Rashid morning visit `a2e31f7a…` (Liam never clocked in). Proposed: per-carer "Did not attend" tick → no times required, pay held + flagged. |
| P-003 | Old multi-carer visits with **no lead saved** now use "first assigned = lead". A visit where the first-assigned carer had already clocked out as support stayed "In progress" on their phone until the office pressed **Set lead**. Same will happen to legacy live data. | Data / carer app | Fatima `a2e31f7a…`: Amina (first assigned) became lead after the fix. Backfill was declined; consider a deploy checklist item. |
| P-004 | **Replace / drag of the lead sends an extra push**: the remaining carer gets "You are now the lead carer", then a few seconds later "<New carer> is now the lead carer". The remove + add calls exceed the 3 s debounce. | Notifications | Triple `dd3810c1…` server log: two lead-change pushes. |
| P-005 | An **open visit on the phone does not refresh** on a "lead changed" (VISIT_CHANGE) push. | Carer app | One-line fix: add the visit-change kind to the refresh set in `care_employee/lib/core/notifications/open_visit_office_push.dart`. |
| P-006 | Replacement list ("Change to") **offers carers already on this visit**. | Admin allocate dialog | Seen on triple `dd3810c1…` (Eleanor, Amina listed). |
| P-007 | **Assigned carer rows re-order after every action** (confirm / set lead), causing mis-clicks. | Admin allocate dialog | Caused a wrong "Set lead" click during the test. |
| P-008 | Dialog **refresh is slow (3–10 s)** after confirm / set lead / save; right after a team save it briefly shows "No carers on this job yet" and red "Select N more carers", so it looks like the save failed. | Admin allocate dialog | Observed on both test jobs. |
| P-009 | Once, clicking **Select** in the carer **search results** closed the dialog (nothing saved). Not reproduced. | Admin allocate dialog | Double `946b5202…`. |
| P-010 | When replacing the lead, the **"Assign as lead carer" checkbox shows unticked** although the new carer does become lead. | Admin allocate dialog | Misleading UI only. |
| P-011 | Visit workspace shows **"Not in yet"** for a carer who clocked in and out. | Admin visit workspace | Fatima `a2e31f7a…`, Amina 10:05–10:07. |
| P-012 | **MAR tab** does not tell a support carer that only the lead can record medicines (Tasks tab does). | Carer app | Server already blocks (403 `SUPPORT_READ_ONLY`). |
| P-013 | A support carer can write a **visit note before clocking in**. Decide whether notes require being on the visit. | Carer app / API | `POST /employee-app/visits/285563d0…/log/notes` → 201 while not clocked in. |
| P-014 | **Incident register** record does not store the writer's role (Lead/Support). Needs a schema change. | Incidents | Notes/handover/concerns already store role. |
| P-015 | **Push notifications not delivered locally** — FCM "invalid_grant: Invalid JWT Signature". Check the service-account key. | Notifications / config | QA list issue #27. |
| P-016 | **IA recommendation card not shown on first open** of a new care plan (e.g. Medication) until "Refresh from IA / profile" is clicked; a manager could miss the recommendation. | Admin care plans | Robert Chen Medication plan. |
