# Product gaps found by the policy library feature audit

Found on 5 November 2026 by checking every CareFlow feature the 122 ready-made policies mention against the API,
schema, admin app and employee-app endpoints. Where a feature was missing, the policies were reworded to a workaround
that works today; once a gap is built, the listed policies should be switched back to the real feature.
Status: **documented only, to be planned later.**

## Safety-critical

| # | Gap | Today | Policies relying on it |
|---|---|---|---|
| 1 | **Emergency alert that reaches the On-call Manager** by push, text or call, and works between visits and for supervisors | Alert appears only on CareFlow screens, only during a visit; email and text channels only write to a log | HS-003, GOV-019, HR-017, HR-019 |
| 2 | **Care worker safeguarding route**: a Safeguarding Concern incident opens or links to a safeguarding case; safeguarding incidents restricted by default | Only the office can create safeguarding cases; only incidents naming staff or an unknown person are restricted | SG-001, 002, 003, 006, 010, 011, 014, 015, CD-017, HR-018 and governance files |
| 3 | **eMAR second check** (who checked, when) that blocks the first dose until done | No field; recorded as a note | MED-001, 002, 005, 011, 013, 015 |
| 4 | **Structured eMAR flags**: advice if declined, covert administration approved (per medicine), controlled drug count with running balance in the app | Written into instructions or the dose note | MED-001, 003, 005, 008, 009, 010 |
| 5 | **Discharge medicines check status** that blocks doses until completed | Flash message set by staff | CD-015, MED-006, MED-013 |
| 6 | **Visit note integrity**: version history and audit log on re-save, late-entry and correction labels, office can add to a completed visit, manager can remove a wrong-person entry with an audit trail | Re-saved notes overwrite with no history; workarounds via Comms notes and supplier requests | CD-018 |

## Security and data protection

| # | Gap | Today | Policies relying on it |
|---|---|---|---|
| 7 | **Access control per staff document / record** (health, DBS, grievance, allegation; a manager's own records); complaint read access separate from complaint recording | All staff documents behind one permission (`employees.documents.read`, also via `hr.read`); password-protected files as a workaround | HR-001, 005, 013, 019, HS-015, HS-016, GOV-005, 007, 008, and SG/IPC files |
| 8 | **Shift-time login actually enforced**, a permission on the key safe code field and a log of who viewed a code | Setting exists but is not enforced | GOV-013, 016, 018, 019, HS-013, HS-017, CD-018 |
| 9 | **Multi-factor authentication** for web and app accounts | None (DSPT and Cyber Essentials expectation) | GOV-018 |
| 10 | **Full audit trail** of every record view and print | Audit log covers changes, sign-ins and some opens and exports | GOV-015, GOV-019 |
| 11 | **Real erasure, candidate deletion and full data export** | Delete hides records; permanent deletion and export only via the supplier | GOV-001, 014, 017, HR-001, HR-019 |

## Governance and quality

| # | Gap | Today | Policies relying on it |
|---|---|---|---|
| 12 | **Governance workspace**: risk register, service improvement plan, minutes, registers and logs, with restricted access | Kept in a restricted folder in cloud file storage outside CareFlow | GOV-002, 004, 006, 009, 012, 014, 016, 017, 021, 022, 023, HR-018 |
| 13 | **Audit module**: schedule with quarterly and annual repeats, audit tools, scores and RAG ratings, actions | Role tasks (daily/weekly/monthly only, one note) and Policies Forms | GOV-002, GOV-003, IPC-002, IPC-012 |
| 14 | **Attachments on complaints, compliments and safeguarding records** | Copies kept in the governance folder | GOV-005, 006, 009, SG-002 |
| 15 | **Acknowledgement report by employee, and policy plus acknowledgement export** | Report by document only; no export | GOV-001 |
| 16 | **Business continuity offline pack**: priority list, My care at a glance and alerts in one encrypted export | Separate exports plus a Care Coordinator spreadsheet | GOV-020 |
| 17 | **Continuity report and boundary exceptions report** | Compiled by hand from scheduling and call monitoring reports | CD-001, SG-009 |

## Smaller items

| # | Gap | Policies |
|---|---|---|
| 18 | Person-level photo consent checked automatically before a body map photo | CD-004, 008, 009 |
| 19 | Consent-to-record check before an assessment recording starts | CD-002, CD-004 |
| 20 | Field for lockable medicines box codes, handled like key safe codes | MED-001, 002, 004, 006, 010 |
| 21 | Configurable recipients for medication alerts (on-call user, office staff) | MED-005, 007, 010 |
| 22 | Cleared-to-work status that blocks allocation | HR-001 |
| 23 | Director and branch decision approvals | GOV-012 |
| 24 | E-signed declarations | GOV-011, HR-017 |
| 25 | RIDDOR field and work-injury absence type | HS-004, HS-007 |
| 26 | Risk scoring 1–25 with approval (risk records only take Low/Medium/High) | HS-002 |
| 27 | Equipment and LOLER register on the person | HS-006 |
| 28 | Vehicle details fields on the staff record | HR-005, HS-003 |

## Infrastructure settings for survey anonymity (operations, not app code)

Anonymous answers and answers given without a name are held in `surveys.SurveyPendingResponse` and written out later
in shuffled batches. Inside the app nothing links them to a person, but at infrastructure level:
- **Write-ahead log archives and point-in-time backups** can pair the "Completed" update with the held row for as long
  as they are kept: restrict access and shorten retention.
- **Dead rows** of the pending table stay readable at page level until vacuumed: set aggressive autovacuum on
  `surveys."SurveyPendingResponse"` (e.g. `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 1`) or a
  scheduled `VACUUM`.
- **Front door / app service request logs** record personal survey link tokens with exact times: shorten retention or
  mask survey paths.
- **Database statement logging** (`log_statement`, pgAudit) must stay off for the surveys schema, or logged parameters
  would contain answers next to the time.

## Carer mobile app (outside this workspace)

The survey payloads sent to the carer app now include `otherOption`, `exclusiveOptions`, `commentConfig` and `showIf`
(with `questionId`). The app source is not in this workspace, so it has not been updated: older app versions will not
show "Other" text boxes, comment boxes or follow-up questions, will ask questions that should be hidden (the server
discards those answers), and do not clear other ticks when "None of these" is chosen (the server keeps the specific
options and drops the exclusive one, and records that it did). Section headings (`sectionTitle`) are also sent but not
yet rendered. The app needs updating to render all of these. It should also show `answerWithoutNameNote`, stop
sending `respondentRelation` when answering without a name, and treat HTTP 409 "Your answers are already being sent…
try again in half an hour" differently from "You have already completed this survey" (both are 409 today).

Survey questions whose options come from a CareFlow list (ethnicity, sexual orientation, gender, sex, language,
marital status) now carry `optionsFrom` and `optionGroups` (the list's entries in use, under their group headings)
in the carer-app payload. The app should show them as a searchable list under the group headings; until it does it
shows `options` as a plain (long) list and answers by name, which the server accepts and stores with the entry's code.

Each survey item in the carer-app list now also carries `sectionIntros` ({ [sectionTitle]: text }, the sections asked
only): one or two sentences the app should show under each section heading. Until the app is updated it shows no
introductions (the questions are unchanged).

## Survey features for specific library surveys (from the last research briefs)

- **Self-assessment evidence type** for SUR-CQC-003 (Registered Manager's quarterly self-assessment): the CQC evidence
  capture keeps only top-two percentages, excludes text and suppresses anything under 5 responses, so a single-respondent
  form never reaches the CQC evidence area. Needs one evidence item per key question each quarter (CQC evidence screens are paused).
- **External reviewer access** for SUR-CQC-001/002: a restricted interviewer login and a survey owner outside the
  management line, with live counts hidden from managers.
- **Per-manager links with secondary suppression** for SUR-STF-018 (feedback on your manager).
- **Results visible to the HR Manager only** (SUR-STF-017, SUR-STF-022), event triggers (distressing event, return from
  4+ weeks' absence, complaints by relatives), Nominated Individual challenge step (CQC-003), closing-screen text after
  submission, writing answers back to the staff working pattern (STF-019), merge fields (manager name, event date).

## Survey features identified by the survey research (separate from the policy audit)

Being built now: "Other (please tell us)" text, comment boxes after chosen answers, show-only-if logic.
Later: event-triggered sending from care records (first visit, review date, medicines change, complaint closure,
discharge, package end, notice given) with exclusion rules; a 4-week contact hold-back across all surveys; easy read
versions linked to the same questions with a picture scale; interviewer mode (read-aloud script, call attempts,
interviewer-only codes); alert rules that create tasks or route answers; keyword flagging of free text; respondent-chosen
anonymity per response; monthly sampling; text message channel; grids, ranking and date answers.
Also: **named external recipients** for PUBLIC surveys (family members, professionals, commissioners, applicants)
with their own links, reminders and contact limits, so answers can be followed up without asking for a reference
number; **partner contact lists** with bulk email; **"Family views" reporting** kept separate from people's own
scores; **event triggers** for a recorded death (day 42–56, with opt-out and hold reasons) and an applicant outcome;
a **cross-survey 360 report** combining the annual people's, family, staff and professional surveys (replaces a single
organisation-wide questionnaire, which CareFlow's one-audience-per-survey model cannot send).
