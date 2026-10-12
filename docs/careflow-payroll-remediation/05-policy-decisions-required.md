# 05 — Policy Decisions Required

Business rules that need confirmation from Allfor Care before the related work can be finished. Nothing here was guessed in code: where a choice was unavoidable, the safest behaviour was implemented and is listed under "Implemented meanwhile" so it can be changed.

Question numbers (Q) refer to `13-open-policy-questions.md` in the wages verification audit.

---

## Decisions raised or sharpened by Phase 0

| ID | Decision | Why it matters | Implemented meanwhile | Blocks |
|---|---|---|---|---|
| D-01 | **Who approves pay?** Which people hold "Approve pay and record payments", and is one role enough or should approving a pay run, closing payroll and recording a bank payment be three different roles? (Q4) | Nobody can approve until someone is given the power | One seeded role, **Payroll Approver**, assigned to nobody. Permissions are already separate, so the split can be made without code | Use of pay runs after deployment |
| D-02 | **Small organisations.** Maker / checker needs two people. Is there any case where one person may both prepare and approve? | A single-office-user client cannot run payroll | No exception. Two users are required | Rollout to very small providers |
| D-03 | **Provisional visits in UK payroll.** May a UK run pay visits that are approved but never went through a visit pay run? (Q3) | That route pays visit pay only: no travel time, mileage, overtime premium, minimum wage top-up or pay items | Allowed and made safe: closing the UK run claims those visits so nothing pays them twice | Phase 5 gross collection design |
| D-04 | **Payment evidence.** What counts as proof a payout was paid: a bank reference typed by a person, an uploaded statement, or only a bank / provider confirmation? (Q41) | "Paid" should mean the carer has the money | A person records payment reference and date; audited | Phase 6.3 |
| D-05 | **Trust in carer-reported times.** How far from the server's own time may a reported finish be before the office must review it? Should a reported time ever be paid without review? (Q8, Q10) | Too tight floods the office with reviews; too loose lets times be edited | 15 minutes. A visit over the limit is priced and held for approval, not refused. The server check-in is always the start when one exists | VW-02 sign-off |
| D-06 | **Office corrections before completion.** Should an office manual check-in on a visit still in progress replace the carer's check-in? | It would change what the carer app sees mid-visit | Corrections carry into pay only once the visit is completed | VW-15 completion |
| D-07 | **Branch and legal-employer access.** Should office users see and act on pay only for their own branch? Is there more than one legal employer (PAYE scheme)? (Q7) | Pay runs currently span the whole organisation | Not changed. Pay permissions are organisation-wide | SI-10, Phase 7 |
| D-08 | **Replacement carer after pay.** When a carer is swapped on a visit that was already paid to the first carer, is the first payment recovered automatically? | Two people may each be owed, or one overpaid | The replacement is held for a manager; recovery is a manual negative correction | VW-11 follow-up |
| D-09 | **Reopening closed payroll.** Should a closed UK run ever be reopened, or should every later change be a correction in a new run? | Reopening reverses posted year-to-date figures | Allowed with `payroll.runs.reopen`; refused once a payout is approved or a live FPS exists | Phase 5 corrections design |
| D-10 | **Who may record a pay correction**, and is there a value above which a more senior approver is needed? | Corrections move money outside the normal run | `billing.payroll_runs.manage` to record, a different user to approve; no value limit | Correction screen (R-01) |
| D-11 | **Retention.** How long are pay records, corrections and the audit log kept, and who may ever delete them? | The audit log can no longer be cleared in production | Clearing is disabled in production | Phase 7 retention policy |
| D-12 | **Test-data reset.** Is a reset tool wanted on staging environments? | The delete-all tools are now off by default | Enabled only with `ALLOW_FINANCIAL_TEST_RESET=true` outside production | — |

---

## Decisions from the audit that the next phases need first

| Phase | Decisions | Audit questions |
|---|---|---|
| 1 Pay cards | Which days are enhanced as bank holidays (date, substitute, both); overlap policy; which rate dimensions are contractual; approval before a card is published | Q5, Q15, Q16, Q17 |
| 2 Visits, travel, expenses | Pay for cancelled / late-cancelled / missed / no-access visits; what travel time is paid and how it is evidenced; mileage rate, approval and payment route; expenses | Q13, Q14, Q32, Q33, Q34 |
| 3 Salary, guarantees, leave | Salary basis and what it covers; guaranteed hours; overtime basis; holiday method by contract type; contractual sick pay | Q22–Q24, Q29, Q35, Q36 |
| 4 Minimum wage | Pay reference period; which hours count (travel, training, sleep-in, on-call, live-in); how apprentices are identified; contractual wage floors | Q25, Q27, Q37–Q39 |
| 5 Statutory payroll | Pay frequencies; pension scheme and provider; treatment of fines and other deductions | Q2, Q40 |
| 6 Payments | Bank file format or payment provider | Q41 |

The brief states that CareFlow is to run its own statutory payroll engine, so audit Q1 (in-house or bureau) is treated as answered: in-house.
