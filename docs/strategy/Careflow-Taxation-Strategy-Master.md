# Careflow taxation — master brief

Implementation vs law vs payroll products vs care software. **Enterprise full PAYE is the chosen path** (no CSV-to-Sage shortcut).

**Companion:** [Careflow-Finance-Strategy-Master.md](./Careflow-Finance-Strategy-Master.md)

**Merged from:** Careflow tax/PAYE code audit · UK HMRC/law brief · general UK payroll products · care-industry software payroll/tax (Aug 2026).

---

## Cross-agent conclusion

Careflow already has what most care apps lack: a real tax+NI engine and RTI path. Most care products only do gross → export. Enterprise payroll products (Sage, BrightPay, Staffology, Access Payroll) define the table stakes Careflow must finish. Law requires loans, AE, statutory pay, Scotland, and HMRC-recognised FPS/EPS — still unfinished in code.

| Signal | Meaning |
|---|---|
| Phase 3 | PAYE + Class 1 NI calculated |
| Configured | Loans / pensions / AOE flags only |
| Gap | Scotland, SMP/SSP engines, IRMark, payslips/Bacs |
| Rare | Care ops + native PAYE in one product |

---

## 1. Careflow implementation today

| Area | Status |
|---|---|
| PAYE cumulative + W1/M1, England bands, tax codes | CALCULATED |
| Class 1 EE/ER NI (main letters) | CALCULATED |
| YTD ledger, close/reactivate, run lifecycle | Live |
| FPS/EPS plumbing, dual-control, Gateway gates | Partial (IRMark stub; XSD year hardcodes) |
| Student / PG loans | CONFIGURED only |
| Pensions / AE | CONFIGURED only |
| Scotland / Wales band engines | S/C stripped → ENG % applied |
| SSP/SMP/SPP/SAP/ShPP/SPBP/SNCP | Manual EPS zeros — no pay engines |
| AOE / DEA amounts | Catalogue only; UI hidden |
| Employment Allowance maths / Apprenticeship Levy | Flag / deferred |
| P60 / P11D / Bacs / payslips | Absent |
| PA taper, tax refunds, director NI | Missing |

**Key files:** `payroll-statutory.util.ts`, `payroll-runs.service.ts`, `payroll-fps*.ts`, `uk-payroll-2026-27.catalog.ts`.

**Honest label:** England basic PAYE+NI + RTI skeleton — not full UK taxation.

### Accuracy risks (code)

1. Explicit disclaimer: student loans / pensions / Scotland bands not included in `calculatePeriodStatutory`
2. S/C tax codes → ENG % bands
3. Scottish `D2` treated as `D1`
4. Reduced NI 1.85% hardcoded for some letters (not from rate set)
5. No tax refunds on cumulative overpayment
6. Gross for tax = `totalGross` — no pensionable/taxable vs NI-able split
7. FPS XML: `CarePreview` IRmark; schema namespace hardcodes `24-25`

---

## 2. What HMRC / TPR require (2025/26–2026/27)

| Duty | Enterprise must-have |
|---|---|
| PAYE | ENG + Scottish 6-band + Welsh `C`; cumulative + W1/M1; refunds; P9X rollover |
| Class 1 NI | Full letter matrix; director annual method; freeport/veteran reliefs |
| Student loans | Plans 1/2/4/**5** + PGL; SL notices; Plan 5 default from Apr 2026 |
| AE pensions | Assess each period; 8%/3% minima; re-enrol; remittance by 22nd |
| Statutory pay | SSP (2026 day-1 + 80% AWE reform); SMP/SPP/SAP/ShPP/SPBP/SNCP; EPS reclaim (**not** SSP) |
| EA / Levy | £10,500 EA via EPS; 0.5% levy + £15k allowance if pay bill > £3m |
| RTI | FPS on/before payday; EPS by 19th; nil; corrections; RIM + IRMark + recognition |
| Year-end | P60 by 31 May; P45; P11D(b); mandatory BiK payrolling from Apr 2027 |
| Attachments | AEO / CTAEO / DEO / DEA with protected earnings |

**Hubs:** [rates and thresholds](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027) · CWG2 · [RTI RIM specs](https://www.gov.uk/government/collections/real-time-information-online-internet-submissions-support-for-software-developers) · TPR AE · [HMRC recognised payroll software](https://www.gov.uk/guidance/find-payroll-software-that-is-recognised-by-hmrc)

---

## 3. Payroll products — table stakes

Serious commercial payroll (Sage, Xero, BrightPay, Staffology, etc.) converges on:

- PAYE + NI (+ Scotland via codes)
- Student + postgraduate loans
- AE pensions
- Statutory suite
- FPS/EPS
- Payslips + P60
- Multi-frequency (weekly→monthly)

**Differentiators:** P11D/BIK, Bacs bureau, multi-employer, HR/ERP, approvals.

### If Careflow claims native PAYE it must ship

1. HMRC-recognised FPS/EPS  
2. PAYE + NI + Scotland  
3. Student + PG loans  
4. AE + scheme files  
5. Statutory suite  
6. Payslips + P60 + P45  
7. Weekly calendars + depts  
8. Bacs / bank file  

FreeAgent monthly-only and Basic PAYE Tools (no AE, &lt;10 staff) are not care-viable targets.

---

## 4. Care software — what they sell and why agencies buy

**Market reality:** Birdie, Nourish, CareLineLive, Log my Care, iStaffRota = gross / payroll-ready → export. Native PAYE appears via **Access Payroll**, **OneAdvanced**, **Workmax**, **PayCaptain** — not inside Birdie.

| Why finance buys care software | Implication |
|---|---|
| Visits → invoice + gross without spreadsheets | P0 care ops finance |
| Cashflow / multi-funder billing / margin | Charge + invoice parity |
| NLW risk (travel/waiting/mileage) | Keep/strengthen NLW engine |
| Keep BrightPay/Sage/bureau | Also ship excellent exports |
| One-vendor roster→PAYE at scale | Enterprise full PAYE bet |
| Avoid PAYE lock-in (Log my Care) | Optional depth, honest catalogue |

Careflow’s rare position: already building the native PAYE layer peers partner for. Win by finishing tax completeness while staying best-in-class on visit→gross→NLW.

---

## 5. Combined feature wishlist

### Care-ops finance

- Visit/ECM reconcile → paid time  
- Travel, waiting, commute rules  
- Mileage; sleep-in / waking night  
- Enhancements / BH; rate cards  
- NLW shortfall + top-ups  
- Holiday / irregular hours  
- Multi-funder invoice + margin  
- Sage/BrightPay/Xero export  

### Enterprise PAYE

- ENG/SCO/WLS tax engines  
- Full NI + director method  
- Student loans 1–5 + PGL  
- AE + NEST/provider files  
- Statutory pay + EPS recovery  
- FPS/EPS + HMRC recognition  
- Payslips, Bacs, P45/P60/P11D  
- AOE/DEA; EA; Levy  

### Glue (native PAYE care)

Approved hours → taxable vs NI-able vs expense elements; pre-FPS exception review; pensionable pay from care elements; immutable closed runs.

---

## 6. Ranked path to “have all of those”

| Pri | Ship | Driven by |
|---|---|---|
| P0 | Hard lock + gross integrity into UkPayrollRun | Code risk + Access-level trust |
| P0 | Care gross excellence: travel/waiting/NLW/sleep-in/waking wired | Why agencies buy care software |
| P0 | Charge parity (banded + overnight) + multi-funder invoices | Finance cashflow/margin buys |
| P1 | Student/PG loans + Scotland tax + AE contributions → CALCULATED + FPS fields | Law + Sage/BrightPay table stakes |
| P1 | Real IRMark + current RIM XSD + HMRC test/recognition path | RTI production + law |
| P1 | BrightPay/Sage/Xero export quality (parallel to native) | How most agencies still operate |
| P2 | Statutory pay engines (incl. 2026 SSP reform + SNCP) + EPS reclaim | Law + care absence reality |
| P2 | Payslips, Bacs, P45/P60; weekly calendars; dept splits | Payroll product table stakes |
| P3 | AOE/DEA; EA maths; Levy; P11D/BIK roadmap to 2027 | Enterprise / bureau parity |
| P3 | Multi-PAYE entity; early pay; ContrOCC/CM2000 | Access/OneAdvanced/CLL territory |

---

## Bottom line

Careflow is ahead of Birdie-class apps on native tax plumbing, and behind Sage/BrightPay on statutory completeness. Finishing loans + Scotland + AE + real RTI + statutory pay — while keeping care gross/NLW/billing best-in-class — is how you get the combined feature set agencies currently buy from two vendors (care app + payroll product).
