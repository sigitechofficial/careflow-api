# 05 — Policy Decisions Required

**Updated:** 2026-10-12 (Gate B sprint). New or changed in this sprint: D-13, D-15, D-16 to D-21, and the table in section 2a.

Business rules that need confirmation from Allfor Care before the related work can be finished. Nothing here was guessed in code: where a choice was unavoidable, the safest behaviour was implemented and is listed under "Interim safeguard in place" so it can be changed. **The interim safeguards are technical proposals, not approved Allfor Care employment policy.**

Question numbers (Q) refer to `13-open-policy-questions.md` in the wages verification audit.

---

## 1. Decisions Gate A depends on

| ID | Decision needed | Why it matters | Interim safeguard in place | What is blocked until decided |
|---|---|---|---|---|
| D-01 | **Named payroll approval responsibilities.** Which people approve and lock pay runs, close payroll, approve payouts and record payments? One role, or separate roles for each? (Q4) | On the development system nobody holds these powers today, so no pay run can be approved. The roles screen now says so | One seeded role, **Payroll Approver**, assigned to nobody. The permissions are separate, so the split needs no code. Nobody was assigned by development | Any real use of pay runs |
| D-02 | **Two-person approval in a small organisation.** May one person ever both prepare and approve? | A provider with one office user cannot complete payroll | No exception. The roles screen warns when the only approver is also the only preparer | Rollout to very small providers |
| D-03 | **Provisional visits in UK payroll.** May a UK run pay visits that never went through a visit pay run? (Q3) | That route pays visit pay only: no travel time, mileage, overtime premium, minimum wage top-up or pay items | Allowed and made safe: closing claims those visits, cancelling releases them. Such a visit shows as "In UK payroll (not closed)" until the run closes | Whether the normal route should refuse them; Phase 5 gross collection |
| D-04 | **Bank settlement evidence.** What proves a payout was paid: a typed reference, an uploaded statement, or only a bank / provider confirmation? Which bank file format or provider? (Q41) | "Paid" should mean the carer has the money | A typed reference and date record the payment as **manually recorded**, shown as "not confirmed by a bank". Confirmed settlement and the bank states exist in the model but cannot be set. No connector was invented | Bank file, provider responses, statement matching (Phase 6.3) |
| D-05 | **Timestamp verification tolerance.** How far from the server's own time may a carer-reported finish be before the office must review it? (Q8, Q10) | Too tight floods the office; too loose lets times be edited | 15 minutes, a constant in code. Over the limit the visit is priced and that carer's row is held, not refused. A future time is refused | Sign-off of VW-02; making the value a setting |
| D-06 | **Office correction during an active visit.** Should an office-entered time on a visit in progress replace what the carer sees and does in the app? | It would change the carer's visit mid-way | The office time is stored and becomes the record at completion; the live allocation is not rewritten. A carer who then reports something different is held for review | Any change to the carer's live view |
| D-07 | **Branch and legal-employer access.** Is there more than one legal employer (PAYE scheme) in one installation? Should payroll be run per branch? (Q7) | The data model has one company and branches; pay runs span all branches | Branch scope is enforced on pay: organisation records need organisation-wide pay access; a branch user sees only employees of their branches. No company structure was invented | Legal-employer scoping; per-branch pay runs |
| D-09 | **Closed payroll reopening.** May a closed UK run be reopened, or must every later change be a correction in a new run? | Reopening reverses posted year-to-date figures | Allowed with its own power; refused once a payout is approved or a live FPS exists. Corrections are available as the alternative | Phase 5 corrections design |
| D-10 | **Correction authority and thresholds.** Who may record and who may approve a pay correction? Is there a value above which a more senior approver is needed? Is a negative correction (recovery) allowed without the carer's agreement? | Corrections move money outside the normal run; a deduction from wages has legal conditions | Recording needs `billing.payroll_runs.manage`; a different user must approve; no value limit; one pending correction per visit; one reversal per item | Final shape of the corrections screen; a separate approval permission if wanted |

## 2. Further decisions raised by the work

| ID | Decision needed | Why it matters | Interim safeguard in place |
|---|---|---|---|
| D-08 | **Replacement carer after pay.** When a carer is swapped on a visit already paid to the first carer, is the first payment recovered automatically? | Two people may each be owed, or one overpaid | The replacement is held for a manager; recovery is a manual negative correction |
| D-11 | **Retention.** How long are pay records, corrections and the audit log kept, and who may delete them? | The audit log can no longer be cleared in production | Clearing is disabled in production |
| D-12 | **Test-data reset on staging.** Is a reset tool wanted? | The delete-all tools are off by default | Enabled only with `ALLOW_FINANCIAL_TEST_RESET=true` outside production |
| D-13 | **Holiday premium: actual day, substitute day, or both?** (Q15) | 25 and 26 December and 1 January are treated as premium days by date. When one falls on a weekend, the substitute bank holiday in the calendar is premium as well, so two days are paid at the premium | **The choice now exists as an organisation setting** (`holidayPremiumBasis`: both days / the date itself / the substitute day), changed only by a user with the pay card permission, with a reason, and audited. Its default is "both days", which is what was paid before, so nothing is re-priced until the client decides. It applies to carer pay only, and to visits priced after the change; approved and paid visits keep their amounts. The calendar itself says nothing about pay: a day earns more only where a pay card has a rate for it |
| D-14 | **Short visits paid as planned.** A visit shorter than planned by no more than the organisation's tolerance is paid for the planned time. The tolerance is the late-visit alert setting (20 minutes by default), else the global tolerance (30). Is that intended for pay, and is the punctuality setting the right source? | A carer who checks in 20 minutes late to a one-hour visit is paid for the hour | None; existing behaviour, recorded by a test |
| D-15 | **Mileage rate.** The default in code is 55p a mile for the first 10,000 miles (`UK_MILEAGE_RATES_2026_27`). Is that the rate Allfor Care pays, and has it been checked against the HMRC approved rate for the year? (Q33) | Mileage above the approved rate is taxable | **The rates are no longer in the code.** They are rows in `MileageRate` per period and vehicle type. The first period holds the rates the application was already using (55p / 25p after 10,000 miles for cars and vans, 24p motorcycles, 20p bicycles, 5p per passenger mile), so no amount changed, and it is labelled as not verified. HMRC's approved amounts are a separate set that counts only once a person records them with where they were checked. **Nobody has recorded them**, so every mileage line is marked "tax treatment not verified" and is not claimed to be tax-free. Once recorded, any part paid above the approved amount is taxed as pay automatically. The client is asked to (a) confirm its own rates per tax year and (b) have finance record the HMRC approved amounts for each tax year in use |

## 2a. Decisions raised by the Gate B sprint

| ID | Decision needed | Why it matters | Interim safeguard in place |
|---|---|---|---|
| D-16 | **Easter and organisation special days.** A pay card can carry a rate for "Easter" and for "Organisation special day". Which days does Easter cover (Good Friday and Easter Monday are already bank holidays; is Easter Sunday a premium day)? Which days, if any, does Allfor Care treat as its own special days? | Without an answer a card's Easter rate is never used, and a carer may believe they are owed it | No day is classified as Easter; the pay preview says so when a card has an Easter rate. Organisation special days can be entered in the calendar and are paid only where a card has a special-day rate; none was entered |
| D-17 | **Two pay cards for the same carers (PC-32).** When two active cards match a carer at the same level, the carer's visit pay is now held until the office ends one card or gives the carer a card of their own. Is that the wanted behaviour, or should one level-internal rule decide (for example "working branch before base branch")? | Before this sprint the most recently edited card was used without anyone being told. After it, carers who relied on that are held until someone acts | Held with the cards named; listed on the pay cards screen; the card form warns before saving; a personal card or ending one card settles it. **Before go-live the list at `GET /billing/pay-cards/conflicts` must be empty or accepted**, or pay for those carers will be held |
| D-18 | **Funding history (PC-10).** Where a client's funding has no start date and was entered after the visit, the system cannot tell who was funding on the visit day. Should the office be required to date every funding line? | A carer with a funder pay card is otherwise paid on the wrong card, or held | Held for review only when the carer has a pay card for one of the possible funders; everyone else is priced as before. The client charge is unchanged and still uses current funding |
| D-19 | **Travel, mileage and waiting on bank holidays (Q17).** Should a card's bank holiday rate for travel time, mileage or waiting time be used on a bank holiday? | Today it is not: the pay run does not pass the holiday flag for these, and these rules are not ranked by day type | Not changed, so no existing card pays differently. Recorded as finding V-12 |
| D-20 | **Mileage paid before this sprint.** Mileage recorded in UK payroll runs calculated before this sprint was never part of a payout made by this system. Was it paid another way, and should any of it now be paid? | It may be owed, or already paid outside the system; paying it automatically risks paying twice | Nothing historic is added to a payout by itself. `GET /billing/employee-payouts/reimbursements` lists every such amount per run and employee |
| D-21 | **Mileage correction after payment.** When miles are found to be wrong after the pay run is locked, how is the difference settled: as a reimbursement (outside taxable pay up to the approved amount) or as a pay adjustment? | The only correction that exists today is a pay adjustment, which is taxed as wages | Miles cannot be edited on a settled visit; the screen says to use a pay correction. A reimbursement-type correction is backlog item R-21 |

## 3. Interim technical direction (as the brief recommends)

| Direction | State |
|---|---|
| Never automatically approve a financial run | In place: the monthly job proposes drafts only |
| Never mark payments settled without recorded evidence and a clear evidence classification | In place: reference and date required; classified `MANUAL_ENTRY` |
| Preserve existing payroll history | In place: triggers, claims, corrections instead of edits |
| Hold incomplete or conflicting earnings for review, without causing avoidable underpayment | In place: held rows are still priced and visible; the office can verify and release them |
| Do not use incomplete provisional visit earnings in the normal payroll route | **Not decided.** Provisional visits are still accepted (D-03) |
| Require explicit financial permissions | In place: six powers never implied by an admin role |
| Prefer corrections over reopening externally reported payroll | In place: reopening is refused once a live FPS exists |
| Preserve the distinction between employment pay and client charges | In place: separate decisions once pay is settled |

## 4. Decisions the next phases need first

| Phase | Decisions | Audit questions |
|---|---|---|
| 1 Pay cards | D-17 (overlap policy); which rate dimensions are contractual; approval before a card is published; D-13; D-16; D-19 | Q5, Q15, Q16, Q17 |
| 2 Visits, travel, expenses | Pay for cancelled / late-cancelled / missed / no-access visits; what travel time is paid and how it is evidenced (travel against waiting, breaks and commuting); D-15; D-20; D-21; other expenses | Q13, Q14, Q32, Q33, Q34 |
| 3 Salary, guarantees, leave | Salary basis and what it covers; guaranteed hours; overtime basis; holiday method by contract type; contractual sick pay | Q22–Q24, Q29, Q35, Q36 |
| 4 Minimum wage | Pay reference period; which hours count; how apprentices are identified; contractual wage floors | Q25, Q27, Q37–Q39 |
| 5 Statutory payroll | Pay frequencies; pension scheme and provider; treatment of fines and other deductions | Q2, Q40 |
| 6 Payments | D-04 | Q41 |

The brief states that CareFlow is to run its own statutory payroll engine, so audit Q1 (in-house or bureau) is treated as answered: in-house.
