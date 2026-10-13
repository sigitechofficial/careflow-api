# Daily Summary — 12 October 2026

**Project:** CareFlow carer wages, pay cards and UK payroll remediation
**State:** all work is local. Nothing was pushed, deployed, or run against live data, HMRC or a bank.

| Repository | Branch | Head |
|---|---|---|
| `careadmin-backend` | `payroll-remediation/gate-b` | `ccf5741` |
| `care-admin` | `payroll-remediation/gate-b` | `b36a61f` |

---

## 1. What was done today

**Earlier in the day — Phase 0 and the Gate A sprint (R-01 to R-12).** Financial safety controls: one earning can be paid once, locked pay is protected by the database, corrections go through an approved ledger, payments are never marked as bank-confirmed, pay screens respect branches. Closed at backend `035e482`, frontend `01da8a2`.

**Then — the Gate B sprint (this document's main subject).**

| Area | ID | Result |
|---|---|---|
| Attendance | R-16 | Each carer's attendance evidence is stored separately and safely when two people save at once |
| Failed calculations | R-17 | A pay calculation that fails is shown to the office with a reason, not just logged |
| Approvals | R-18 | An approval is re-checked when the attendance evidence under it changes |
| Branch users | R-13 | Branch-limited staff get working pay screens for their branches |
| Browser checks | R-11 | Six financial flows carried out in a browser on synthetic data |
| Local day | PC-19 | Rates follow the UK local day (fixes visits just after midnight in summer) |
| Conflicting cards | PC-32 | Two pay cards for one carer are reported and held, not settled by the last edit |
| Funding history | PC-10 | A funder pay card follows the funder on the day of the visit |
| Holidays | PC-22, PC-23, PC-24 | One holiday calendar: three nations, substitute days, organisation days, gap check |
| Mileage rates | TR-09 | Rates are recorded per period; yearly miles are counted correctly |
| Mileage payment | TR-13 | Mileage now reaches the carer's payment, once, shown apart from wages |

---

## 2. Test results (Gate B sprint)

| Suite | Result |
|---|---|
| Backend integration and HTTP | 264 of 264 passed (26 suites) |
| Backend unit, billing and payroll | 349 of 349 passed (48 suites) |
| Migration rehearsal on a scratch database | 45 of 45 checks passed |
| Frontend, pay-related | 86 of 86 passed; type-check clean |
| Browser flows (manual) | 6 of 6 passed |

Outside this project, 18 backend and 16 frontend tests fail in unrelated modules. They were failing before today's work and were not touched.

---

## 3. Database

Six new migrations, all additive: new tables and columns only. No table, column or row was dropped and no locked pay record was changed. Applied only to the local development database and local test databases.

---

## 4. Not finished or blocked

- **Mileage tax:** nobody has recorded HMRC's approved mileage amounts, so all mileage is marked "tax treatment not verified".
- **Old mileage:** mileage from payroll runs before today was never paid through this system. It is listed, not paid automatically.
- **Holiday calendar data:** on the development database, 2027 is empty and Scotland and Northern Ireland have no dates.
- **Pay run:** some errors on training, on-call, overtime and holiday lines are still not reported (backlog R-22).
- **Mobile app:** not available, so not checked.
- **Sign-off:** Gate A and Gate B are not signed off. Both need independent review and client acceptance testing.

---

## 5. Needed from the client

1. Which day is paid when a holiday falls on a weekend (D-13).
2. The organisation's mileage rates, and HMRC approved amounts recorded by finance (D-15).
3. Review of carers who match two pay cards, on a copy of real data, before go-live (D-17).
4. Who approves pay runs, payroll and payouts (D-01).
5. Whether mileage from earlier payroll runs was paid another way (D-20).

---

## 6. Next

Recommended next sprint: salary and proration, guaranteed hours, overtime across pay runs, travel versus waiting time, cancellation pay, holiday entitlement, apprentice and minimum wage period. Each needs a client decision first.

Full detail: reports `01` to `11` in this folder.
