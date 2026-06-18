# Service User Personas — Test & Scheduling Data

**Purpose:** Realistic service user profiles for seeding development and QA data. These personas cover the mix of clients a UK domiciliary, live-in, and residential care provider typically encounters. They are designed so we can later seed full records — initial assessment (IA), assessments, care plans, medications, visit plans, and related profile data — and exercise the **scheduling** module end to end.

**Status:** Implemented — seed via `npm run seed:personas` (or main `npm run seed`; set `SEED_SERVICE_USER_PERSONAS=false` to skip).

### Existing seeds & scripts (reused)

| Asset | Purpose |
|-------|---------|
| `prisma/seeds/initial-assessment-demo-service-user.seed.ts` | Margaret Hughes (`SU-1042`) — IA enterprise demo |
| `prisma/seeds/demo-service-user-data.seed.ts` | Rich clinical data for one SU (meds, obs, allergies, IA, DOLS) |
| `prisma/scripts/seed-full-service-user-demo.ts` | Full MAR demo via API for a given service user ID |
| `prisma/scripts/fill-demo-initial-assessment.ts` | Autofill enterprise IA via admin E2E API |
| `prisma/scripts/clear-service-users-data.ts` | Hard-delete all service users + related data |
| **`prisma/seeds/service-user-personas.seed.ts`** | **13 scheduling personas (`SU-TEST-P01`…`P13`)** |
| **`prisma/scripts/seed-service-user-personas.ts`** | Standalone persona runner |

**Related:** [Service Care Management](../phases/SERVICE_CARE_MANAGEMENT.md) · [Scheduling Management](../phases/SCHEDULING_MANAGEMENT.md)

---

## How these personas support scheduling

Scheduling builds jobs from **active visit plans** linked to **domiciliary** (and live-in) service users with:

| Requirement | Why it matters |
|-------------|----------------|
| `ServiceUserAddress` with lat/lng | Route planning, map views, travel-time checks |
| `ServiceUserDomCare` profile | Access notes, contracted hours, preferred/blocked carers |
| `ServiceUserVisitPlan` (ACTIVE) + slots | Source of truth for visit frequency, times, carer count |
| Medication rounds on slots | Time-critical windows (e.g. lunchtime insulin) |
| Care plan instances linked to slots | Visit task checklists |
| Varied `requiredCarers` (1 vs 2) | Double-up allocation and capacity |
| Geographic spread | Cluster vs dispersed routing stress tests |
| Risk levels & flash messages | Allocator warnings and carer briefing |

Residential clients (on-site 24h care) generally **do not** have visit plans; they are included for completeness of the service-user module, not primary scheduling volume.

---

## Persona overview matrix

| Code | Name | Age | Care type | Setting | Funding | Risk | Visit pattern | Primary scheduling use |
|------|------|-----|-----------|---------|---------|------|---------------|------------------------|
| SU-P01 | Doris Clarke | 82 | Domiciliary | Own home | LA domiciliary | Low | 2 calls/day, 1 carer | Baseline single-carer roster |
| SU-P02 | James Okafor | 71 | Domiciliary | Own home | LA + NHS reablement | Medium | 2 double-up calls/day | Two-carer allocation |
| SU-P03 | Michael Patel | 68 | Domiciliary | Own home | Mixed LA/self | Medium | 4 calls/day, 1 med-critical | Multi-slot day, time windows |
| SU-P04 | Fatima Al-Rashid | 54 | Domiciliary | Ground-floor flat | Direct payment | High | 3 calls/day, 2-carer hoist | Equipment, access, double-up |
| SU-P05 | Sarah Williams | 29 | Supported living | Shared flat | LA supported living | Medium | 3 outreach/week | Non-daily frequency |
| SU-P06 | Eleanor Davies | 87 | Live-in | Own bungalow | NHS CHC fast track | Critical | Live-in + waking night | 24h coverage, night shifts |
| SU-P07 | David Thompson | 45 | Domiciliary | Bedsit | LA mental health | High | 2 calls/day, flexible | Engagement variability, risk |
| SU-P08 | Robert Chen | 78 | Domiciliary | Own home | NHS discharge to assess | Low→Medium | 6 calls/week → taper | Reablement intensity curve |
| SU-P09 | Patricia Morgan | 76 | Respite | Daughter's home | Family top-up | Low | 2 weeks, 3 calls/day | Short-term package |
| SU-P10 | Betty Henderson | 84 | Residential | Care home | LA nursing home | High | No visit plan (on-site) | Residential profile completeness |
| SU-P11 | George Morrison | 80 | Domiciliary | Same address as Enid | Self + AA | Medium | 1 call/day (shared) | Couple / same-address edge case |
| SU-P12 | Enid Morrison | 78 | Domiciliary | Same address as George | Self + AA | Low | 2 calls/day | Same address, different needs |
| SU-P13 | Aisha Mohammed | 67 | Domiciliary | Own home | LA pending | — | None yet | Pre-admission / IA in progress |

---

## Shared conventions (all seeded personas)

- **NHS numbers:** Valid-format test numbers (not real); prefix `999` for fictitious use.
- **Service user numbers:** `SU-TEST-P01` … `SU-TEST-P13` (stable keys for idempotent seed).
- **Persona tag:** `notes` field includes `[PERSONA:SU-P0X]` for filtering in dev.
- **Geography:** Greater London postcodes with coordinates (spread across N/S/E/W for routing).
- **Status codes:** `ACTIVE`, `PENDING`, `PRE_ADMISSION` from seeded lookups.
- **Gender / title / ethnicity / language:** From seeded lookup catalogues.
- **Key worker / named nurse:** Assigned from existing seeded employees where available.

---

## Persona details

### SU-P01 — Doris Clarke
*"Independent at heart, needs a little help"*

**Profile**
- Female, 82, widowed. Prefers "Doris".
- **Care type:** `DOMICILIARY` · **Status:** `ACTIVE` · **Risk:** `LOW`
- **Funding:** `LA_DOMICILIARY` — Brent Council personal budget, council-managed.
- **Address:** 14 Elm Grove, Wembley, HA0 2FG (lat 51.553, lng -0.296)

**Clinical & social**
- Osteoarthritis, mild COPD, no cognitive impairment.
- Mobile with stick indoors; short outdoor walks with supervision.
- Lives alone; daughter (next of kin) visits weekends.

**Care needs**
- Prompting for medication (Level 1A), meal prep, personal care (wash/dress), domestic support.
- No hoisting; manages own toileting with grab rails.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| MORNING | Mon–Sun | 08:00–09:30 | 1 | Personal care, breakfast, meds prompt |
| TEA | Mon–Sun | 17:00–18:00 | 1 | Evening meal, tidy, bedtime prep |

- **Weekly contracted hours:** 10.5
- **Preferred carer:** Female carers preferred (cultural preference — document in dom care notes).

**Initial assessment**
- Legacy IA complete. Enterprise IA submission: **SUBMITTED** (holistic, low complexity).
- Access: ground floor, key safe, no steps.

**Assessments**
- Falls risk — low
- Medication in home care — Level 1A
- Pressure ulcer — not applicable

**Care plans**
- Home Care Plan
- Eating and Drinking
- Washing and dressing
- Physical Health

**Medications**
- Paracetamol 500mg PRN
- Salbutamol inhaler PRN
- Amlodipine 5mg once daily (carer prompt)

**Contacts**
- Daughter — primary, emergency, updates OK
- GP — Dr Patel, Wembley Health Centre

**Scheduling notes:** Simplest domiciliary case. Good smoke test for 2-slot daily roster.

---

### SU-P02 — James Okafor
*"Recovering from stroke — needs two carers for transfers"*

**Profile**
- Male, 71, married. Wife is informal carer overnight.
- **Care type:** `DOMICILIARY` · **Status:** `ACTIVE` · **Risk:** `MEDIUM`
- **Funding:** `LA_DOMICILIARY` + `NHS_REABLEMENT` (first 6 weeks post-discharge).
- **Address:** 42 Maple Court, Stratford, E15 4BQ (lat 51.543, lng -0.002)

**Clinical & social**
- Left-sided weakness after ischaemic stroke (9 months ago). Expressive dysphasia — speak slowly, allow time.
- Diabetes Type 2, hypertension.
- Motivated for rehab; physiotherapy exercises daily.

**Care needs**
- Full personal care AM/PM; **2 carers for all transfers** (bed ↔ chair ↔ commode).
- Meal assistance; fluid balance chart.
- Medication Level 2B — full support, wife manages blister packs; carers witness administration.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| MORNING | Mon–Sun | 07:30–09:00 | **2** | Wash, dress, transfer, breakfast, meds |
| BED | Mon–Sun | 20:00–21:30 | **2** | Evening care, commode, bed transfer |

- **Weekly contracted hours:** 21
- **Time-critical:** Morning meds within 30 min of planned start.

**Initial assessment**
- Enterprise IA: **APPROVED**; `numberOfCarers: 2` for transfers documented.
- Access: 2nd floor flat — **lift available**; narrow hallway.

**Assessments**
- Moving and handling — hoist not required; manual transfer with 2 carers
- Cognition and Behaviour — no dementia; communication strategies documented
- Medication in home care — Level 2B
- Risk Assessment

**Care plans**
- Home Care Plan - needs/goals/support
- Eating and Drinking
- Physical Health
- Person Centred care plan

**Medications**
- Metformin 500mg BD
- Atorvastatin 20mg ON
- Clopidogrel 75mg OD
- Insulin glargine — evening (carer-administered)

**Contacts**
- Wife — primary, lives at same address
- Son — emergency contact
- Stroke OT — external professional

**Scheduling notes:** Core **double-up** test case. Same carer pair should ideally be kept together where possible.

---

### SU-P03 — Michael Patel
*"Parkinson's — four visits, lunchtime meds are critical"*

**Profile**
- Male, 68, married, adult children nearby.
- **Care type:** `DOMICILIARY` · **Status:** `ACTIVE` · **Risk:** `MEDIUM`
- **Funding:** `MIXED_LA_SELF` — LA core + family top-up for extra calls.
- **Address:** 8 Priory Gardens, Southall, UB1 2RD (lat 51.509, lng -0.371)

**Clinical & social**
- Parkinson's disease — tremor, slow mobility, occasional freezing episodes.
- Previous UTI-related delirium; monitor for sudden confusion.
- Enjoys cricket on radio; calm environment helps.

**Care needs**
- Personal care, medication management (Level 2A), meal prep, prompting fluids.
- Falls risk — unsteady turning; never rush.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Med round | Critical |
|------|------|------|--------|-----------|----------|
| MORNING | Mon–Sun | 08:00–09:00 | 1 | MORNING | No |
| MIDDAY | Mon–Sun | 12:00–13:00 | 1 | MIDDAY | **Yes** (±15 min) |
| AFTERNOON | Mon–Sun | 15:00–16:00 | 1 | — | No |
| BED | Mon–Sun | 21:00–22:00 | 1 | BEDTIME | No |

- **Weekly contracted hours:** 28

**Initial assessment**
- Enterprise IA: **APPROVED**; freezing episodes and floor markers documented.

**Assessments**
- Falls risk — high
- Medication in home care — Level 2A
- Cognition and Behaviour — mild executive dysfunction
- Risk Assessment and Care Plan

**Care plans**
- Dementia Care plan *(adapted for Parkinson's cognitive fluctuation)*
- Eating and Drinking
- Sleeping and Night
- Pain Management
- Physical Health

**Medications**
- Co-careldopa 25/100mg QDS (timed to slots)
- Rasagiline 1mg OD
- Omeprazole 20mg OD
- Macrogol PRN

**Flash message**
- "Freezing episodes — allow 30 seconds, do not pull. Call 111 if sudden confusion."

**Scheduling notes:** Tests **4-slot days**, **time-critical midday** window, medication round linkage.

---

### SU-P04 — Fatima Al-Rashid
*"Wheelchair user — hoist transfers, high falls risk"*

**Profile**
- Female, 54, divorced, lives with teenage son (present after school only).
- **Care type:** `DOMICILIARY` · **Status:** `ACTIVE` · **Risk:** `HIGH`
- **Funding:** `DP_SELF_MANAGED` — direct payment, self-managed account.
- **Address:** Flat 3, 22 Queens Road, Croydon, CR0 2BD (lat 51.372, lng -0.098)

**Clinical & social**
- MS-related wheelchair dependence; ceiling track hoist installed.
- Double incontinence — pad changes, skin care.
- Muslim; female carers only; halal diet; prayer times to be respected.

**Care needs**
- **2 carers** for all hoisting and personal care.
- Pressure area care; fluid chart.
- Medication Level 2A — full support.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| MORNING | Mon–Sun | 08:00–09:30 | **2** | Hoist, wash, breakfast, meds |
| MIDDAY | Mon–Sun | 13:00–14:00 | **2** | Lunch, pad change, reposition |
| BED | Mon–Sun | 20:30–22:00 | **2** | Evening care, hoist to bed |

- **Weekly contracted hours:** 31.5
- **Blocked carer:** None seeded initially (slot for testing block list UI).

**Initial assessment**
- Enterprise IA: **APPROVED**; hoist serial number, sling type, environmental hazards logged.

**Assessments**
- Moving and handling — ceiling hoist, 2 carers
- Pressure Ulcer — Waterlow high
- Skin Integrity
- Medication in home care — Level 2A
- Culture/Religion/Spirituality

**Care plans**
- Home Support Plan
- Pressure Ulcer
- Skin Integrity
- Washing and dressing
- Culture/Religion/Spirituality

**Medications**
- Baclofen 10mg TDS
- Oxybutynin 5mg BD
- Vitamin D 800 IU OD
- Laxido PRN

**Allergies**
- Penicillin — anaphylaxis

**Contacts**
- Son — emergency (under 18 — note in contact record)
- Sister — primary for care decisions, POA
- Social worker — LA

**Scheduling notes:** High-intensity double-up; **female-only** carer preference; Croydon location tests south routing cluster.

---

### SU-P05 — Sarah Williams
*"Learning disability — outreach, not daily care"*

**Profile**
- Female, 29, single, in shared supported-living flat (2 bed).
- **Care type:** `SUPPORTED_LIVING` · **Status:** `ACTIVE` · **Risk:** `MEDIUM`
- **Funding:** `LA_SUPPORTED_LIVING`
- **Address:** Flat 2, 5 Cedar Mews, Hackney, E8 3DL (lat 51.549, lng -0.055)

**Clinical & social**
- Mild learning disability; autism traits — prefers routine and visual timetables.
- Epilepsy — well controlled; rescue protocol on file.
- Can be anxious with unfamiliar carers.

**Care needs**
- Outreach: personal care support, meal planning, community access, medication prompting (Level 1A with pictorial chart).
- **Not** daily domiciliary — 3 visits per week.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Frequency |
|------|------|------|--------|-----------|
| MORNING | Mon, Wed, Fri | 09:00–11:00 | 1 | WEEKLY pattern |
| OUTREACH | Sat | 10:00–14:00 | 1 | Community / shopping |

- **Weekly contracted hours:** 10

**Initial assessment**
- Enterprise IA: **APPROVED**; communication passport attached.

**Assessments**
- Cognition and Behaviour
- Epilepsy / seizure management (custom assessment if available; else Risk Assessment)
- Medication in home care — Level 1A
- Social Activities

**Care plans**
- Person Centred care plan
- Social Activities
- Eating and Drinking
- Personal Safety

**Medications**
- Levetiracetam 500mg BD
- Melatonin 2mg nocte PRN

**Scheduling notes:** Tests **non-daily** visit patterns and **WEEKLY** slot configuration. Carer consistency important.

---

### SU-P06 — Eleanor Davies
*"End of life — live-in care and waking nights"*

**Profile**
- Female, 87, widowed, lives alone in bungalow.
- **Care type:** `DOMICILIARY` (live-in package) · **Status:** `ACTIVE` · **Risk:** `CRITICAL`
- **Funding:** `NHS_CHC_FAST_TRACK`
- **Address:** 1 Meadow Lane, Enfield, EN2 8AB (lat 51.653, lng -0.084)

**Clinical & social**
- Advanced COPD + heart failure; breathless at rest.
- DNACPR in place; advance care plan completed.
- Wishes to remain at home; family visit daily.

**Care needs**
- 24-hour live-in carer Mon–Fri; waking night cover Sat–Sun.
- Personal care, symptom management, comfort meds, oxygen monitoring.
- Medication Level 2A — full support.

**Live-in profile**
- **Service type:** `LIVE_IN_CARE`
- **Level of care:** B
- **Status:** ACTIVE
- **Scan type:** QR check-in

**Visit plan (ACTIVE)** — for scheduling non-live-in supplements
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| WAKING_NIGHT | Sat, Sun | 22:00–07:00 | 1 | Night observation |
| DOMESTIC | Wed | 10:00–12:00 | 1 | Deep clean (agency domestic) |

**Initial assessment**
- Enterprise IA: **APPROVED**; DNACPR, anticipatory meds list.

**Assessments**
- Advance
- Final Days
- Pain Management
- Medication in home care — Level 2A

**Care plans**
- Advance
- Final Days
- Pain Management
- Physical Health
- Sleeping and Night

**Medications**
- Morphine sulfate 10mg/5ml — PRN breathlessness
- Midazolam 10mg/2ml — PRN agitation (anticipatory)
- Furosemide 40mg OD
- Glycopyrronium bromide PRN secretions

**Legal**
- DNACPR: yes · DoLS: not applicable (end-of-life pathway)

**Flash message**
- "DNACPR in place — comfort care only. Contact on-call nurse for symptom escalation."

**Scheduling notes:** Live-in + **waking night** shifts; tests overnight job types and critical risk flagging.

---

### SU-P07 — David Thompson
*"Mental health — engagement varies, safeguarding awareness"*

**Profile**
- Male, 45, single, council bedsit.
- **Care type:** `DOMICILIARY` · **Status:** `ACTIVE` · **Risk:** `HIGH`
- **Funding:** `LA_DOMICILIARY` — mental health social care team
- **Address:** 17B High Street, Tottenham, N17 6QA (lat 51.588, lng -0.071)

**Clinical & social**
- Schizoaffective disorder; compliant with depot but intermittent oral meds.
- History of self-neglect; hoarding tendencies — access can be difficult.
- Can refuse entry — document and report to coordinator.

**Care needs**
- Support with personal hygiene, nutrition, benefits paperwork, prompting oral medication.
- Motivational approach; same small team preferred.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| MORNING | Mon, Wed, Fri, Sun | 10:00–11:30 | 1 | Flexible start ±60 min |
| TEA | Mon–Sun | 17:00–18:00 | 1 | Meal check; may refuse |

- **Weekly contracted hours:** 12
- **Preferred carers:** 2 named (seed from employees)
- **Time tolerance:** 60 minutes on morning slot

**Initial assessment**
- Enterprise IA: **APPROVED**; access risks (clutter, unknown visitors).

**Assessments**
- Mental health risk assessment
- Risk Assessment
- Personal Safety
- Medication in home care — Level 1A with compliance monitoring

**Care plans**
- Personal Safety
- Eating and Drinking
- Home Care Plan
- Cognition and Behaviour

**Medications**
- Aripiprazole depot — monthly (clinic); oral supplement PRN per MHT
- Lorazepam 0.5mg PRN (max 1/day — controlled record)

**Scheduling notes:** Tests **flexible time tolerance**, **refusal / call-off** scenarios, high-risk flag on allocator.

---

### SU-P08 — Robert Chen
*"Hospital discharge — reablement tapering over 6 weeks"*

**Profile**
- Male, 78, lives with wife.
- **Care type:** `DOMICILIARY` · **Status:** `ACTIVE` · **Risk:** `LOW` (trending down)
- **Funding:** `NHS_DISCHARGE_TO_ASSESS` → transition to `LA_DOMICILIARY`
- **Address:** 55 Oak Avenue, Barnet, EN4 8PL (lat 51.644, lng -0.165)

**Clinical & social**
- Post-hip fracture (#NOF) — ORIF 3 weeks ago.
- Previously independent; goal is return to independence.
- Wife assisting between visits.

**Care needs**
- Week 1–2: intensive personal care, meal prep, med prompt, physio exercises.
- Week 3–4: reduce to AM + PM.
- Week 5–6: PM only → review for discharge from service.

**Visit plan (ACTIVE)** — initial intensive phase
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| MORNING | Mon–Sun | 08:00–09:30 | 1 | Personal care, breakfast |
| MIDDAY | Mon–Sun | 12:00–13:00 | 1 | Lunch, exercises |
| TEA | Mon–Sun | 17:00–18:00 | 1 | Evening meal prep |

- **Weekly contracted hours:** 31.5 (phase 1 — seed amendment record for taper in week 3)

**Initial assessment**
- Enterprise IA: **APPROVED**; reablement goals documented with review dates.

**Assessments**
- Falls risk — high initially
- Moving and handling — frame, not hoist
- Care Plan review form — scheduled at week 3

**Care plans**
- Home Care Plan - needs/goals/support
- Physical Health
- Risk Assessment

**Medications**
- Paracetamol 1g QDS (short term)
- Apixaban 2.5mg BD
- Calcium + Vit D OD

**Scheduling notes:** Tests **package intensity**, **visit plan amendments**, and transition funding type. Good for timeline "before/after taper" screenshots.

---

### SU-P09 — Patricia Morgan
*"Respite — two-week family break"*

**Profile**
- Female, 76, usually lives with daughter; currently in daughter's annex.
- **Care type:** `RESPITE` · **Status:** `ACTIVE` · **Risk:** `LOW`
- **Funding:** `FAMILY_TOP_UP` + `LA_RESPITE` (block booked)
- **Address:** 9 Lilac Close, Richmond, TW10 6DH (lat 51.461, lng -0.303)
- **Service end date:** +14 days from seed date

**Clinical & social**
- Early Alzheimer's — pleasant, wanders if unsupervised.
- Daughter normally sole carer; respite prevents carer breakdown.

**Care needs**
- Supervision, personal care, meal prep, prompting fluids, activity engagement.
- Door sensors recommended — may attempt to leave.

**Visit plan (ACTIVE)**
| Slot | Days | Time | Carers | Notes |
|------|------|------|--------|-------|
| MORNING | Mon–Sun | 08:30–10:00 | 1 | |
| MIDDAY | Mon–Sun | 12:30–13:30 | 1 | Lunch supervision |
| TEA | Mon–Sun | 17:30–19:00 | 1 | |

- **Weekly contracted hours:** 21 (fixed 2-week package)

**Initial assessment**
- Abbreviated IA complete (respite pathway).

**Assessments**
- Cognition and Behaviour
- Dementia Care plan assessment
- Falls risk

**Care plans**
- Dementia Care plan
- Eating and Drinking
- Social Activities
- Personal Safety

**Medications**
- Donepezil 10mg ON
- Memantine 20mg OD

**Scheduling notes:** Fixed **end date** on service user; tests expiry / package completion and west London routing.

---

### SU-P10 — Betty Henderson
*"Residential dementia — on-site 24h care, not visit-scheduled"*

**Profile**
- Female, 84, widowed. Known as "Betty".
- **Care type:** `RESIDENTIAL` · **Status:** `ACTIVE` · **Risk:** `HIGH`
- **Funding:** `LA_NURSING_HOME` (EMI unit)
- **Location:** Linked to seeded care home **Location** record (not a visit address).

**Clinical & social**
- Vascular dementia (2019); requires 24h support.
- Type 2 diabetes, hypertension, osteoarthritis, stable heart failure.
- DoLS authorisation in place.

**Care needs**
- Full personal care, continence, meals, medication, behaviour support.
- **2 carers** for transfers; unsettled at night.

**Visit plan**
- **None** — care delivered on-site. Included to validate residential workflow does not pollute domiciliary schedule build.

**Initial assessment**
- Legacy IA complete (matches existing `demo-service-user-data.seed.ts` Betty profile).

**Assessments & care plans**
- Full dementia pathway: Cognition and Behaviour, Dementia Care plan, Eating and Drinking, Sleeping and Night, Risk Assessment

**Medications**
- Atorvastatin, Amlodipine, Metformin, Paracetamol, Aspirin (as per demo seed)

**Legal / safety**
- DNACPR: yes · DoLS: current · Flash message: DNACPR reminder

**Scheduling notes:** Residential completeness only. Verify schedule build **excludes** or handles separately.

---

### SU-P11 & SU-P12 — George & Enid Morrison
*"Married couple — same address, different packages"*

**Shared address:** 2 Rose Cottage, Chingford, E4 7EN (lat 51.632, lng 0.001)

#### SU-P11 — George Morrison (80)
- **Care type:** `DOMICILIARY` · **Risk:** `MEDIUM`
- **Funding:** `SELF_WITH_AA`
- Post-CABG (6 months ago); breathless on exertion.
- **Visit plan:** 1 call/day MORNING 09:00–10:00 (1 carer) — shower assist, breakfast, meds prompt.

#### SU-P12 — Enid Morrison (78)
- **Care type:** `DOMICILIARY` · **Risk:** `LOW`
- **Funding:** `SELF_WITH_AA`
- Frail but cognitively intact; macular degeneration — poor vision.
- **Visit plan:** MORNING 08:00–09:00 + TEA 17:00–18:00 (1 carer each).

**Shared scheduling concern**
- Two clients, **one address**, **overlapping morning windows**. Tests travel-time = 0 between consecutive jobs, carer double-booking at same property, and map pin stacking.

**Contacts**
- Each other — primary
- Daughter — emergency, POA for both

---

### SU-P13 — Aisha Mohammed
*"Pre-admission — IA in progress, no visit plan yet"*

**Profile**
- Female, 67, awaiting LA assessment outcome.
- **Care type:** `DOMICILIARY` · **Status:** `PRE_ADMISSION`
- **Funding:** `LA_PENDING`
- **Address:** 31 Station Road, Ilford, IG1 4DR (lat 51.559, lng 0.071)

**Clinical & social**
- Recently discharged from hospital (UTI, dehydration); lives alone.
- Daughter requesting domiciliary package; IA booked.

**Data state for seed**
- Service user record created
- Enterprise IA submission: **DRAFT** (partial — sections 1–4 only)
- **No visit plan**, **no care plans**, **no medications** yet
- Contact: daughter — primary

**Scheduling notes:** Negative test — must **not** appear in schedule build until visit plan activated. Validates gating logic.

---

## Data seed checklist (Phase 2)

For each persona (except SU-P13 partial), seed in order:

1. **Core:** `ServiceUser` + `ServiceUserAddress` (+ coordinates)
2. **Profile slices:** contacts, references, assignments (key worker)
3. **Funding:** `ServiceUserFunding` line + `currentFunding`
4. **Care setting:** `ServiceUserDomCare` and/or `ServiceUserLiveInProfile` (SU-P06)
5. **Initial assessment:** legacy `ServiceUserInitialAssessment` and/or enterprise `InitialAssessmentSubmission`
6. **Assessments:** `ServiceUserAssessment` + completions (medication, falls, etc.)
7. **Care plans:** `ServiceUserCarePlanInstance` for listed forms
8. **Medications:** `ServiceUserMedication` + support profile + schedules where applicable
9. **Clinical extras:** allergies, observations (sample), flash messages, legal/DOLS as relevant
10. **Visit plan:** `ServiceUserVisitPlan` (ACTIVE) + `VisitPlanSlot` rows
11. **Inventory / body map:** optional, 1–2 personas only

**Idempotency:** Use stable `serviceUserNumber` (`SU-TEST-P0X`) and `[PERSONA:SU-P0X]` tag; upsert by number.

**Employee linkage:** Preferred/blocked carers reference existing seeded employees (assign after employee seed runs).

---

## Scheduling test scenarios (mapped to personas)

| Scenario | Personas |
|----------|----------|
| Build daily roster — single carer calls | P01, P03, P05 |
| Double-up allocation — 2 carers required | P02, P04 |
| Time-critical medication window | P03 (MIDDAY) |
| Non-daily / weekly visit pattern | P05 |
| Overnight / waking night shift | P06 |
| Flexible tolerance / refused access | P07 |
| Visit plan amendment / taper | P08 |
| Fixed end-date respite package | P09 |
| Same-address two clients | P11, P12 |
| Pre-admission excluded from build | P13 |
| Residential excluded from dom build | P10 |
| Geographic cluster (east London) | P02, P05, P07 |
| Geographic spread (north/south/west) | P01, P04, P09, P06 |
| High-risk / flash message warnings | P04, P06, P07, P10 |
| Female-only carer preference | P04 |
| DNACPR / end-of-life | P06, P10 |

---

## Running the seed

```bash
cd careadmin-backend

# All personas (idempotent)
npm run seed:personas

# Subset only
npx ts-node --transpile-only prisma/scripts/seed-service-user-personas.ts --only=SU-P01,SU-P02

# Generate scheduled jobs from visit plans (default: today + 6 days)
npm run seed:persona-schedule

# Carer route runs only (after jobs exist)
npm run seed:persona-runs

# Custom date range + probe
SCHEDULE_FROM_DATE=2026-06-23 SCHEDULE_TO_DATE=2026-06-29 npm run seed:persona-schedule
npx ts-node --transpile-only prisma/scripts/probe-persona-schedule-summary.ts

# Included in main seed unless disabled
SEED_SERVICE_USER_PERSONAS=false npm run seed
SEED_PERSONA_SCHEDULE=false npm run seed
```

## Next steps

1. Run schedule build against seeded visit plans and validate timeline/allocation UI.
2. Optionally run `npm run seed:full-su -- <serviceUserId>` for full MAR on Betty (`SU-TEST-P10`).
3. Review personas with product/clinical stakeholders and adjust `service-user-personas.data.ts`.

---

*Document version: 1.1 · CareFlow scheduling QA · June 2026*
