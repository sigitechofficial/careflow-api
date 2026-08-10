# Careflow finance — master strategy

Single merged brief: Careflow billing/pay code truth · UK market norms · competitor software · how to win · enterprise full PAYE.

**Companion:** [Careflow-Taxation-Strategy-Master.md](./Careflow-Taxation-Strategy-Master.md)

**Sources:** code deep-dive (careflow-api / admin), Homecare Association / Care Act / HMRC / Skills for Care, public competitor docs (Aug 2026).

---

## One-line standing

Architecture matches the market. Pay is close to leaders. Charge methods and run locks are behind. Strategic bet: ship LA charge parity + immutable locks, and finish **native UK PAYE** (not CSV-to-Sage) as the enterprise moat.

| Dimension | Status |
|---|---|
| Architecture (charge ≠ pay + recon) | Peer |
| Pay engine | Near peer |
| Charge products + lock trust | Behind |
| Enterprise full PAYE | Chosen path — foundation exists |

---

## 1. How Careflow bills and pays today

Completing a visit creates `VisitReconciliation` (one per carer on double-ups) with both `payableAmount` and `billableAmount`. Visit plans only set schedule/duration — rates come from **Pay Cards** and **Charge Cards**.

```
ScheduledJob / Visit + Allocation
  → ensureForVisit / ensureForCompletedJob
  → evaluate (resolve cards, calc, exceptions)
  → APPROVED_FOR_PAY (auto if priced) and/or finance approve invoice
  → billing PayrollRun + InvoiceRun
  → UkPayrollRun (PAYE) → payouts
```

### Charge card selection

1. `EXPLICIT_FUNDING` — `currentFunding.defaultChargeCard`
2. `EXPLICIT_SERVICE_USER` — `serviceUser.defaultChargeCard`
3. `EXPLICIT_FUNDER` — `funder.defaultChargeCard`
4. **MATCHED** hierarchy: funding contract → SU → funder → package → branch → org  
   (`SERVICE_TYPE` / `HOUSEHOLD` currently passed as null)
5. `NONE` → `CHARGE_CARD_MISSING`

### Charge amount

Day/BH ladder → exact ≤60m fixed slot → open hourly × minutes/60.

Runtime effectively ignores `WEEKLY_PACKAGE`, `MONTHLY_PACKAGE`, `SLEEP_IN`, `WAKING_NIGHT`, `BANDED_DURATION`, `DAILY_RATE`. No charge-side time-band split. Multi-carer `FIXED` zeros non-lead billable; `COMBINED` bills each carer. Invoice runs use stored `billableAmount` + funding % splits (last-line remainder).

### Pay card selection

1. `EXPLICIT` — `employment.defaultPayCard` if ACTIVE + effective
2. **MATCHED:** individual → `CLIENT_FUNDER` (dead path) → role → branch → employment type → worker type → org
3. `NONE` → `PAY_CARD_MISSING`

### Pay amount

Day/BH + clock bands; FIXED/PER_VISIT ≤60m else banded with PRIORITY/HIGHEST/STACK. Unmatched band → whole visit unpaid. Overrun pending/rejected → pay planned; approved → pay actual. `PayrollRun` adds mileage (AMAPs or card), travel, waiting, NMW top-up. Employment day/night rates unused for visits. Sleep-in/OT utils exist but unwired.

### Approval model

Pay auto-approves when priced (funding/PO/tasks can remain as invoice exceptions). Invoice needs `APPROVED_FOR_INVOICE` / `BOTH`.

### Highest code risk

Payroll/invoice “lock” sets `lockedAt` / `includedIn*RunId` but not `status: LOCKED`. `evaluate` / `getById` can still recalculate amounts. `setPayableAmount` is overwritten by `safeEvaluate` on `getById`.

### Sleep-in vs waking night

| Product | Charge (market) | Pay (market) | Careflow today |
|---|---|---|---|
| **Sleep-in** | Usually fixed nightly fee | Allowance + awake working time (Mencap: asleep ≠ NMW) | Enums + `pay-overnight.util` — **not wired** |
| **Waking night** | Hourly × night hours | Hourly; convert sleep-in if required | Same — **not wired** |

---

## 2. UK England market norms

| Topic | Norm |
|---|---|
| Buy unit | Hourly and/or banded visit fees (15/30/45/60); fixed sleep-in; waking night hourly |
| HA Min Price 2025–26 | ~£32.14/hr benchmark (excl. weekend/BH); LA averages often lower |
| Packages / PO | Authorised hours under framework/DPS/spot; PO/ref often required |
| Split funding | LA + client contribution / top-up; NHS CHC usually 100% NHS |
| Worker pay | Day/evening/night/weekend/BH bands; travel between clients = NMW time; AMAPs mileage |
| Systems pattern | Separate charge vs pay cards; confirmed visit forks to invoice + payroll |

Refs: Homecare Association Min Price; Care Act §4.31; gov.uk NMW hours; Mencap v Tomlinson-Blake; HMRC AMAPs; Skills for Care pay.

---

## 3. Competitors (public docs)

**Pattern:** Confirm visit → reconcile gate → charge cards → invoice · pay cards → gross/PAYE export. Most peers export to Sage/Xero — few own full PAYE.

| Area | Best public evidence | Careflow |
|---|---|---|
| Banded charge maths | Birdie, CareForIT, Access duration overrides | Gap |
| Sleep-in / waking | CareForIT, iStaffRota, Log my Care | Gap (unwired) |
| Hard lock after runs | Access | Gap (soft lock) |
| NLW productisation | Birdie | Partial (util + top-up) |
| Travel/waiting/commute | Birdie | Partial |
| Full native PAYE | Rare among care apps | Foundation — chosen bet |

**Snapshots**

- **Birdie** — banded/fixed/service/travel/holiday; confirm→invoice/payroll; split funders; ECM; NLW tool; sleep-in not named first-class.
- **Access** — invoice vs pay rate sheets; duration overrides; time-frame splits; hard reconcile before completed runs.
- **CareFor/CLL** — funder×assignment cards; banded/pro-rata; waking-night pay; overnight invoice UX; CLL split + CM2000/ContrOCC.
- **iStaffRota** — multi-funder, overnight bill, sleep-in pay enhancements, GPS→export.

Nourish help largely gated. Unknown ≠ missing — demo before roadmap bets.

---

## 4. How to win

### Parity (must-not-lose)

- Real banded + fixed + sleep-in + waking-night charge
- Immutable lock after invoice/payroll include
- Funder cards + split invoices
- Confirm/reconcile before both ledgers

### Wedge (beat Birdie/Access)

- Four-value time: plan / actual / pay / bill
- Unbilled-payable + margin-by-slot
- Best-in-class NLW hours → PAYE
- Sleep-in → waking convert with evidence

### Moat (hard to copy)

- Allocate/ops ↔ finance closed loop
- Enterprise full PAYE + RTI (**chosen**)
- Double-up FIXED/COMBINED clarity
- ECM packs once charge engine is real

### Do not waste cycles

- Out-feature Nourish from public web alone
- More unwired assignment levels
- UI for package/sleep-in without calc
- Market “full PAYE” while loans/SMP are flags only

---

## 5. Enterprise full PAYE (chosen — no shortcuts)

**Decision:** Native UK PAYE + RTI inside Careflow — not CSV-to-Sage. Target: calculate statutory deductions, payslips/Bacs, real FPS/EPS, year-end artefacts.

See [Careflow-Taxation-Strategy-Master.md](./Careflow-Taxation-Strategy-Master.md) for full tax law / product / gap detail.

### PAYE today (summary)

| Layer | Status |
|---|---|
| Visit pay → UkPayrollRun gross | Live |
| Cumulative PAYE + Class 1 NI + YTD | Calculated |
| FPS/EPS plumbing | Partial (IRMark stub; XSD year hardcodes) |
| Student loans / pensions / AOE | Configured only |
| SMP/SSP engines | Manual EPS only |
| Scotland/Wales tax bands | Not calculated (ENG applied) |
| Payslips / Bacs / P60 / P11D | Absent |

---

## 6. Unified roadmap

| Wave | Ship | Why |
|---|---|---|
| **0 — Trust** | Hard lock; stop `setPayableAmount` overwrite | Access-level finance trust; PAYE P0 |
| **1 — Charge honesty + parity** | Banded 15/30/45/60; FIXED sleep-in; waking-night hourly; wire or hide package methods; funding.hourlyRate | Match how LAs buy |
| **2 — Overnight pay** | Wire sleep-in allowance + awake NMW + convert-to-waking | Clearer than Birdie public overnight story |
| **3 — Margin wedge** | Billable vs payable; unbilled-payable; charge time bands; margin-by-slot | Sales killer vs export-only peers |
| **4 — PAYE statutory + RTI** | Loans, pensions, nations, AOE → CALCULATED; real IRMark/XSD; HMRC test green | Enterprise moat |
| **5 — PAYE ops + packaging** | Payslips/Bacs/P60; funder cycles; ECM; statutory payment engines | Full month without external payroll |

### Code gaps ranked

| Sev | Gap |
|---|---|
| P0 | Lock does not freeze amounts; manual payable overwritten |
| P0 | Charge methods in schema/UI not implemented in calc |
| P1 | Cancel/void recon; CLIENT_FUNDER + SERVICE_TYPE/HOUSEHOLD dead |
| P1 | Sleep-in/OT utils orphaned; funding.hourlyRate unused |
| P2 | STACK/HIGHEST untested; stackingPolicy not in admin UI |
| P2 | EASTER never auto-resolved; charge minutes not split on multi-funder lines |

---

## Key files

| File | Role |
|---|---|
| `billing-cards.service.ts` | `resolveForEmployee` / `resolveForServiceUser` |
| `visit-reconciliations.service.ts` | Evaluate / approve bridge |
| `visit-reconciliation.util.ts` | payable/billable + `pickBestRule` |
| `pay-time-band.util.ts` | Banded pay + stacking |
| `invoice-runs.service.ts` / billing `payroll-runs.service.ts` | Invoice & care payroll |
| `src/payroll/*` | UK PAYE gross → statutory → FPS/EPS |
| `uk-payroll-2026-27.catalog.ts` | Honest CALCULATED / CONFIGURED / DEFERRED |

---

## Bottom line

Fix trust → ship LA charge products → own margin/overnight transparency → finish enterprise PAYE. That combination beats Birdie, Access, and CareFor — architecture alone does not.
