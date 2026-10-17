# Duty of Candour — implementation and test plan

Status: **built 8 Oct 2026** (uncommitted). Decisions: close with a manager's reason when incomplete;
overdue days is a setting, empty (off) by default; decisions need `incidents.review`, steps
`incidents.review` or `incidents.close`. Tested: 14 unit tests, 48 API checks (§8B, all pass), admin
screens in the browser (Review card, close step, Outcome summary, timeline, list filter + badge,
Dashboard tile, settings, phone width). Results letters now fill the Outcome "Outcome shared
with" row for the person told (read-only there; `applyCandourToSharing`). Dark mode not checked by eye.

## 1. What the law requires (Regulation 20, SI 2014/2936)

Source: https://www.legislation.gov.uk/uksi/2014/2936/regulation/20 (checked 8 Oct 2026).

| Reg | Requirement | Where it lands in the system |
|---|---|---|
| 20(1) | Act openly with the "relevant person" | Whole feature |
| 20(2) | Notify **as soon as reasonably practicable** after becoming aware, and give **reasonable support** | Decision at Review; "Told in person" step with support offered; overdue flag |
| 20(3) | Notification **in person**: known facts, further enquiries, **apology**, written record kept | "Told in person" step |
| 20(4) | Followed by **written notification**: same account, enquiries, **results**, apology | "Written follow-up" step + results letter |
| 20(5) | If the person can't be contacted or declines: (2)–(4) don't apply, **record the attempts** | "Couldn't tell them" path with attempts |
| 20(6) | Keep a **copy of all correspondence** | Letter copy required to complete a written step |
| 20(7) | Relevant person = the service user, or someone acting lawfully for them after death, under 16 not competent, or lacking capacity | "Who was told" choices |
| 20(9) | Notifiable safety incident (care providers): unintended/unexpected, and **in the reasonable opinion of a health care professional** caused or needs treatment to prevent: death (not natural course of illness), impairment ≥28 days, change to body structure, prolonged (≥28 days) pain or psychological harm, shortened life expectancy | Decision with harm list + health professional consulted |

Not in the law: a fixed number of days, the format of the letter (post/email both fine), an NHS-style harm scale.

## 2. Scope and principles

- Duty of Candour is about **service users**. Staff-only incidents are "Not applicable" automatically.
- One Duty of Candour record **per affected service user** (an incident can involve more than one).
- Not archived when the review is archived on reopen — it belongs to the incident, not the review cycle.
- Recording steps is **not** a review change, so it doesn't need the review "change reason". Changing or removing a recorded step does need a reason.
- Carer app: no change.
- Existing incidents: show "Not recorded (before Duty of Candour was added)"; no close gate for incidents closed before release.

## 3. Data model (migration `…_incident_duty_of_candour`)

`incidents.IncidentCandour` — one row per incident + service user

| Field | Type | Notes |
|---|---|---|
| id, incidentId, serviceUserId | uuid | unique (incidentId, serviceUserId) |
| decision | `YES` / `NO` / `NOT_KNOWN` / `NOT_APPLICABLE` | |
| decisionReason | text | required for NO and NOT_APPLICABLE |
| harmTypes | text[] | from the 20(9) list: `DEATH`, `IMPAIRMENT_28_DAYS`, `BODY_STRUCTURE_CHANGE`, `PROLONGED_PAIN`, `PROLONGED_PSYCH_HARM`, `SHORTENED_LIFE`, `TREATMENT_TO_PREVENT`; required (≥1) for YES |
| healthProfessionalName, healthProfessionalRole, healthProfessionalEmployeeId? | text / uuid | required for YES and NO; employee optional (GP, nurse, paramedic may be external) |
| decidedById, decidedAt | | set by the system |
| toldOn, toldById (employee), toldPersonKind (`SERVICE_USER` / `REPRESENTATIVE`), toldPersonName, toldRelationship | | step "Told in person" |
| factsExplained, enquiriesExplained, apologyGiven | boolean | all three must be true to complete the step |
| supportOffered | text | required to complete the step |
| writtenSentOn, writtenSentById, writtenMethod (`POST` / `EMAIL` / `HANDED`), writtenAttachmentId | | step "Written follow-up"; copy required |
| resultsSharedOn, resultsMethod, resultsAttachmentId, noFurtherEnquiriesReason | | step "Results shared"; or "no further enquiries" with reason |
| unableToNotify | boolean | path for Reg 20(5) |
| unableReason | `DECLINED` / `NOT_CONTACTABLE` / `NO_REPRESENTATIVE` | |
| createdAt/By, updatedAt/By, deletedAt | | |

`incidents.IncidentCandourAttempt` — contact attempts for 20(5): id, candourId, attemptedOn, method (`PHONE`, `VISIT`, `LETTER`, `EMAIL`, `OTHER`), byEmployeeId, outcome text.

Letters reuse `IncidentAttachment` with category `NOTIFICATION_EVIDENCE` (already in the enum).

Setting: `incidentCandourOverdueDays` (Int, nullable; null = no overdue flag). Policy value, not law — **decision needed** (see §9).

## 4. Rules (one util file + spec: `incident-candour.util.ts`)

1. **Status of a record**
   - `NOT_DECIDED` → no decision yet
   - `NOT_KNOWN` → decided "Not known yet"
   - `NOT_REQUIRED` → NO / NOT_APPLICABLE
   - `IN_PROGRESS` → YES and steps missing
   - `COMPLETE` → YES and (told + written + results) done, **or** unableToNotify with ≥1 attempt and reason
2. **Hint** (suggestion only, never auto-decides) "Likely Duty of Candour" when any: confirmed severity HIGH/CRITICAL; category DEATH with subtype not "Expected"; a service-user injury of severity SERIOUS; admittedToHospital = true; takenToAe = true.
3. **Dates** (org time zone, Europe/London): not in the future; not before the incident occurred; written ≥ told; results ≥ written.
4. **Completion of steps**
   - Told: date, by, who, all three ticks, support offered.
   - Written: date, by, method, letter copy.
   - Results: date, method, copy — or "no further enquiries" with reason (allowed only when there was no investigation).
5. **Overdue**: YES (or NOT_KNOWN) and not told and not unable, and today − incident reported date > overdue days.
6. **Close gate** (in `changeStatus` → CLOSED, next to suspensions and external bodies):
   - any record NOT_DECIDED or NOT_KNOWN → block: "Decide Duty of Candour for <name>";
   - any YES not COMPLETE → block, or close with an audited reason (same pattern as external bodies).
7. **Changing a decision** from YES to NO after steps were recorded: allowed with reason; steps are kept and shown as history, never deleted.
8. **Deleting a letter** that completes a step: refused; replace it instead, or change the step with a reason.

## 5. API

- `GET /incidents/:id` adds `candour: [...]` (one per affected service user, created on read for missing ones as `NOT_DECIDED`, or `NOT_APPLICABLE` when no service user is affected).
- `POST /incidents/:id/candour/:serviceUserId/decision`
- `POST /incidents/:id/candour/:serviceUserId/told`
- `POST /incidents/:id/candour/:serviceUserId/written`
- `POST /incidents/:id/candour/:serviceUserId/results`
- `POST /incidents/:id/candour/:serviceUserId/attempts` (+ `/unable`)
- `PATCH` of any step needs `changeReason`.
- Permissions: decision = `incidents.review`; steps = `incidents.review` or `incidents.close`. All go through the existing incident access rules (privacy level + branch scope). Closed incidents: refused ("Reopen to change").
- Timeline: audit `recordType: 'IncidentCandourChange'` → kind `CANDOUR`.
- List: `candourStatus` per incident + filter `?candour=overdue|in_progress|not_decided`.
- Stats/Dashboard: "Duty of Candour overdue" count.

## 6. Admin UI

| Tab | What is added |
|---|---|
| **Review** | "Duty of Candour" question per affected service user: Yes / No / Not known yet; harm list (for Yes); health professional consulted (name, role, optional staff picker); reason (No). Hint banner when the rules suggest it. |
| **Duty of Candour tab** (own tab, appears once anyone's answer is Yes / Not known — changed 8 Oct at the user's request; Review keeps only the question) | Steps 1 Told in person, 2 Written follow-up, 3 Results shared — or "Couldn't tell them" with attempts. Each step shows done / missing / overdue. |
| **Outcome & close** | Card summary (status per person); "Not known yet" must be decided here; close check message. The "Outcome shared with" row for the relevant person links to the results letter instead of asking twice. |
| **Supporting records** | Letters listed under "Notification evidence". |
| **Timeline** | "Duty of Candour" events. |
| **All Incidents / Dashboard** | Badge "Candour overdue", filter, Dashboard tile. |
| **Settings** | "Duty of Candour overdue after N days" (empty = off). |

## 7. Edge cases

**Who and when**
1. No service user affected (staff, visitor, data breach only) → NOT_APPLICABLE automatically; card hidden.
2. Several service users affected → one record each; close needs all of them.
3. Service user added or removed after decisions (correction on the Raise tab) → new person gets NOT_DECIDED; removed person's record kept as history (soft-deleted, shown greyed).
4. Service user has died → "who was told" must be a representative; the service user option is disabled.
5. Lacks capacity / under 16 → representative; record relationship.
6. No representative exists → "Couldn't tell them" with reason NO_REPRESENTATIVE.
7. Person declines to talk → unable path with reason DECLINED; at least one attempt recorded; written letter optional (Reg 20(5) removes the duty).
8. Not contactable → attempts list required (≥1); more attempts can be added later.
9. Told at the scene before the office reviewed → allowed: told date can be before the decision date, but not before the incident occurred.

**Decision**
10. "Not known yet" while waiting for a hospital outcome → allowed; overdue still counts; must be decided before close.
11. YES changed to NO later (harm turned out minor) → reason required; steps kept; card shows "No longer required".
12. NO changed to YES later (harm emerged after 28 days) → steps start from that point; overdue counts from the change date, not the report date.
13. Severity downgraded after YES → no automatic change; hint only.
14. DEATH with "Expected" subtype → no hint (natural course of illness), manager still decides.
15. Health professional is external (GP/paramedic) → free text name + role; staff picker optional.

**Steps and dates**
16. Written date before told date → refused.
17. Results date before written date → refused.
18. Future dates → refused (org time zone; check around midnight UK).
19. Letter sent by email → method EMAIL; copy = saved email as PDF/image.
20. Letter copy missing → step can't be completed.
21. Letter attachment deleted from Supporting records → refused while it completes a step.
22. No investigation (review decided "no investigation") → results step can be "no further enquiries" with reason.
23. Investigation finishes after the written letter → results step separate; must be done before close.

**Workflow**
24. Incident reopened → candour records stay; if new findings, results step can be re-done (history kept).
25. Incident closed → all candour changes refused until reopened.
26. Close with YES incomplete → blocked; close with audited reason allowed (manager override), shown on timeline.
27. Close with NOT_DECIDED/NOT_KNOWN → always blocked (no override).
28. Old incidents closed before release → no gate; shown "Not recorded".
29. Restricted incident → candour visible only to users who can open the incident.
30. Two managers editing at once → last save wins per step; both on the timeline; no lost data in other steps (step endpoints are separate).
31. Overdue setting empty → no overdue badges anywhere.
32. Overdue setting changed → badges recompute (computed, not stored).

## 8. Test plan

**A. Unit tests** (`incident-candour.util.spec.ts`)
- status for every combination (not decided, not known, no, n/a, yes + each missing step, unable path)
- hint triggers (each rule on its own, none, Expected death)
- date rules (future, before incident, order, midnight UK edge)
- overdue (off, under, exactly N, over; from report date; from YES-change date)
- close gate messages (not decided, not known, yes incomplete, override)

**B. API scenarios** (script against local API, fresh test incidents, cleaned up after)
1. Fall with hospital admission, 1 service user: hint shown → YES with harm + GP → told → written (post, PDF) → investigation → results → close ✅.
2. Same but try close at each step → correct block message each time.
3. YES incomplete → close with override reason → closed, timeline shows override.
4. Medication error, low harm → NO with reason + nurse → close ✅.
5. Staff-only violence incident → NOT_APPLICABLE, no card, close ✅.
6. Two service users affected → two records; close blocked until both decided.
7. Death (Unexpected) → told person must be representative; service user option refused.
8. Family declines → unable + 1 attempt → COMPLETE; close ✅.
9. Not contactable → unable without attempts refused; with 2 attempts ✅.
10. Dates: future, before incident, written before told, results before written → each refused with a clear message.
11. YES → NO with reason after "told" recorded → steps kept, status "No longer required".
12. Delete the written letter attachment → refused.
13. Reopen closed incident → records unchanged; add new results; close again.
14. Closed incident → every candour endpoint refused.
15. Restricted incident → user without clearance gets 404 on candour.
16. Permissions: user without `incidents.review` can't decide (403).
17. Overdue: set 5 days; incident reported 6 days ago with YES and not told → list filter returns it; Dashboard count matches; set empty → gone.

**C. Admin UI checks** (browser, local)
- Review tab: question, hint, harm list, health professional, reason validation messages.
- Card: each step form, date pickers limits, upload, done/missing/overdue states, change with reason.
- Outcome tab: summary, "Not known" prompt, close message in Next step bar.
- Supporting records shows letters; Timeline shows events; All Incidents badge + filter; Dashboard tile; Settings field.
- Light and dark mode; phone width (no sideways scroll).

**D. Regression**
- Review save/decision/cycles unchanged; reopen archives review but not candour.
- Close gates for suspensions, external bodies, mandatory measures still work.
- "Outcome shared with" saving unchanged for non-candour incidents.
- Carer app incidents unaffected.
- `npx jest src/incidents`, admin `tsc` + eslint on touched files.

## 9. Decisions needed before building

1. Overdue days: what number (or off)? The law has none.
2. Close with Duty of Candour incomplete: allow with a manager reason (proposed), or never?
3. Who may record the steps: managers with `incidents.review` (proposed) — should coordinators with `incidents.close` also?

## 10. Build order

1. Migration + util + spec.
2. API endpoints + detail mapping + timeline + close gate.
3. Review tab question + card.
4. Outcome tab summary + link to "Outcome shared with".
5. List badge/filter + Dashboard tile + Settings field.
6. Tests B, C, D; clean up test data; update `INCIDENTS_PENDING.md`.
