# Visit plan & rota — confirmation & guided questions UX

**Purpose:** Where coordinators need **preview**, **explicit confirm**, or **guided questions** before rota/plan changes stick.  
**Companion:** [VISIT_PLAN_REAL_WORLD_SCENARIOS.md](./VISIT_PLAN_REAL_WORLD_SCENARIOS.md) (what happens) · §13 (now vs ideal rota).

---

## 1. Interaction tiers

| Tier | UX pattern | When to use |
|------|------------|-------------|
| **A — Inline inform** | Live preview text under checkbox/date (no extra click) | User still editing; impact depends on dates/toggles |
| **B — Modal + submit** | Full dialog: required fields, toggles, inline preview, primary action | Audit fields + optional rota impact |
| **C — Confirm gate** | Second step: “You are about to cancel **12** visits…” + **Confirm** / **Back** | High impact, irreversible, or easy to misuse |
| **D — Guided branch** | “What happened?” → routes to absence vs suspend vs end | User might pick wrong tool |

**Principle:** Preview **before** submit (tier A/B). **Confirm** when count > 0 or action ends/suspends package (tier C). **Branch** when catalog suggests wrong path (tier D).

---

## 2. What exists today

| Flow | Tier | What user sees |
|------|------|----------------|
| **Record absence** | A + B | Dialog; `applyToSchedule` checkbox; live count of jobs cancelled/called off + skip dates |
| **Suspend package** | B | Dialog; reason catalog, contingency, review date; pause date; retrospective if backdated; cancel toggle + visit count |
| **End package** | B | Dialog; last day, retrospective if backdated; cancel toggle + visit count |
| **Re-activate** | B | Optional note; mentions generate rota (no preview) |
| **Employee holiday** | A + B | `applyToSchedule`; preview unallocate count (panel) |
| **Live plan amendment** | C | Amendment reason required; preview + confirm when rota impact > 0 |
| **Activate draft** | C | Activate dialog with optional cancel of ended package jobs |
| **Generate rota** | B/C | Preview modal before create; backfill acknowledgement |
| **SKIP exception** | C | Applied on amendment save with `applyScheduleImpact` |
| **End absence** | C | Return-impact preview + optional generate prompt |

---

## 3. Recommended confirmations by scenario

### 3.1 Client absence (Record Absences)

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Open dialog | D | If reason = hospital/holiday: “Known dates? Use absence. Whole package off indefinitely? Use Suspend on visit plan.” | Wrong-tool prevention |
| Past start date | B | **Required:** retrospective correction (✅ today) | CQC |
| `applyToSchedule` unchecked | C | “Rota will **not** change — visits may still show as due.” **Confirm record only** | Phantom visits |
| Preview count > 0 | A | “**N** visits cancelled/called off; **M** skip dates on plan” | Already partial |
| Preview count > 10 | C | Extra confirm step with breakdown (cancelled vs call-off) | High impact |
| Unplanned type | A | “Unplanned absences use **call-off** on rota (not cancel).” | Policy education |
| Save success | A | Toast with actual `scheduleImpact` (✅ today) | Closure |

**Ideal add:** “Welfare check completed?” checkbox (optional, audit) for hospital/safeguarding reasons.

---

### 3.2 End absence / return home

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Set end date / delete absence | C | “Cancelled visits are **not** auto-restored. Generate rota from **{return date}**?” [Generate now] [Later] | Gap 4.7 |
| Package still **SUSPENDED** | C | “Package is still suspended — re-activate before generating.” [Go to Set up visits] | Gap 8.2 |

---

### 3.3 Suspend package

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Pause reason = HOSPITAL/HOLIDAY | D | Banner: “Prefer **Record Absences** if dates are known.” (✅ partial) | Tier D |
| Cancel visits unchecked | C | “**Warning:** Future visits may remain on the rota while package is suspended.” **I understand** checkbox | Phantom visits |
| Indefinite + no expected resume | B | Ask: “Review suspension by” (✅ default +7d) | CQC review |
| Backdated effectiveFrom | B | Retrospective reason (✅) + preview count | Audit |
| Preview > 0 | C | “Suspend package and cancel **N** visits from **{date}**?” | Tier C |
| Submit | B | Contingency / welfare notes encouraged for SAFEGUARDING/FUNDING | CQC |

**Ideal add:** If `expectedResumeAt` set: “Auto-remind on this date” (notification only, not auto-resume).

---

### 3.4 End package

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Future last day (scheduled closure) | B | Explain: “Package stays **active** until **{date}**; visits until day before.” (✅ inline) | Clarity |
| Today / past end | C | “Permanently close package — cannot edit after this.” | Irreversible |
| Backdated | B | Retrospective + preview (✅) | Audit |
| Preview > 0 | C | “End package and cancel **N** visits from **{date}**?” | High impact |
| Completed visits in range | A | “Completed visits are **not** removed — review billing/incidents separately.” | Governance |

---

### 3.5 Re-activate package

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Before re-activate | C | “This makes the package **live** again. Generate rota separately.” | Expectation |
| After success | C | “Generate visits from **{tomorrow}**?” [14 days] [Skip] | Close loop |
| Carer assignments empty | A | “No carers on **{slot}** — jobs may be unallocated.” | Cover risk |

---

### 3.6 Activate draft (first time or new package)

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Another ACTIVE plan exists | C | “Activating ends the current live package (**{calls}**, effective **{range}**). End old rota jobs?” [Preview] [Activate only] | Gap 2.9 |
| No enabled slots | B | Block with message (✅ API) | — |
| No weekly hours | B | Block (✅) | — |
| After activate | A | “Generate rota to create visits.” (✅ toast) | — |

---

### 3.7 Record amendment (live ACTIVE plan)

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Days of week reduced | C | Preview: “**N** future visits on removed days will be **cancelled**” (when built) | Gap 3.5 / 2.2 |
| Slot disabled | C | Preview: “**N** future visits for **{slot}** will be cancelled” | Gap 3.5 |
| Visit time changed | C | Preview: “**N** visits will be **rescheduled** to **{new time}**” | Gap 3.3 |
| Carer changed | A | “Carer sync from today on this slot” (info only today) | Sets expectation |
| Amendment reason empty | B | Block save (✅) | CQC |
| No rota change detected | A | “Pattern updated; existing rota unchanged.” | Honesty until sync built |

**Ideal:** Single **“Review rota impact”** step before save when diff affects schedule.

---

### 3.8 Generate rota (Step 5)

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Before generate | B/C | Preview: “**N** visits to create, **M** skipped (absence), **K** already exist” | Avoid surprise |
| Backfill > 0 | C | “Creating visits in the **past** for billing — confirm authorisation.” | Audit |
| Range > 31 days | B | Block (✅ API) | — |
| Plan SUSPENDED/ENDED | B | Block (✅) | — |
| After generate | A | Toast visits created/skipped (✅) | — |
| Zero created | A | “All dates absent or already scheduled.” | Explain empty result |

---

### 3.9 Slot SKIP exception

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Add SKIP | C | “Cancel existing visit on **{date}**?” [Yes] [Record only] (when built) | Gap 2.7 |
| Today until built | A | “Existing board visit may need manual cancel.” | Honesty |

---

### 3.10 Slot EXTRA exception

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Add EXTRA | C | “Create additional visit on **{date}**?” + commissioner approval note (future) | Phase 3 |

---

### 3.11 Carer holiday / NCA (employee)

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| `applyToSchedule` unchecked | C | “Carer remains on rota — visits need manual cover.” | Same as absence |
| Preview unallocate > 0 | A | “**N** visits need cover” (✅ partial) | — |
| High unallocate count | C | “**N** visits unallocated — open scheduling board?” [Open rota] | Workflow |

---

### 3.12 Scheduling board (manual cancel / unallocate)

| Moment | Tier | Show / ask | Why |
|--------|------|------------|-----|
| Bulk cancel | C | Reason + outcome (existing visit cancellation constants) | Billing/CQC |
| Cancel completed visit | C | Strong warning + manager reason | Governance |
| Unallocate last carer on double-up | A | “Visit still needs **2** carers.” | Cover |

---

## 4. Questions to ask users (catalog)

Use these as **required fields**, **checkboxes**, or **branching** — not all on every form.

| Question | When | Stored as |
|----------|------|-----------|
| Why is this being recorded? | All suspend/end/amendment | `reason` / amendment |
| Why **now** if date is in the past? | Backdated absence/suspend/end | `retrospectiveReason` |
| Who is responsible for welfare during the gap? | Hospital, suspend, safeguarding | `contingencyNotes` / absence notes |
| When will we review this decision? | Suspend, indefinite pause | `reviewDueAt` / `suspensionReviewDueAt` |
| Should the rota update automatically? | Absence, holiday, suspend/end | `applyToSchedule` / `cancelFutureVisits` |
| Is the client expected home on **{date}**? | Hospital absence | `endDate` |
| Should visits resume automatically when absence ends? | Future | reinstate preference (not built) |
| Commissioner / family informed? | End, funding suspend | optional note (future) |
| Double-up still required? | Remove carer from slot | warning only |

---

## 5. Priority implementation order

| Priority | Flow | Tier | Depends on |
|----------|------|------|------------|
| **P0** | Suspend with cancel **unchecked** | C — warning + acknowledge | UI only |
| **P0** | Absence without apply to schedule | C — confirm record-only | UI only |
| **P1** | Activate draft while another ACTIVE | C — end old plan + optional rota preview | Preview API for ended plan jobs |
| **P1** | After re-activate | C — offer generate | Existing generate |
| **P1** | End absence | C — prompt regenerate | — |
| **P2** | Live amendment (days/slot/time) | C — preview impact | Amendment impact service |
| **P2** | Generate rota | B — preview counts | Generate preview API |
| **P2** | SKIP exception | C — cancel existing job | Slot/date impact API |
| **P3** | Guided absence vs suspend | D — router | Copy only |
| **P3** | Welfare checkbox on hospital | B | Optional audit field |

---

## 6. Copy patterns (reuse)

**Preview loading:** “Checking rota…”  
**Preview zero:** “No cancellable visits in this range (plan skip dates may still be added).”  
**Preview N:** “**{n}** scheduled visit(s) would be cancelled from **{date}**.”  
**High impact confirm title:** “Update rota for **{service user name}**?”  
**Record-only warning:** “The rota will **not** change. Coordinators must update the scheduling board separately.”  
**Completed visits:** “Visits already completed will not be altered.”  
**After bulk action:** Toast + link “Open scheduling board” when `jobsUnallocated > 0`.

---

*Update when new preview APIs or amendment-impact service ships.*
