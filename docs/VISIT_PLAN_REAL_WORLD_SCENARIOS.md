# Visit plan & rota — real-world scenario playbook

**Audience:** Coordinators, clinical leads, commissioners, product/engineering  
**Purpose:** For each common (and edge) situation, document **what to do in Careflow**, **what happens to the rota**, and **what CQC / stakeholders expect**.  
**Status:** Reflects platform behaviour as of visit-plan scheduled end + schedule lifecycle Phase 2 (see gaps column for not-yet-built items).

**Related docs**

- [VISIT_PLAN_PAUSE_ENTERPRISE.md](./VISIT_PLAN_PAUSE_ENTERPRISE.md) — suspend/end APIs
- [SCHEDULE_LIFECYCLE_IMPACT_ROADMAP.md](./SCHEDULE_LIFECYCLE_IMPACT_ROADMAP.md) — rota impact service
- [VISIT_PLAN_ENTERPRISE_ROADMAP.md](./VISIT_PLAN_ENTERPRISE_ROADMAP.md) — slot lifecycle, carer sync
- [VISIT_PLAN_CONFIRMATION_UX.md](./VISIT_PLAN_CONFIRMATION_UX.md) — where to confirm / preview / ask questions

---

## 1. How to read this document

| Column | Meaning |
|--------|---------|
| **Scenario** | What happened in real life |
| **Careflow action** | What staff should record (UI / API) |
| **Visit plan** | Effect on authorised package (status, generation, slots) |
| **Rota / scheduled visits** | Effect on `ScheduledJob` / `ScheduledVisit` |
| **Carers** | Allocations, hours, cover |
| **Service user / care** | Visits that should (or should not) happen |
| **CQC / audit** | Record-keeping expectations (Reg 9 person-centred, Reg 17 accurate/contemporaneous) |
| **Other stakeholders** | Family, commissioner, finance |
| **Today in Careflow** | ✅ implemented · ⚠️ partial · ❌ not automated |

### Three layers of “truth”

| Layer | What it means | Typical change trigger |
|-------|----------------|------------------------|
| **Visit plan** | Commissioner-authorised **pattern** (slots, times, carers, care-plan links) | Assessment, review, contract change |
| **Absence** | **Client** not available for visits on known dates | Hospital, holiday, family away |
| **Rota** | **Operational** jobs on the scheduling board | Generate from plan, allocate carers, visit outcomes |

**Rule:** Client absent → usually **cancel** client jobs. Carer absent → usually **unallocate** (visit may still need **cover**). Package suspended → **no new generation**; optional **cancel** future client jobs.

### Job statuses auto-impact can touch

`DRAFT`, `UNALLOCATED`, `ALLOCATED`, `NEEDS_ATTENTION` — cancelled or unallocated.

**Never auto-modified:** `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `CALLED_OFF`, `MISSED` (governance / manual follow-up).

---

## 2. Creating and configuring visit plans

### 2.1 New client — first visit plan (draft)

| | |
|--|--|
| **Scenario** | Assessment agreed; weekly hours on DOM Care profile; no live package yet. |
| **Careflow action** | Set up visits → create **draft** → configure slots, carers, hours → **Activate**. |
| **Visit plan** | Draft → **ACTIVE**; `effectiveFrom` set on first activation; any previous ACTIVE plan **ENDED**. |
| **Rota** | No automatic jobs until **Generate rota** (Step 5). |
| **Carers** | Plan stores preferred/assigned carers; rota allocations only after generate + sync. |
| **Service user** | No visits until rota built. |
| **CQC / audit** | Activation reason via amendment trail; contracted hours required before create. |
| **Stakeholders** | Commissioner: package matches authorised hours. |
| **Today** | ✅ |

### 2.2 Different slots on different weekdays (e.g. Mon/Wed/Fri morning only)

| | |
|--|--|
| **Scenario** | Client needs morning call 3 days/week, not daily. |
| **Careflow action** | Enable slot → set **days of week** on slot (or carer-by-day assignments). |
| **Visit plan** | Recurrence stored on slot; `generateSchedule` only creates jobs on matching days. |
| **Rota** | Existing jobs on removed days are **not** auto-deleted when plan amended (coordinator must cancel or regenerate range). |
| **Carers** | Carer-by-day: different lead on Tue vs Thu possible. |
| **CQC** | Plan reflects person-centred agreement; amendment reason if live package changed. |
| **Today** | ✅ generation respects days · ⚠️ amending days does not bulk-cancel old pattern (manual/coordinator) |

### 2.3 Different carers on different days (same slot)

| | |
|--|--|
| **Scenario** | Mon/Wed regular carer; Fri alternate carer. |
| **Careflow action** | Slot → **Carer by day** assignments (LEAD/SECONDARY, optional times/duration). |
| **Visit plan** | `VisitPlanSlotCarerAssignment` per `dayOfWeek`. |
| **Rota** | On **generate**, allocations follow assignment for that weekday. On **plan update**, `syncVisitPlanSlotCarersToScheduledJobs` updates future jobs from **today** forward for that slot. |
| **Carers** | Previous carer may remain on past dates; future dates sync to plan. |
| **CQC** | Amendment audited; who is expected to visit should match rota. |
| **Today** | ✅ sync on update/generate · ⚠️ no automatic unallocate of removed carer on past cancellable jobs if not in sync window |

### 2.4 Double-up (2 carers, asymmetric duration)

| | |
|--|--|
| **Scenario** | 60 min personal care + 30 min second carer. |
| **Careflow action** | `requiredCarers: 2`; carer assignments with different `durationMinutes` / times. |
| **Visit plan** | Single slot occurrence; duration logic uses union window. |
| **Rota** | One job; two allocations with per-carer windows when configured. |
| **Carers** | Both must be allocated for `ALLOCATED` status. |
| **Today** | ✅ |

### 2.5 Slot effective dates (slot starts/stops mid-contract)

| | |
|--|--|
| **Scenario** | Evening call added from 1 July only. |
| **Careflow action** | Slot lifecycle → `slotEffectiveFrom` = 1 July. |
| **Visit plan** | Slot ignored before that date in occurrence logic. |
| **Rota** | Generate from July creates jobs; jobs before July not auto-created. Pre-July jobs if wrongly generated → manual cancel. |
| **Today** | ✅ on generate · ⚠️ no retroactive auto-cancel when adding effectiveFrom |

### 2.6 One-off visit (single date)

| | |
|--|--|
| **Scenario** | Extra assessment visit on one Tuesday. |
| **Careflow action** | Slot kind **ONE_OFF** + `oneOffDate`, or **EXTRA** exception on that date. |
| **Visit plan** | Occurrence only on that calendar day. |
| **Rota** | Appears when generate range includes that day. |
| **Today** | ✅ |

### 2.7 SKIP exception (skip one day without absence record)

| | |
|--|--|
| **Scenario** | Client refuses one visit; package still active. |
| **Careflow action** | Slot → exception **SKIP** on date (or Record Absence for audit-heavy cases). |
| **Visit plan** | `generateSchedule` skips that day for that slot. |
| **Rota** | Existing job for that slot/day **not** auto-cancelled by SKIP alone — coordinator should cancel on board or use absence with `applyToSchedule`. |
| **CQC** | Document why visit missed; exception or absence + note. |
| **Today** | ✅ skip on generate · ⚠️ existing job needs manual cancel or absence |

### 2.8 Draft saved but not activated

| | |
|--|--|
| **Scenario** | Coordinator building package; not yet commissioner-signed. |
| **Careflow action** | **Save draft** only. |
| **Visit plan** | `DRAFT` — not authorised. |
| **Rota** | **Generate blocked** (ACTIVE only). |
| **Today** | ✅ |

### 2.9 Replace entire package (new plan version)

| | |
|--|--|
| **Scenario** | Contract changes from 2 calls/day to 3 calls/day. |
| **Careflow action** | Amend live plan **or** create new draft → **Activate** (ends previous ACTIVE). |
| **Visit plan** | Old plan `ENDED` with `effectiveTo`; new plan `ACTIVE`. |
| **Rota** | Old plan’s future jobs **not** auto-cancelled on activate — coordinator should end old pattern jobs or generate only from new plan after cancelling overlap. |
| **CQC** | Amendment snapshots; clear effective dates. |
| **Commissioner** | New hours/pattern match authorisation. |
| **Today** | ✅ version history · ⚠️ overlap period needs coordinator cleanup |

---

## 3. Generating and amending the rota

### 3.1 Generate rota (first time, 14–31 days)

| | |
|--|--|
| **Scenario** | Package activated; need visits on scheduling board. |
| **Careflow action** | Set up visits → Step 5 **Generate visits** (from/to, optional backfill). |
| **Visit plan** | Must be **ACTIVE**; respects `effectiveTo`, absences on day, SKIP exceptions, slot dates. |
| **Rota** | Creates `ScheduledVisit` + `ScheduledJob`; assigns carers from plan when configured. |
| **Carers** | Allocations created; conflicts surface as `NEEDS_ATTENTION`. |
| **Today** | ✅ |

### 3.2 Generate while client has absence in range

| | |
|--|--|
| **Scenario** | Hospital absence next week already recorded. |
| **Careflow action** | Generate as normal. |
| **Visit plan** | Active. |
| **Rota** | **No jobs** created on absent days (generate skips). |
| **Today** | ✅ |

### 3.3 Amend live plan — change visit time

| | |
|--|--|
| **Scenario** | Morning call moves 08:00 → 09:00. |
| **Careflow action** | **Record amendment** with reason; save slot times. |
| **Visit plan** | Updated; amendment snapshot. |
| **Rota** | **Existing jobs keep old times** (Phase 2 roadmap: plan → rota time sync not fully built). New generates use new times. |
| **CQC** | Amendment reason required. |
| **Today** | ⚠️ manual reschedule on board for existing jobs |

### 3.4 Amend live plan — change assigned carer

| | |
|--|--|
| **Scenario** | New lead carer from Monday. |
| **Careflow action** | Update carer assignment / by-day roster → save amendment. |
| **Visit plan** | Updated. |
| **Rota** | **Sync** runs from **start of today** for that slot: future allocations updated on cancellable jobs. |
| **Carers** | Old carer may still show on today/past unless manually changed. |
| **Today** | ✅ forward sync · ⚠️ not backdated unless backfill + regenerate |

### 3.5 Amend live plan — disable a slot

| | |
|--|--|
| **Scenario** | Evening call removed from contract. |
| **Careflow action** | Disable slot → amendment. |
| **Visit plan** | Slot `isEnabled: false`. |
| **Rota** | Future jobs for that slot **not** auto-cancelled. |
| **Coordinator** | Cancel future evening jobs on scheduling board or bulk via absence/end if whole package changes. |
| **Today** | ⚠️ manual rota cleanup |

### 3.6 Backfill generation (past days)

| | |
|--|--|
| **Scenario** | Plan activated late; need last week on rota for billing. |
| **Careflow action** | Generate with **backfill days** (capped per slot `allowBackfillDays`). |
| **Rota** | Creates jobs in past range if slot allows backfill. |
| **CQC** | Backfill is auditable; only use when legitimately needed, not to fabricate visits. |
| **Today** | ✅ |

---

## 4. Client absence (service user not available)

Use **Record Absences** when the **client** cannot receive visits for a **known date range**. Prefer over package suspend for hospital/holiday.

| Absence type | Typical use | Job outcome when `applyToSchedule` |
|--------------|-------------|-------------------------------------|
| **Planned** | Pre-booked holiday | **CANCELLED** |
| **Unplanned** | Sudden not at home | **CALLED_OFF** |
| **Not applicable** | Default | **CALLED_OFF** unless reason matches hospital/respite → **CANCELLED** |

### 4.1 Hospital admission (planned, with discharge date)

| | |
|--|--|
| **Careflow action** | Absence: hospital reason, start = admission, end = expected discharge; `applyToSchedule` ✅. |
| **Visit plan** | Stays **ACTIVE** (unless commissioner requires full suspend). Optional: **Suspend** + cancel future to block regeneration. |
| **Rota** | Cancellable jobs in range **cancelled**; plan **SKIP** exceptions added for active plan slots on those days. |
| **Carers** | Jobs cancelled — no visit; carer freed (may be redeployed). |
| **Service user** | No domiciliary visits while inpatient; **welfare/contingency** documented (ward care, meds). |
| **CQC** | Absence reason, dates, retrospective note if backdated; missed-visit follow-up if visits ran before absence recorded. |
| **Family** | Share outcome settings per slot if visit would have been shared. |
| **Today** | ✅ |

### 4.2 Hospital — open-ended (discharge unknown)

| | |
|--|--|
| **Careflow action** | Absence with start, no end; review date operationally. |
| **Rota** | Cancels up to **365-day cap** from start (open-ended impact limit). |
| **Today** | ✅ |

### 4.3 Holiday / family away (short break)

| | |
|--|--|
| **Careflow action** | Absence with end date; planned type. |
| **Visit plan** | Active. |
| **Rota** | Cancel in range. |
| **CQC** | Person-centred choice to pause visits. |
| **Today** | ✅ |

### 4.4 Backdated absence (visits should not have run)

| | |
|--|--|
| **Careflow action** | Absence with **past start** + mandatory **retrospective reason**. |
| **Rota** | Cancels **cancellable** jobs from start date — **not** completed/in-progress. |
| **CQC** | Retrospective reason = why recorded late; welfare review for gap; do not alter completed visit notes to pretend care did not happen. |
| **Finance** | Billing adjustment outside system may be needed. |
| **Today** | ✅ cancellable only · manual governance for completed visits |

### 4.5 Future-dated absence

| | |
|--|--|
| **Careflow action** | Start date in future; `applyToSchedule` cancels from that date forward. |
| **Rota** | Jobs from start date cancelled (including already-generated future jobs). |
| **Today** | ✅ |

### 4.6 Absence without apply to schedule

| | |
|--|--|
| **Careflow action** | Uncheck apply to schedule (audit only). |
| **Rota** | **No change**; coordinator must manage board manually. |
| **Use when** | Recording information before rota decision; dispute investigation. |
| **Today** | ✅ |

### 4.7 End absence / return home

| | |
|--|--|
| **Careflow action** | Set absence end date or delete absence (per policy). |
| **Visit plan** | Still active if was never suspended. |
| **Rota** | **Does not auto-reinstate** cancelled jobs (Phase 3 gap). **Generate** from return date. |
| **Carers** | Re-allocate on board or via plan carers. |
| **Today** | ⚠️ manual regenerate · ❌ auto-reinstate |

---

## 5. Visit plan suspension (package pause)

Use when the **whole authorised package** must stop until **manual re-activation** — not a simple dated absence.

**Catalog reasons (seeded):** `HOSPITAL`, `HOLIDAY` (suggest absence), `FUNDING`, `SAFEGUARDING`, `COMMISSIONER`, `SERVICE_REVIEW`, `OTHER`.

### 5.1 Funding / commissioning review (indefinite)

| | |
|--|--|
| **Careflow action** | **Suspend** → reason catalog **FUNDING** → detail + contingency → review due (default +7d) → optional cancel future visits. |
| **Visit plan** | `SUSPENDED`; blocks `generateSchedule`. |
| **Rota** | If cancel: jobs cancelled from **effectiveFrom** (today or backdated). |
| **Carers** | Visits cancelled; carers need other work. |
| **CQC** | Reason, review date, welfare/contingency; proportionate pause. |
| **Commissioner** | Embargo until funding confirmed. |
| **Today** | ✅ |

### 5.2 Safeguarding / risk management

| | |
|--|--|
| **Careflow action** | Suspend **SAFEGUARDING**; document contingency and review. |
| **Visit plan** | Suspended until re-activate (not automatic on review date). |
| **Rota** | Cancel future if selected. |
| **CQC** | Strong audit trail; multi-agency notes may live outside Careflow. |
| **Today** | ✅ |

### 5.3 Commissioner embargo

| | |
|--|--|
| **Careflow action** | Suspend **COMMISSIONER**; expected resume if known. |
| **Stakeholders** | Commissioner notified; no billed visits until cleared. |
| **Today** | ✅ |

### 5.4 Hospital — wrong tool if dates known

| | |
|--|--|
| **Careflow action** | Prefer **Record Absences** (catalog suggests this). Suspend only if package must stay off after discharge until clinical re-activation. |
| **Why** | Absence = dated client unavailable; Suspend = operational halt + no generate until human re-activate. |
| **Today** | ✅ UI warns when pause reason suggests absence |

### 5.5 Suspension with backdated effectiveFrom

| | |
|--|--|
| **Careflow action** | Suspend with **past** effectiveFrom + **retrospective reason**. |
| **Rota** | Cancel cancellable jobs from that date. |
| **CQC** | Retrospective correction documented separately from `suspendedAt` audit timestamp. |
| **Today** | ✅ |

### 5.6 Suspend without cancelling rota

| | |
|--|--|
| **Careflow action** | Uncheck cancel future visits. |
| **Visit plan** | Suspended; generate blocked. |
| **Rota** | Jobs may remain on board — **high risk** of missed visits showing as still due. |
| **Use when** | Rare; coordinator cleaning board manually. |
| **Today** | ✅ |

### 5.7 Re-activate after suspension

| | |
|--|--|
| **Careflow action** | **Re-activate package** (+ optional reason) → **Generate rota** from resume date. |
| **Visit plan** | `ACTIVE`; suspension fields cleared; `effectiveTo` cleared. |
| **Rota** | New jobs from generate; does not restore old cancelled jobs. |
| **CQC** | Reactivation event in status history. |
| **Today** | ✅ |

### 5.8 Suspension review due overdue (no auto-action)

| | |
|--|--|
| **Scenario** | Review date passed; package still suspended. |
| **Careflow action** | Operational task: review welfare, commissioner, re-activate or end. |
| **Today** | ❌ no dashboard alert yet (field stored: `suspensionReviewDueAt`) |

---

## 6. Ending the visit plan (permanent closure)

### 6.1 End today — client moves to residential / dies / contract ends now

| | |
|--|--|
| **Careflow action** | **End package** → reason → effectiveTo = today → cancel visits ✅. |
| **Visit plan** | `ENDED`; `effectiveTo` set; not editable. |
| **Rota** | Cancels cancellable jobs from today forward. |
| **Carers** | Freed from future visits. |
| **CQC** | End reason; care plan / pathway updates elsewhere. |
| **Commissioner** | Closure notification per contract. |
| **Today** | ✅ |

### 6.2 Scheduled closure (future effectiveTo)

| | |
|--|--|
| **Scenario** | Commissioner confirms package ends 30 June; visits continue until then. |
| **Careflow action** | End dialog → last day = 30 June → **Schedule closure**. |
| **Visit plan** | Stays **ACTIVE** until end date; `effectiveTo` set; `SCHEDULED_END` event. |
| **Rota** | Optional cancel from 30 June forward; visits until 29 June still valid. Generate respects `effectiveTo`. |
| **Today** | ✅ |

### 6.3 Backdated end

| | |
|--|--|
| **Careflow action** | End with past effectiveTo + retrospective reason. |
| **Rota** | Cancel cancellable jobs from that date. |
| **CQC** | Correction record; completed visits need incident/missed-visit process, not silent delete. |
| **Today** | ✅ |

### 6.4 New package after end

| | |
|--|--|
| **Careflow action** | Create new draft → activate (or activate draft after end). |
| **Visit plan** | New `ACTIVE` plan; old `ENDED`. |
| **Rota** | Generate from new plan only. |
| **Today** | ✅ |

---

## 7. Carer-side events (employee unavailable)

These affect **allocations**, not necessarily the visit plan.

### 7.1 Carer planned annual leave

| | |
|--|--|
| **Careflow action** | Employee holiday + `applyToSchedule`. |
| **Visit plan** | Unchanged. |
| **Rota** | **Unallocate** carer from jobs in range; jobs → `UNALLOCATED` / `NEEDS_ATTENTION`. |
| **Carers** | Other carers need cover; suggest-carers on plan slot. |
| **Service user** | Visit may still be required — **cover** visit. |
| **Today** | ✅ unallocate · coordinator reallocates |

### 7.2 Carer sick (unplanned)

| | |
|--|--|
| **Careflow action** | Unplanned holiday/NCA or employee inactive. |
| **Rota** | Unallocate from future jobs. |
| **CQC** | Cover arranged; missed visit policy if no cover. |
| **Today** | ✅ |

### 7.3 Carer removed from plan slot only

| | |
|--|--|
| **Careflow action** | Amend plan → remove carer from slot/by-day. |
| **Rota** | Forward sync updates allocations from today on that slot. |
| **Today** | ✅ forward only |

### 7.4 Preferred carer blocked / compliance issue

| | |
|--|--|
| **Careflow action** | Allocate on board; suggest-carers shows fit/warnings. |
| **Rota** | Allocation checks may block per org rules. |
| **Today** | ✅ suggest + allocation checks |

---

## 8. Combined and edge scenarios

### 8.1 Hospital + suspend package (belt and braces)

| | |
|--|--|
| **Scenario** | Ensure no visits regenerate while inpatient. |
| **Careflow action** | Absence (dates) **then** Suspend + cancel future. |
| **Risk** | Double cancellation attempt — harmless for already cancelled jobs. |
| **Today** | ✅ |

### 8.2 Suspended plan but absence ended

| | |
|--|--|
| **Scenario** | Absence ended but forgot to re-activate package. |
| **Rota** | Generate **blocked** until re-activate even if absence cleared. |
| **Action** | Re-activate → generate. |
| **Today** | ✅ by design |

### 8.3 Visit in progress when absence recorded

| | |
|--|--|
| **Rota** | **IN_PROGRESS** not auto-cancelled. |
| **Action** | Carer completes or call-off manually; document outcome. |
| **CQC** | Actual care delivered matches visit record. |
| **Today** | ✅ safe default |

### 8.4 Completed visit then backdated absence

| | |
|--|--|
| **Rota** | Completed jobs **unchanged**. |
| **Action** | Clinical/commercial correction; incident if visit should not have occurred. |
| **Today** | ✅ no auto-delete of outcomes |

### 8.5 Two plan versions — old ended, new active

| | |
|--|--|
| **Review** | Call pattern tab + version picker: compare slots. |
| **Rota** | Jobs link to `visitPlanSlotId` from plan version at generation time. |
| **Calendar** | Shows visits for **selected** plan version. |
| **Today** | ✅ |

### 8.6 EXTRA exception (additional visit one day)

| | |
|--|--|
| **Careflow action** | Slot exception EXTRA on date. |
| **Rota** | Generate creates additional occurrence if rules match. |
| **Today** | ✅ on generate |

### 8.7 Commissioner reduces hours (same slots, fewer days)

| | |
|--|--|
| **Careflow action** | Amendment → reduce `daysOfWeek` + verify weekly hours panel. |
| **Rota** | Clean up orphaned future jobs on dropped days manually. |
| **Commissioner** | Hours match new authorisation. |
| **Today** | ⚠️ manual rota cleanup |

### 8.8 Bank holiday / org-wide no service

| | |
|--|--|
| **Today** | ❌ not built — manual cancel or skip exceptions at scale |

---

## 9. Stakeholder quick reference

| Stakeholder | Primary Careflow artefacts | What they care about |
|-------------|---------------------------|----------------------|
| **Service user / family** | Care plans, visit outcomes, share-with-family flags | Predictable visits, dignity, communication |
| **Coordinator** | Rota board, absences, generate, suspend | Cover, reliability, no phantom visits |
| **Registered manager** | Audit log, amendments, suspension review dates | CQC, safeguarding, governance |
| **CQC inspector** | Amendments, status events, contemporaneous records | Person-centred plan, missed visit follow-up, accurate records |
| **Commissioner** | Contract hours, effective dates, end/suspend reasons | Billing alignment, authorised package |
| **Carer** | Allocations, times, visit app | Clear roster, no surprise visits |
| **Finance** | Job outcomes CANCELLED vs CALLED_OFF, completed visits | Invoice accuracy |

---

## 10. CQC themes mapped to actions

| Theme | Careflow support | Gap / manual process |
|-------|------------------|----------------------|
| **Person-centred plan** | Visit plan slots + care-plan links + amendments | Clinical care plan module separate |
| **Records accurate & contemporaneous** | Audit log, amendment snapshots, status events, retrospective fields | Backdated changes need explicit retrospective reason |
| **Missed / late visits** | Call-off vs cancel; visit outcomes on calendar | No auto welfare task on bulk cancel |
| **Safeguarding** | Suspend reason catalog + contingency notes | External safeguarding system |
| **Review of care** | `reviewDueAt`, suspension review due | No overdue review dashboard yet |
| **Rota reliability evidence** | Scheduling board + job status history | — |

---

## 11. Product gaps summary (prioritised)

| Gap | User impact | Scenario refs |
|-----|-------------|----------------|
| No auto-reinstate jobs when absence ends | Coordinator must regenerate | 4.7 |
| Plan time change does not update existing jobs | Manual reschedule | 3.3 |
| Disabling slot does not cancel future jobs | Manual cancel | 3.5 |
| Activate new plan does not cancel old plan jobs | Overlap visits | 2.9 |
| No bank holiday calendar | Bulk manual handling | 8.8 |
| Suspension review overdue — no alert | Governance risk | 5.8 |
| SKIP exception does not cancel existing job | Phantom visit on board | 2.7 |
| Scheduled end — no auto-end on date (cron) | Plan stays ACTIVE until manual end | 6.2 (partial — generate stops after date) |

---

## 12. Decision tree (coordinator)

```text
Client will not be home for known dates?
  → Record Absences (apply to schedule)
  → If package must not resume automatically → also Suspend

Funding/safeguarding/commissioner halt with unknown return?
  → Suspend package (review due, contingency)
  → Cancel future visits unless you need board visibility

Contract permanently ends?
  → End package (today or scheduled last day)

Only carer unavailable?
  → Employee holiday / NCA (unallocate)
  → Reassign on board or update plan carers

Change call pattern going forward?
  → Record amendment on live plan
  → Sync carers for future; manually fix times/old days if needed
  → Generate for new date range

Client returned from hospital?
  → End absence
  → Re-activate if suspended
  → Generate from return date
```

---

## 13. Rota impact — now vs ideal (summary matrix)

Legend: **Now** = Careflow today · **Ideal** = enterprise target · **Δ** = gap to build

### A. Plan setup & generation

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Activate draft (first package) | No jobs until manual **Generate** | Same — deliberate coordinator step | — |
| Activate new plan (replaces old) | Old plan ended; **old future jobs remain** on board | Preview + cancel all future jobs tied to **ended plan** (or superseded slots) | Auto cleanup on activate |
| Generate 14–31 days | Creates visits/jobs; assigns carers from plan; skips absent days | Same + conflict warnings surfaced | Minor UX |
| Generate with backfill | Creates past jobs within slot backfill caps | Same + audit banner on board | — |
| Plan `effectiveTo` / scheduled closure | Generate stops after last day; optional cancel from end date | Same + **auto-end** plan status on last day (night job) | Cron / scheduler |
| SKIP exception added | **No effect** on existing jobs; only skips on next generate | Cancel or call-off **existing** job for that slot/date (preview first) | Impact on SKIP save |
| EXTRA exception added | Only on next generate | Optional **create** job immediately (with approval) | Exception workflow |

### B. Live plan amendments (pattern still active)

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Change visit **time** on slot | **Existing jobs keep old times** | Reschedule future cancellable jobs to new window (preview) | Plan → rota time sync |
| Change **days of week** (drop Tue) | Future Tue jobs **stay** on board | Cancel future jobs on dropped weekdays (preview) | Amendment impact service |
| **Disable** slot | Future jobs for slot **remain** | Cancel all future jobs for that `visitPlanSlotId` | Slot disable hook |
| Change **assigned carer** (forward) | Sync allocations from **today** on that slot | Same + optional from amendment effective date | Backdated sync option |
| Remove carer from slot | Forward sync; may not unallocate removed carer on all jobs | Unallocate removed carer; flag job needs cover if under-staffed | Fuller sync |
| Slot `effectiveFrom` in future | Generate respects date | Same + cancel any pre-date jobs if wrongly created | Rare edge auto-fix |

### C. Client absence (service user)

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Planned absence + apply | **Cancel** cancellable jobs in range; SKIP exceptions on plan | Same | — |
| Unplanned absence + apply | **Call-off** cancellable jobs | Same | — |
| Future-dated absence | Cancel from start date forward (preview available) | Same | — |
| Backdated absence | Cancel cancellable only; **completed untouched** | Same (completed stays); optional **missed visit** task | Welfare workflow |
| Open-ended absence | Cancel up to 365-day cap | Same; coordinator review before cap | Alert before cap |
| Absence **without** apply | **No rota change** | Same (explicit opt-out) | — |
| **End absence** / return home | **No reinstate**; coordinator regenerates | Offer: regenerate from return date **or** reinstate cancelled jobs if still valid | Auto-reinstate option |
| Hospital absence | Prefer absence over suspend; cancel + SKIP sync | Same | — |

### D. Package suspension

| Pause type | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Funding / safeguarding / commissioner (indefinite) | **Suspend** blocks generate; optional **cancel** from effectiveFrom | Same + review-due **dashboard alert** | Overdue review UI |
| Hospital (wrong tool if dated) | UI steers to absence; suspend cancels if chosen | Same guidance | — |
| Suspend + cancel (default) | Cancel cancellable jobs from effective date (preview) | Same | — |
| Suspend **without** cancel | Jobs remain — **phantom visits** risk | Warn strongly; board badge “package suspended” | Board badges |
| Backdated suspend | Cancel from past effectiveFrom | Same | — |
| **Re-activate** | No auto jobs; must **Generate** | Same or optional “regenerate from tomorrow” one-click | UX shortcut |
| `expectedResumeAt` set | **No auto** resume on date | Optional reminder / suggest re-activate (not auto without human) | Notification |

### E. Package end

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| End today + cancel | Cancel from today forward | Same | — |
| Scheduled closure (future last day) | Cancel from last day forward; visits until day before OK | Same + plan auto-**ENDED** after last day | Status cron |
| Backdated end | Cancel cancellable from effective date | Same | — |

### F. Carer unavailable (employee)

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Planned holiday + apply | **Unallocate** carer; job needs cover | Same + suggest cover carers | Partial (suggest exists) |
| Sick / unplanned / NCA | Unallocate future jobs | Same | — |
| Employee inactive / suspended | Unallocate future jobs | Same | — |
| Blocked on allocate | Warning/block per org rules | Same | — |

### G. Safety rules (should never change)

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Visit **in progress** when absence/suspend/end | **Not** auto-cancelled | Same — manual outcome | — |
| Visit **completed** then backdated stop | **Not** auto-altered | Same — governance / billing correction | — |
| Double cancel (absence + suspend) | Harmless on already cancelled | Same | — |

### H. Org-wide / scale

| Scenario | Now (rota) | Ideal (rota) | Δ |
|----------|------------|--------------|---|
| Bank holiday | Manual cancel or per-client absence | Org calendar → bulk cancel or skip generate | Bank holiday module |
| Bulk commissioner closure | Per-client end | Bulk end with preview | Bulk ops tool |

### Ideal principles (rota layer)

1. **One operational truth** — board matches who should be visited, when, and by whom.
2. **Preview before bulk impact** — coordinator confirms counts (already on absence/end/suspend).
3. **Correct verb** — client away = **cancel** job; carer away = **unallocate** (visit may need cover).
4. **Plan change propagates forward** — amendments reshape **future** rota, not history.
5. **Never silently edit completed care** — corrections are explicit audit events.
6. **Reinstate is opt-in** — return from absence should offer regenerate, not blindly restore wrong pattern.

---

*Document maintainer: update this file when schedule lifecycle or visit-plan APIs change.*
