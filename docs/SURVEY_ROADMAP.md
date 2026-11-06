# Surveys: research and roadmap to be the best survey system for home care

Written 6 November 2026 from desk research of survey products, care-sector tools, regulator guidance and survey
research. Status: **documented, not yet scheduled** unless marked. Phases: **1** next, **2** after, **3** later.
"Have" means CareFlow does it today. Product features are taken from vendor pages, listings and reviews; none
were tested hands-on, and some vendor claims could not be checked independently.

## 1. Where we stand and the goal

The market splits in two:
- **General survey tools** (SmartSurvey, Qualtrics, SurveyMonkey, Typeform, Culture Amp) are strong at sending,
  reminders, analysis and closing the loop, but know nothing about care: no care records, no policies, no CQC,
  no way to record a phone or visit answer against a person.
- **Care-sector tools** (QCS Feedback Surveys, Care Audit Pro, Care Audit Tool, Person Centred Software's family
  app, Radar Healthcare, Centrim Life, homecare.co.uk reviews) know care but offer a few satisfaction templates, a
  link and QR code, and a dashboard. QCS links answers to CQC quality statements and turns them into action plans;
  none we found offer a researched library of home care surveys tied to policies, real anonymity, or staff-recorded
  answers for people who do not use technology.

**Goal:** combine both. Everything a general tool does well for sending, reminding, analysing and acting, built on
care data and on what home care inspectors, commissioners and people actually need.

### Where CareFlow is already ahead
- A researched ready-made library written for home care (people we support, families, staff, professionals,
  CQC readiness), tied to the 122 policies and CQC quality statements, with alerts and manager guidance in each
  survey, a full-year calendar and a 4-week contact rule.
- Anonymity built into the database: held answers, day-only dates, no internet address on shared links, minimum of
  5 before written answers show, "answer without my name".
- Staff record phone, visit and paper answers, with who answered (the person, family, representative, staff).
- Dementia-friendly picture version; question bank; example-question gallery; preview exactly as people see it.
- Results in one place with participation, "Not counted" answers, top-two scores, CSV, and CQC evidence capture.

## 2. Evidence that should shape the product

| Finding | Source | What it means for CareFlow |
|---|---|---|
| CQC's single assessment framework treats people's experience as a required evidence category for most quality statements and values it as highly as other evidence; survey results fall within it. Staff survey results sit in "feedback from staff and leaders". CQC looks at how providers encourage, enable and act on feedback. | CQC framework presentations; Brabners; Care England | Map every question to quality statements and evidence categories (have), and evidence the **acting** as well as the asking: actions, "You said, we did", trends. |
| Among people aged 80 and over, paper gets a clearly higher response than web; the best result (58%) came from combining phone, digital and postal contact with a paper option. Those not reachable digitally responded at under 2%. | Statistics Norway 2025 experiment | Every person-facing survey must be available on paper and by phone as well as online (have in guidance), and CareFlow should **print** surveys and **track a mixed-mode sequence** (invite, reminder, phone follow-up). |
| Sending written results alone did not improve care; results discussed in staff meetings with improvement plans did. | Ward feedback trial, BMC Health Services Research | Build **action plans and team discussion** into results, not just reports. |
| In a patient-experience comparison, automated phone (IVR) and text message got similar response (19% and 17%); IVR often underperforms a live caller and people tend to prefer text or email. | BMJ Open; JMIR Formative Research; Houston Methodist case | Prefer **text message links** and **live phone calls recorded by staff** over automated voice calls. |
| The national Adult Social Care Survey uses ASCOT, a validated, preference-weighted measure of social care-related quality of life with eight areas (control, food and drink, personal cleanliness, safety, accommodation, social participation, occupation, dignity), validated with older people receiving home care. Every use needs a licence from the University of Kent; for-profit use needs a paid licence. | GOV.UK ASCS methodology; University of Kent ASCOT licensing | Offer **outcome measurement**, not just satisfaction: ASCOT under licence (commercial terms to agree), reported alongside our own questions. A real differentiator if licensed. |
| Public services must meet WCAG 2.2 AA; good forms ask only necessary questions, give help text and offer "I don't know" on yes / no questions. | GOV.UK Service Manual; NHS service manual; DfT accessible survey statement | Test the answer page and portal against **WCAG 2.2 AA** and publish an accessibility statement; keep the library's "Don't know" and help text rules. |
| Review sites forbid incentives and staff help with reviews; inviting only happy people can be a banned practice under the DMCC Act 2024. | carehome.co.uk / homecare.co.uk provider material; DMCC Act Sch. 20 | Any review-invite feature must invite everyone the same way and needs legal advice first. |

## 3. Capability map: what the best products do, and what we should build

Legend: **Have**, **Partly**, **No**. Phase in the last column.

### 3.1 Building surveys
| Capability | Seen in | CareFlow | Build | Phase |
|---|---|---|---|---|
| Ready-made templates | All; care tools have 3–10 satisfaction templates | **Have**: researched home care library (56 planned) | Finish the library | In progress |
| Question bank, example formats, preview | Typeform, SurveyMonkey | **Have** | — | — |
| Branching / show-only-if, "Other" text, comment boxes, clearing answers | Typeform, Qualtrics | **Have** | — | — |
| Fields filled from the link (e.g. branch, source) | Typeform hidden fields, Qualtrics | No | Link source tag and branch per link (A2 #4, #9) | 1–2 |
| Scores and calculations for scored tools (HSE stress indicator, audits, ASCOT) | Typeform, Qualtrics | No | Scoring rules per survey, shown in Results | 2 |
| AI help: draft a survey from a description, check wording for clarity and bias, predict length and drop-off | SurveyMonkey Genius | No (library checker does rule checks) | "Check this survey" against the library standard (plain English, one idea per question, scales, honest time) for organisations' own surveys; AI drafting only as suggestions a person approves | 2 |
| Multilingual versions, easy read, large print | SurveyMonkey, Qualtrics | Partly (dementia picture version) | Same survey in several languages and formats, results combined | 3 |
| Section manager | Most | No (approved, queued) | As planned | 1 |
| Grouped answer choices: headings inside a long choice list (for example a two-stage or grouped ethnic group list), and reporting groups that map detailed answers to broader ones | Qualtrics, SurveyMonkey | No | Headings in single and multiple choice questions (read out by screen readers, kept on the phone), and reporting groups used in Results | 2 |

### 3.2 Reaching people
| Capability | Seen in | CareFlow | Build | Phase |
|---|---|---|---|---|
| Send to chosen people | All | Staff: Have. People we support: being built | — | In progress |
| Contact lists for outside people (families, professionals) with opt-out | SmartSurvey, Qualtrics | No | A3 #12, #13, #16 | 2 |
| Personal links exported for mail merge; copy one person's link | Qualtrics | No | A2 #5 | 1 |
| Shared link, QR code, poster, website embed | Qualtrics, QCS, Care Audit Pro, Radar, review sites | Public link: Have. QR, poster, embed: No | A2 #6, #8 plus an embed snippet for the organisation's website | 1 |
| Ready-to-send WhatsApp / text / email message | homecare.co.uk invites | No | A2 #7 | 1 |
| Text message channel | Most enterprise tools | No | Send links by text (UK provider), with opt-out | 2 |
| Printed paper version with a scan-back or quick entry | Snap Surveys (paper), research evidence | No (staff type paper answers in) | Print-ready PDF per survey and per person; fast "paper entry" screen | 1–2 |
| Mixed-mode sequence: invite → reminder → phone follow-up, tracked | Dillman method; Statistics Norway evidence | No | Contact plan per survey with steps and a call list for non-responders | 2 |
| Reminders only to non-responders, reminder chains, maximum number | SmartSurvey, Qualtrics | No | A4 #17 | 2 |
| Event-triggered sending from care records (first visit, review due, hospital discharge, complaint closed, care ended, death) with exclusions | Patient experience platforms (Qualtrics healthcare, Radar/Cemplicity post-care) | **Have** (Phase 2 part 3): first visit, review due, home from hospital, complaint closed, medicines change, care ended, death (family offer), new starter sign-off, notice given, back from long absence | Training events (Part B) with Learning; further events as records are added | 2 |
| Contact frequency control across all surveys (no one surveyed twice in 4 weeks) | Enterprise "contact frequency rules" | No (manual history check) | Enforced hold-back with an override and reason | 2 |
| Random monthly sample | SurveyMonkey / SmartSurvey panels and quotas | No | Sample a set share of a branch each month (for the monthly check-in) | 2 |
| Kiosk / tablet mode, offline | SurveyMonkey add-on, HappyOrNot terminals | No | Tablet kiosk for the office and day services; offline recording in the carer app | 3 |
| Independent interviewer access | Activated Insights, iWantGreatCare | No | Restricted reviewer login (SUR-CQC-001/002) | 2 |

### 3.3 Understanding results
| Capability | Seen in | CareFlow | Build | Phase |
|---|---|---|---|---|
| Participation, per-question counts and percentages, top-two, CSV | All | **Have** | — | — |
| Trends across periods; compare surveys | Culture Amp, Activated Insights, QCS | Partly (per period) | Trend line per question across periods and years | 2 |
| Heatmaps by branch / team / job role | Culture Amp | Partly (breakdown tables) | Heatmap with small-group suppression | 2 |
| Role-based dashboards (registered manager, branch manager, nominated individual) | Qualtrics | No | A surveys dashboard per role: open surveys, response rates, alerts, actions, trends | 2 |
| Themes in written answers, word cloud, sentiment | SurveyMonkey, Qualtrics Text iQ | No | Themes and counts, hidden for small groups; safeguarding keyword flag sent to the right role | 2 |
| Benchmarks against other organisations | SurveyMonkey, Activated Insights | No | Anonymised sector benchmarks for ready-made surveys, opt-in with a data-sharing agreement | 3 |
| Outcome measure (quality of life), not only satisfaction | ASCOT (national survey) | No | ASCOT under licence; report alongside satisfaction | 3 (licence first) |
| Cross-survey 360 view (people, families, staff, professionals) | Qualtrics XM | No | One report combining the annual surveys by key question | 2 |
| Reports for CQC and commissioners, ready to share | QCS (CQC-linked) | Partly (CQC evidence capture) | One-click summary pack per period: participation, headlines, trends, actions taken, "You said, we did" | 2 |

### 3.4 Acting on results
| Capability | Seen in | CareFlow | Build | Phase |
|---|---|---|---|---|
| **Alert rules that create tasks or cases with a due time** | Qualtrics closed-loop ticketing, Radar | No. Every ready-made survey lists alerts that staff action by hand | **Highest value.** Each library alert becomes a rule: answer → task for the named role, policy timescale, link to the complaint / safeguarding / incident record. Anonymous answers never identify anyone. | 1–2 |
| Follow-up list for people who asked to be contacted | iWantGreatCare (reply online), Qualtrics | Partly (listed, notes on recorded responses) | Owner, due date, outcome, overdue view | 1–2 |
| Action plans from results, tracked to completion | QCS, Culture Amp (community action plans) | No | Actions linked to the result that raised them; feeds the planned "Action plans and evidence" area and CQC evidence | 2 |
| "You said, we did" to respondents and staff | Research evidence; providers publish annual results | No | Publish a summary to the portal, staff app and a printable letter | 2 |
| Team discussion record | Ward feedback trial | No | Record when results were discussed with staff and what was agreed | 2 |

### 3.5 Trust, safety and compliance
| Capability | Seen in | CareFlow | Build | Phase |
|---|---|---|---|---|
| Anonymous and named answers | QCS, most | **Have**, stronger than others | — | — |
| Data security assurance (DSPT, UK hosting) | SmartSurvey | To confirm per hosting | State DSPT status and UK hosting in a security page | 2 |
| Accessibility WCAG 2.2 AA with a statement | SmartSurvey (DfT statement), GOV.UK | Audited 6 Nov 2026: answer page, portal and admin survey screens fixed and tested; draft statement in docs/ACCESSIBILITY_STATEMENT.md | Confirm the draft's open items, screen-reader pass with NVDA/VoiceOver, then publish | 1–2 |
| Retention and deletion of single answers | Enterprise tools | No (whole-survey deletion) | Delete answers by retention date | 2 |
| Response quality checks (speeders, gibberish, duplicates) | SurveyMonkey Genius | No | Flag, never delete automatically; one answer per device option | 2 |
| Spam protection on public links | Most | No | A4 #19 | 1 |
| Audit of link copying, sends and exports | Enterprise tools | Partly | A6 #24 | 1 |

## 4. Audience, sharing and reach cases (agreed with the user)

### A1. Who a survey is for, and finding it later
| # | Case | Phase |
|---|---|---|
| 1 | "Who it's for" label on every survey, on top of the audience type. Public: Families and representatives, Health and social care professionals, Commissioners and local authority, Job applicants, Volunteers, General public, Other (typed). Employees: All staff, Care workers, Office staff, New starters, Leavers, Managers. Service users: All people we support, New clients, People leaving our care, and similar. Set in New survey; ready-made surveys set it themselves. Shown in the Audience column, as a list filter, on Results, in the CSV and in CQC evidence. | 1 |
| 2 | Several groups in one survey: label "Several groups" plus a standard "Who are you?" question, with Results split by it. | 1 |
| 3 | A survey about one person we support (family or GP views on one person's care), linked to that person's record and findable from it. | 2 |
| 4 | Branch shown on every survey; one public link per branch. | 1 |

### A2. Sharing links
| # | Case | Phase |
|---|---|---|
| 5 | Copy each person's own link, plus "Copy all links" as a list or CSV for mail merge. One link per person keeps tracking and one answer per person. Only people who can manage surveys can copy; copying is audited; never where it could link an answer to a person on an anonymous survey. | 1 |
| 6 | Optional shared link on staff and service-user surveys, with the trade-offs shown; Results show "Answered through the shared link". | 1 |
| 7 | Ready-to-send message with the link for WhatsApp, text or email. | 1 |
| 8 | QR code, printable poster, printable paper version, website embed. | 1 |
| 9 | Where answers came from: tag a link as WhatsApp, email, poster or website. | 2 |
| 10 | Leaked link: a new link for one person, or a new shared link that turns the old one off. | 1 |
| 11 | Links stop when the survey closes, with a clear message. | 1 (check what exists) |

### A3. People who are not staff or people we support
| # | Case | Phase |
|---|---|---|
| 12 | Family and representatives from contacts on a person's record: email with their own link, about that person. | 2 |
| 13 | Professionals from contacts held in CareFlow or typed in once; reusable contact lists; who-has-answered tracking. | 2 |
| 14 | Former staff and former clients: personal links keep working after their account ends. | 2 |
| 15 | Job applicants, volunteers, students, agency staff: shared link now; personal links once recruitment exists. | 3 |
| 16 | Consent to contact and opt-out, respected everywhere. | 2 |

### A4. Getting answers and keeping them honest
| # | Case | Phase |
|---|---|---|
| 17 | Reminders to non-responders, reminder chains, a maximum number. | 2 |
| 18 | Optional one answer per device on shared links. | 1 (built) |
| 19 | Spam protection on public links without storing who sent them. | 1 |
| 20 | Answering for someone else. | Have |

### A5. Accessibility
| # | Case | Phase |
|---|---|---|
| 21 | Large print, easy read and other languages for the same survey, results combined. | 3 |
| 22 | Printable interviewer script for phone surveys. | 3 |

### A6. Safety and privacy
| # | Case | Phase |
|---|---|---|
| 23 | Anonymous surveys stay safe with every new sharing feature (no person-linking, minimum of 5, small groups suppressed). | 1 |
| 24 | Copying links, sending to outside people, new links and exports are audited; branch managers see only their branch. | 1 |

### A7. Sharing: anonymity review (Phase 1, November 2026)

Built: A2 #5–#8 and #10–#11, A4 #18–#19, A6 #23–#24 (the website "embed" is a button that opens the survey:
the admin app refuses to be shown inside other sites, X-Frame-Options SAMEORIGIN, and that stays). Each feature was
checked against one question: could anyone use it to tell which answers a person gave, or whether a person answered
an anonymous survey?

| Feature | Risk looked at | What stops it (and the test that proves it) |
|---|---|---|
| People's own links (copy, all, mail-merge CSV, new link) | Holding a person's link shows whether they answered (the link page says "already completed"); timing of a reply could be watched. | Refused on anonymous surveys, in the API and the screen (`survey-recipient-links.service.spec`, `SurveyPersonalLinks.test`). Named surveys only; who answered only with responses access; confirm before copying; every copy audited without the links; "Who copied links" history for managers with responses access. |
| Shared link on staff and service-user surveys | A small, known group (the team): an answer appearing just after someone says they used the poster; a branch or "who answered" pointing at someone. | Every shared-link answer goes through the held-answer store (no person, token or IP; day only; written in shuffled batches), is "without a name" on named surveys (no branch, no who answered), never counts as anyone on the list answering, and contact-me questions are not asked (`surveys.service.spec` "shared link on staff and service-user surveys"). Results show a count only, never which answers came through the link. |
| Shared link alongside personal links (named surveys) | Someone answers twice. | Said in the turn-on dialog; Results show "Answered by people it was sent to" and "Answered through the shared link" apart; the response rate counts the list only. |
| Counts by day (burst caution) | Day counts dating an answer. | Only the number per day is kept (SurveySharedLinkDay), never with an answer; held answers are still dated the day they are written out. A caution names unusual days only. |
| One answer per device | A device marker linking a device to an answer. | A random value kept only in the browser, never sent or stored; the page says so. |
| Spam protection | Keeping IP addresses or device details. | Honeypot, signed form token (2-second minimum, single use, 24 hours), 60 answers per link per 10 minutes, all in memory and keyed by the link only (`survey-link-guard.spec`). The existing per-IP request throttle keeps addresses in memory for a minute only, never stored. |
| Audit rows (copy, new link, shared link on/off, paper copy, results download) | Audit text naming who answered or holding a link. | No tokens, no answers, no recipient on anonymous submits (unchanged), counts only. |
| Audit log as a side channel (review fix) | Every answer's audit row held the survey and the exact time, so anyone with audit access (coordinators, inspectors) could count a survey's answers and date each one. | Answers linked to no one (anonymous, without a name, shared links, anonymous recorded and reviewer answers) get no audit row each: a count per survey per day (date only; staff- and reviewer-recorded apart) is written once the day is over (`survey-unlinked-answer-days.spec`, `surveys.service.spec` "no audit row of its own"). Survey entries in the audit log (list and single entry) show only to people with results access to that survey in its branches; admins see all; audit access without survey access sees none (`audit-logs.survey-rows.spec`, `survey-access.spec`). Rows written before this change keep their times but fall under the same viewing rule. |
| Independent reviewer accounts (SUR-CQC-001/002; review fix) | A reviewer using a Temporary Inspector login (those can open care records); a grant widening a staff member's access; a reviewer reaching results or other surveys; "Recorded by" naming no one. | The reviewer has an ordinary account whose only role is "Independent reviewer" (no permissions, no branch, never a staff email), made from the survey ("Add a reviewer": they choose their own password from an emailed link; nobody sets or sees it). Grants go only to such accounts, never on a repeating survey itself (its running period instead), and the list of reviewer accounts is limited to those made in the manager's branches. surveys.review.record is held only while a grant is live; every other route refuses the account. Named answers are audited as the reviewer's user; anonymous ones go into the day count (`survey-reviewers.spec`, `SurveyReviewers.test`, `reviewer-nav.test`). |
| Public shared-link answers (review fix) | Anonymous and "without my name" answers to a public survey written at once, so anyone watching Results saw each arrive at a known time. | Held in the held-answer store (no IP or device; the day only; a branch link keeps the branch) and written out in shuffled batches like every other answer linked to no one; a used form stays used once held, and is released only if nothing was kept (`surveys.service.spec` "held (never written at once)", "anonymous public survey"). Named public answers are unchanged. |
| Office notices on staff surveys (review fix) | A notice at the exact time of each anonymous or "without my name" answer, with "N of M responded", dating each answer. | No notice per answer linked to no one: one summary per staff survey per finished day, sent by the survey job with the day's audit count, only to people with results access to that survey in its branches (never the manager a copy rates). Named answers keep their own notice, now limited the same way (`surveys.service.spec` "one summary a day"). |
| Copies for each manager at send (review fix) | A team shrinking after the drafts were made (someone leaving or moving manager), so a copy goes to fewer than its minimum. | Each copy remembers its managers, whether it is the pooled copy and its minimum team (Survey.managerCopy). Sending, opening or a scheduled send is refused, with the reason, when the staff still on its list and still named under the manager are fewer than the minimum, or the pooled copy breaks the pool rules (`survey-manager-copy-team.spec`, `surveys.service.spec`). |
| Messages, poster, paper copy | Promising more privacy than CareFlow gives. | Anonymous wording only on anonymous surveys; shared links on named surveys say "not linked to your name"; anonymous paper copies drop contact-me questions and say not to write names. |
| Exports | Results leaving without a trace; spreadsheet formulas in typed answers. | The download is recorded first (refused without results access: no record, no download); every CSV cell that could run as a formula is made harmless (`csv.test`). |
| "This survey has ended" page | None (no answers or people shown). | Shows the organisation's public phone and email only. |

Phase 2 part 1 (reminders, contact plans, call list, text messages, opt-outs), checked the same way:

| Feature | Risk looked at | What stops it (and the test that proves it) |
|---|---|---|
| Reminders on anonymous surveys | A reminder or its link showing who has answered; reminder dates dating an answer. | Sent only to people not marked Completed, never with a personal link or token (email, app, text), never saying "you have not answered"; the person's reminder date is the day only (`survey-reminders.service.spec`, `survey-contact-messages.util.spec`). |
| Reminder counts over time | "Reminded 7" one day and "6" the next shows one answer. | Run counts shown only to people with results access, and on anonymous surveys only once the answers reach the reporting threshold; otherwise "to everyone who had not answered" (`survey-reminders.service.spec`, `SurveyRemindersPanel.test`). |
| Call list | A list of who has not answered. | Named surveys only (refused in the API and the plan check); open to people with responses access or the role making the calls, in their branches; the task names no one and is generic when answers are limited. |
| Text messages | Numbers or links in logs; a provider holding personal links on anonymous surveys. | Log mode writes a masked number and the length only (`text-message.service.spec`); no personal link on anonymous surveys; audit rows hold counts only. |
| Opt-outs | A person asking not to be contacted still being sent invitations. | Honoured for invitations (email, app, portal) and every reminder channel; audited without contact details. Set on the employee and service-user record (Survey contact preferences: not at all, or by channel; viewing needs survey access, changing needs surveys.manage; `SurveyContactPreferencesSection.test`). |
| Remind one person | Choosing one person to remind shows you know they have not answered. | Named surveys only, refused on anonymous surveys in the API and never offered on the screen; needs responses access (who answered is part of the individual responses); same limits as every reminder (3 at most, 2 days apart, quiet hours, opt-outs); a reminder that reached no one is not counted (`survey-reminders.service.spec` "remind one person", `SurveyPersonalLinks.test`). |
| STOP replies to texts | Reply text holding personal or care details being stored; a provider faking replies; a START undoing a staff-recorded opt-out. | Only stop and start words are acted on; every other reply is dropped unread and never stored or logged; the reply address does not exist until a provider that handles replies is in use, and refuses requests the provider did not sign; START lifts only opt-outs a STOP made; audit rows never hold the number (`text-message-replies.util.spec`, `text-message.service.spec`, `survey-text-replies.service.spec`). |

| Invitations on anonymous staff surveys (review fix) | The invitation email and app notification carrying the person's own link and token. | No link or token in any invitation on an anonymous survey; staff answer in the carer app's Surveys (signed in) (`surveys.service.spec` "anonymous survey invitations"). |
| Text invitations at night (review fix) | Texts sent in quiet hours. | Held with a pending marker and sent by the survey job once quiet hours end, only to people still not answered (`survey-reminders.service.spec` "quiet hours"). |
| Day-only reminder dates (review fix) | The 2-day gap shrinking to about a day on anonymous surveys. | A whole extra day is counted when the stored date is the day only (`survey-contact-plan.util.spec`). |

Phase 2 part 2 (the 4-week contact rule and sampling), checked the same way:

| Feature | Risk looked at | What stops it (and the test that proves it) |
|---|---|---|
| Counting survey contacts | A row that exists only because someone answered an anonymous survey (recorded or "without my name") showing that they answered. | SurveyRecipient.addedByAnswer; such rows never count on anonymous surveys. Recorded answers on named surveys do count (they are a contact, and already visible) (`survey-contact-rule.spec`). |
| Held-back list, pre-send check, override, audit | Showing which survey held someone back, when being sent it is itself sensitive (after a complaint, a bereavement, a distressing event, a sponsorship check). | The other survey's title and date only to someone with results access to it and in its branches; otherwise "had another survey in the last 4 weeks" and the free date. The send check and the audit rows never name it; overrides are audited as counts and the reason (`survey-contact-rule.spec` "never names the other survey", `surveys.service.spec` "the 4-week contact rule", `SurveyContactRulePanel.test`). |
| Anonymous minimum | Holding people back leaving an anonymous survey with too few people. | The minimum is checked on who is sent now; sampling never goes below it (`surveys.service.spec`). |
| Sending held people later | A late, lone invitation on an anonymous survey dating an answer. | Sent through the normal path; answers still go through the held-answer store (shuffled batches, day only). Only when at least 3 days are left. |
| Sampling | A pattern in who is chosen. | Those asked least often first, random among equals (crypto); counts only in audit. People held back are still reported as held, never dropped silently. |
| Free days on the held-back list | A free day dates the other survey (28 days before). | Shown only to people who can send (surveys.manage), needed to plan; read-only viewers see "had another survey" only (`survey-contact-rule.spec` "never names the other survey"). |
| Skip, don't delay; "Don't send" (rule fixes) | Who was not sent a survey, or why, reaching notifications or audit. | Recorded as not sent on the held-back row; audit holds the count and the reason, never names (`survey-contact-rule.spec` "Do not send"). |
| Linked parts (timing.sentWith) and the all-staff calendar | None new: a pair sent together is one contact; anonymous staff surveys neither hold back nor count (they follow the calendar). | Library checker proves both links exist and point back (`survey-contact-rule.spec` "linked parts"). |
| Weekly repeats | Asking the same people more often than once in 4 weeks without anyone deciding to. | A reason (sender's or the library's timing.repeatReason) before a weekly series starts; audited (`surveys.service.spec` "a weekly repeat needs a reason"). |
| Anonymous staff invitations and My surveys (web) | A personal link or token in an anonymous invitation, or in a web address, showing whether someone answered. | Invitations and reminders name only where the person can answer signed in (carer app; My surveys in CareFlow for staff whose login has the same email; else paper), never a link or token (`survey-contact-messages.util.spec`). My surveys opens a survey by its id; the token never leaves the API (`MySurveysPage.test`). |

Phase 2 part 3 (surveys sent when something happens in the care records), checked the same way:

| Feature | Risk looked at | What stops it (and the test that proves it) |
|---|---|---|
| Reading events from records | A new store of who had a hospital stay, complaint or death; answers joined to events. | No new event store: CareFlow reads the records it already keeps. The ledger (SurveyEventOccurrence) holds who, the event day, due days and what became of it; never answers, completion or response times (`survey-event-triggers.service.spec`). |
| The ledger list (names and events) | Showing who had a sensitive event (complaint, death, hospital) to people who should not see it. | Only people who manage surveys see the list, in their branches; others see the setting only (`survey-event-triggers.service.spec` "the list of people and events is for people who manage surveys only", `SurveyEventTriggerPanel.test`). |
| Event sends on anonymous surveys | One person sent alone after an event: an answer that week is theirs. | Sent only when 5 or more people are due at once (else they wait, "BATCH", or are let go after their last day); answers still go through the held store (shuffled batches, day only) (`survey-event-triggers.service.spec` "at least 5"). |
| Month copies | Answers dated by which month's copy someone was sent. | Same as any period: day-only times and held answers on anonymous surveys; a copy covers a whole month and stays open 4 weeks after it. |
| Tasks and notifications for checks and family offers | A task or notice naming the person or the event. | Counts only; the survey's title only when its answers are not limited, else "a survey"; never a name or the event (`survey-event-triggers.service.spec` "a task that names no one"). |
| Audit | Names or events per person in the audit trail. | Switch-on/off records the setting; sends, decisions and stops after a death record counts and the reason only (`survey-event-triggers.service.spec`, `surveys.service.spec` "event sends go into the month copy"). |
| Deaths | Invitations, reminders or texts reaching a family after a death. | Every survey job: waiting event sends (except the bereaved-family survey), held-back rows and waiting texts are stopped; reminders and call lists already leave them out; audited as counts. The bereaved-family survey is only ever offered by staff, after 6 weeks, never sent by CareFlow (`survey-event-triggers.service.spec` "a death stops contact"). |

Eligibility after sending (fix, November 2026), checked the same way:

| Feature | Risk looked at | What stops it (and the test that proves it) |
|---|---|---|
| Lapsed invitations | Reminders, texts or calls reaching someone who has died, left, or whose care ended or never started; or the lapsed count, set against the other counts, showing who answered an anonymous survey. | One shared rule for sending and after it (`survey-eligibility.util`), checked at each reminder, text, call-list build and when a link is opened or answered; the invitation is marked LAPSED and the link says the survey is closed for them; answers already given are kept (`survey-eligibility.util.spec`, `survey-reminders.service.spec` "people who can no longer be sent it", `surveys.service.spec` "closed for them"). Anonymous surveys never show lapsed apart: they stay among "not started" (`survey-eligibility.util.spec`). Sending again is by staff, on named surveys only, with responses access, once the person can be sent it again (`surveys.service.spec` "sent again only by staff"). Exceptions: discharged people chosen by name or on a care-ended / complaint follow-up survey; staff on leavers' surveys. |
| Former staff on leavers' surveys (SUR-STF-015) | A leaver's answer linked to them through a link or a mail log; a work address or the carer app reaching someone who has left; former staff surveyed for anything else. | Chosen by name only on leavers' surveys and only within 92 days of leaving (one rule and window in `survey-eligibility.util`, ready to widen); sent to the personal email on their record, never an address on the organisation's own domains, never the carer app or CareFlow. Named version: their own link. Anonymous version: no link of any kind, they are asked to answer on paper. A one-use anonymous link by email was not built: the email (and any mail provider's log) would pair the person with that link, so it could not be kept apart from the answer (`survey-eligibility.util.spec` "former staff", `surveys.service.spec` "leavers’ survey", "former staff: never the carer app", `SurveyFormerStaffField.test`). |
| Former people chosen by name (widened, November 2026) | Surveying people who have left or whose care ended without anyone deciding to; a guessed date; reaching someone who died; a work address, the app or the portal reaching them. | By name only, Send now only (never by branch, job title, a schedule or a repeat), within 92 days of a recorded leaving date or service end date (never a guessed one), never anyone who has died; a reason (5–300) on any survey not meant for them, audited as a count and the reason; personal email only, never the carer app or portal (`survey-eligibility.util.spec` "people whose care ended", `surveys.service.spec` "staff who left in the last 3 months", "someone whose care ended"). |
| Unsubscribe from all surveys | A one-click link (or STOP) that could show which survey or answer is theirs; staff overriding it. | The link names the person only (signed, never a survey or answer, so it is safe on anonymous surveys), changes nothing until confirmed (email scanners), and sets a permanent opt-out from every channel that staff cannot lift; STOP from a former person sets the same; audited without details (`survey-unsubscribe.service.spec`). |

Known limits, said plainly: one-answer-per-device can be beaten with another device or by clearing the browser;
the per-link limit is per server. Results show the burst caution for that reason.

## 5. Recommended order

**Now (in progress):** send to chosen people we support; ready-made library writing.

**Phase 1** (makes surveys usable every day and safe to share):
1. Alert rules from the library's alerts → tasks with timescales; contact-me follow-up list.
2. "Who it's for" label, branch per link, several-groups question.
3. Copy personal links, CSV for mail merge, optional shared link, ready-to-send messages, QR, poster, embed,
   printable paper version, new link if leaked.
4. Spam protection, audit, anonymity safeguards for all of the above.
5. Section manager (already approved).
6. Accessibility audit of the answer page and portal (WCAG 2.2 AA).

**Phase 2** (reach and insight):
contact lists and outside people with opt-out; reminders and mixed-mode contact plans; event triggers from care
records with the 4-week rule enforced; monthly sampling; text message channel; trends, heatmaps, role dashboards,
themes in written answers with safeguarding keyword flags; action plans, team discussion record, "You said, we did";
CQC and commissioner pack; 360 report; scoring; survey wording checker; independent reviewer access; single-answer
retention; response quality checks; DSPT / hosting statement; repeating surveys that skip chosen months; a rotating
question in a repeating survey (one of a bank each period), with trends kept across periods; grouped answer choices with headings and reporting groups.
Integrations: send training feedback from a Learning training event (attendees chosen and the course, date and
trainer recorded on each answer, Part B follow-up scheduled from the event); pool results across copies of the same
template (course sessions, monthly pulses, yearly runs) into one report.

**Phase 3** (lead the market):
ASCOT outcome measurement under licence; anonymised sector benchmarks (opt-in); multilingual, easy read and large
print versions; tablet kiosk and offline carer-app recording; personal links for applicants; review invitations
only after legal advice.

## 5a. Legal watch list for the ready-made library

Library wording that depends on law or guidance not yet in force, or due to change. Check each on its date and
issue a new library revision if needed (CareFlow should later show managers a "review due" note on affected surveys).

| Date | What to check | Surveys |
|---|---|---|
| When DBT confirms commencement | Employment Rights Act 2025 s1, right to guaranteed hours (not in force as of 6 Nov 2026) | SUR-STF-019 |
| October 2027 (DBT timeline) | Employment Rights Act 2025 flexible working changes | SUR-STF-019, policy POL-HR-015 |
| January 2027 | Telecare digital switchover completion (gov.uk) | SUR-PWS-015 |
| On any update | Home Office sponsor guidance Part 3 (checked at v08/26: C1.14, C1.15) | SUR-STF-013, SUR-STF-015 |
| When the new standard publishes | GSS gender identity standard (interim guidance, December 2024) | SUR-STF-011 |
| Before release | Legal review of sponsored worker confidentiality wording | SUR-STF-013 |

## 6. Sources

Care-sector tools
- QCS Feedback Surveys: https://www.qcs.co.uk/qcs-feedback-surveys/
- Care Audit Pro, domiciliary care surveys: https://careauditpro.co.uk/domiciliary-care-surveys/
- Care Audit Tool: https://careaudittool.co.uk/
- Person Centred Software, family engagement: https://personcentredsoftware.com/products/digital-care-system/key-features/family-engagement-module
- Centrim Life: https://clutch.co/profile/centrim-life-uk
- Radar Healthcare feedback dashboards: https://www.careengland.org.uk/radar-healthcares-new-feedback-and-observation-dashboards-set-to-revolutionise-health-and-social-care/ ; Cemplicity acquisition: https://htworld.co.uk/?p=52566
- Activated Insights / Home Care Pulse: https://platform.softwareone.com/product/activated-insights-experience-management/PCP-6488-8869 ; awards: https://www.homecaremag.com/news/activated-insights-announces-2025-best-home-care-award-winners
- iWantGreatCare: https://iWantGreatCare.org/information/for-clinicians
- HappyOrNot, care homes: https://www.happy-or-not.com/en/use-cases/healthcare/residential-care-homes/
- homecare.co.uk invite to review: https://www.homecare.co.uk/news/article.cfm/id/1672668/invite-to-review ; carehome.co.uk reviews webinar: https://cdn.document360.io/2500aecc-383f-4082-bc84-b3f52303e506/Images/Documentation/Reviews%20Webinar%20carehome.co.uk%202026.pdf

General survey and experience tools
- SmartSurvey G-Cloud: https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/services/233501668391373 ; invitations: https://www.smartsurvey.com/masterclass/contact-lists-and-invitations
- Qualtrics distributions (university guide): https://und.edu/academics/ttada/academic-technologies/qualtrics/distributions.html ; closed-loop follow-up: https://qualtrics.com/en-gb/closed-loop-followup ; Text iQ: https://www.qualtrics.com/support/vocalize/dashboard-settings-cx/text-analysis-cx/ ; patient experience: https://qualtrics.com/marketplace/patient-experience
- SurveyMonkey features: https://www.g2.com/products/surveymonkey/features ; AI tools overview: https://www.pollfish.com/resources/blog/market-research/ai-survey-tools/
- Typeform logic and hidden fields: https://typeform.com/developers/create/logic-jumps ; https://developer.typeform.com/create/hidden-fields
- Culture Amp: https://cultureamp.com/products/engagement ; heatmap comparisons: https://updates.cultureamp.com/132926-heatmap-survey-comparisons-now-available-in-engage

Regulation, standards and research
- CQC evidence categories (framework presentations): https://www.careengland.org.uk/wp-content/uploads/2024/03/Care-England-SAF-Quality-Statement-Presentation-April-webinar-2024.pdf ; https://brabners.com/blogs/cqc-single-assessment-framework
- Adult Social Care Survey methodology: https://www.gov.uk/government/statistics/personal-social-services-adult-social-care-survey-report-england-2024-to-2025/personal-social-services-ascs-report-england-2024-to-2025-methodology
- ASCOT validity with older home care users: https://researchonline.lse.ac.uk/id/eprint/42320 ; licensing: https://research.kent.ac.uk/ascot/licensing/
- Statistics Norway, people aged 80+: https://www.ssb.no/en/sosiale-forhold-og-kriminalitet/levekar/artikler/an-experiment-among-respondents-aged-80-and-above-in-the-2025-quality-of-life-survey
- Mixed-mode response: https://pdec.ifas.ufl.edu/satisfaction/articles/Israel-2012-Social%20Science%20Computer%20Review.pdf
- Ward feedback trial: https://link.springer.com/article/10.1186/1472-6963-13-259
- Survey modes (IVR, SMS): https://pmc.ncbi.nlm.nih.gov/articles/PMC5372080/table/BMJOPEN2016014681TB2 ; https://formative.jmir.org/2025/1/e67452 ; https://nrchealth.com/resource/houstonmethodist
- NHS Friends and Family Test guidance: https://www.england.nhs.uk/ourwork/pe/fft/fft-guidance/
- GOV.UK / NHS question design and accessibility: https://service-manual.nhs.uk/content/how-to-write-good-questions-for-forms ; https://www.gov.uk/service-manual/technology/accessibility-for-developers-an-introduction ; https://www.gov.uk/government/publications/dft-accessible-online-form-and-survey-statement
