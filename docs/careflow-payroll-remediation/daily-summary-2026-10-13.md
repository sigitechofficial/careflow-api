# Daily Summary — 13 October 2026

**Project:** CareFlow carer wages, pay cards and UK payroll remediation
**State:** all work is local. Nothing was pushed, deployed, or run against live data, HMRC or a bank. All test data is synthetic.

| Repository | Branch | Head |
|---|---|---|
| `careadmin-backend` | `payroll-remediation/sprint-b4d` | `3332918` |
| `care-admin` | `payroll-remediation/sprint-b4d` | `fb5ce7d` |

---

## 1. What was done today

Six pieces of work, each on its own branch on top of the last.

| Sprint | Result | Report |
|---|---|---|
| Gate B2 | Employment wages: salary and part periods, guaranteed hours, overtime across pay runs, travel and waiting time, cancelled visits, holiday terms, minimum wage by pay reference period | `12` |
| B3 | An overpayment is no longer deducted by itself: it becomes a proposal that a second person authorises. Minimum wage is checked for salaried staff. Pay periods longer than a month are never used; UK dates decide the period | `13` |
| B4A | Two screens: **Wage recoveries** (authorise or reject, with authority and reason) and **Minimum wage compliance** on the UK payroll run (review of exceptions; a confirmed shortfall cannot be reviewed away) | `14` |
| B4B | Fixed a crash that stopped the whole API when an audit entry failed. Salaried basic hours now come from an approved annualisation method, never an assumed 52 weeks; excess hours are decided from the calculation year | `15` |
| B4C | Settings screen for the annualisation method (enter, approve as a second person, withdraw). Visit pay approvals and payroll profile changes are saved together with their audit entry | `16` |
| B4D | The same guarantee for pay agreements and for every other change to the pay of a visit (time edit, manual amount, attendance correction, withdrawn approval, recalculation) | `17` |

---

## 2. Test results (end of day)

| Suite | Result |
|---|---|
| Backend payroll integration and HTTP | 459 of 459 passed (45 suites) |
| Backend unit, pay-related modules | 554 of 554 passed (78 suites) |
| Migration rehearsal on a scratch database (last run, B4B) | 61 of 61 checks passed |
| Frontend, pay-related (last run, B4C) | 92 of 92 passed; type-check clean |
| Browser checks on the test instance | Gate B2, B4A and B4C screens checked |

One test failed once during the day (B4A): an assertion in a new test counted rows left by earlier runs. It was corrected and passed. Whole-repository suites were not run; the unrelated failures noted yesterday were not touched.

---

## 3. Database

New migrations in Gate B2, B3, B4A and B4B, all additive: new tables and nullable columns only. No row was changed and no locked pay record was touched. B4C and B4D changed no schema. Applied only to the local development and test databases.

---

## 4. Not finished or blocked

- **Salaried minimum wage is not live.** Until the employer's annualisation method is entered and approved, salaried staff show "policy review required" and nothing is topped up.
- **Paid absence** (holiday, sickness at full salary) is not yet counted in a salaried worker's hours for the year.
- **Audit entries still written after the change:** payroll settings, leave, disruption pay rules, pay evaluation retries, HMRC submission records.
- **Found today, not fixed:** a manually entered client charge amount writes no audit entry; a pay-window edit can silently have no effect; superseded pay agreements have no entry of their own.
- **Sign-off:** no gate is signed off. Each needs independent review and client acceptance testing.

---

## 5. Needed from the client

1. The multiplier for turning contracted weekly hours into a year (52, 52.14, 52.18 or other), where it is written down, and from what date.
2. On what authority an overpayment may be deducted from wages, who may authorise it, and any limit (D-23).
3. True contract start dates for staff who were salaried before their first CareFlow agreement.
4. How leave hours are recorded, so that paid absence can count towards the year.
5. The Gate B2 policy decisions still open in report `05`, section 2b.

---

## 6. Next

Recommended next sprint (B4E): audit the manual charge amount, record superseded agreements in the approval's entry, tell the user when a pay-window edit had no effect, then the remaining small audit gaps.

Full detail: reports `12` to `17` in this folder.
