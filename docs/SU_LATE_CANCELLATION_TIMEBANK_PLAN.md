# Late cancellation (24 hours) → Timebank — plan

Date: 4 Nov 2026. Status: **built 4 Nov (uncommitted)**. Column name chosen: **Chargeable cancellation** (rose colour).

## Kya decide hua (user, 4 Nov)

1. 24 hours ka rule **Settings → Dom Care Settings → Job Cancellation** wali setting se hi aayega. Koi nayi setting nahi banegi.
2. Jis cancelled visit par **Charge** decision laga ho, us visit ke hours timebank mein **nahi** jayenge.
3. Charge laga ho to **poore visit** ke hours bank se bahar rahenge. Aadha ya kuch hissa bank mein nahi jayega.
4. Paisa (charged cancellation ko invoice mein bill karna) **alag kaam** hai. Is plan mein shamil nahi.
5. Funded care (LA / NHS / Direct Payment) jahan faisla "finance to confirm" (PENDING_REVIEW) hota hai: **baad mein discuss** hoga. Tab tak in ka hisaab abhi jaisa hi rahega: hours bank mein jaate rahenge.

## Abhi code kya karta hai (verified)

- **Job Cancellation setting:** `organisation-general-settings/dom-care-settings.util.ts:20`. Default rules:
  - visit se 0–24 hours pehle cancel → Charge Service User 100%, Pay Employee 100%
  - 24 hours ya zyada → 0%
  - "No charge for hospital admission" = Yes

  Local DB mein bhi yahi default values hain.
- **Rule kahan lagta hai:** `evaluateVisitCancellationPolicy` (`scheduled-jobs-housekeeping/visit-cancellation-policy.util.ts`). Is ke faisle:
  - agency ne cancel kiya → No charge
  - Other → finance to confirm
  - hospital admission → No charge
  - koi rule match na ho → finance to confirm
  - funded care → finance to confirm
  - in ke ilawa → Charge

  Yeh rule **sirf ek jagah** chalta hai: Visit plan → Changes for specific dates → Cancel visits (`visit-plan-date-changes.service.ts:653`). Wahan notice hours aur suggestion save hote hain (`noticeHours`, `suggestedChargeDecision`, `policySnapshot`).
- **Rota se cancel** (`ScheduleJobCancelDialog`) notice hours nahi dekhta. Wahan suggestion sirf reason se aati hai, maslan "Client / family request" → finance to confirm. Notice hours, "cancelled by" aur policy snapshot save nahi hote.
- **Cancel ke baad charge decision badalne ka koi raasta nahi.** `chargeDecision` sirf cancel karte waqt likha jata hai (`scheduled-jobs-housekeeping.service.ts:1624`). Visit reinstate karke dobara cancel karna padta hai.
- **Invoice:** invoice run sirf approved Visit reconciliation se banta hai (`billing/invoice-runs.service.ts`). Cancelled visit ka koi bill nahi banta. Yeh paison wala alag kaam hai.
- **Timebank:** har cancelled visit ko short ginta hai, "Cancelled by …" ke saath, aur khatam hafte mein woh hours bank mein chale jaate hain. `chargeDecision` ko nahi dekhta (`service-user-timebank.util.ts`, CANCELLED branch). "Called off" visit ko bhi short ginta hai.
- **Timebank use (ledger):** agar koi extra visit bank se hours le chuka ho aur cancel ho jaye, to hours wapis bank mein aa jaate hain (`service-user-timebank-ledger.service.ts:219`, `VISIT_CANCELLED`). Yeh `chargeDecision` nahi dekhta.

## UK research (kya common hai)

UK mein late cancellation ka koi kanoon nahi mila. Contract hi decide karta hai.

- Common practice: 24 hours se kam notice par 100% charge, aur hospital admission par chhoot. Ombudsman ke [Lilies Home Care](https://www.lgo.org.uk/decisions/adult-care-services/charging/21-010-606) case mein yahi contract tha.
- Ombudsman ne aise cases mein refund karwaya hai jahan charge contract mein saaf nahi tha ya family ko pehle nahi bataya gaya tha:
  - [Gateshead Council](https://www.lgo.org.uk/decisions/adult-care-services/charging/24-002-763)
  - [Golden Services Care](https://www.lgo.org.uk/decisions/adult-care-services/domiciliary-care/20-004-339)
- Kuch councils ka apna notice period hota hai, maslan [Derby 48 hours](https://derby.gov.uk/media/derbycitycouncil/contentassets/documents/healthandsocialcare/adultsocialcare/ylyc/notice-periods-for-community-care-charges.pdf) aur [North Somerset 24 hours](https://n-somerset.gov.uk/sites/default/files/2024-06/Non-residential%20services%20charging%20policy%202019-20.pdf). Is liye funded care par finance ka confirm karna sahi hai, jo code pehle se karta hai.

## Screens — before / after

### 1. Settings → Dom Care Settings → Job Cancellation
- **Before:** hour bands, "Charge Service User %" aur "Pay Employee %". Yeh sirf visit plan wale cancel par lagta hai.
- **After:** screen wahi rahegi. Ek line add hogi: *"Visits cancelled with a Charge decision are not added to the service user's timebank. Used when cancelling from the rota and from the visit plan."*

### 2. Rota se cancel (Care Operations → Schedule Jobs / Manage Schedule Jobs → Cancel)
- **Before:** reason chunne par suggestion sirf reason se aati hai. Maslan "Client / family request" → *Finance to confirm*, chahe visit 2 ghante baad ho ya 5 din baad.
- **After:**
  - Dialog khulte hi server notice hours nikalega (visit start − abhi) aur wahi rule chalayega jo visit plan mein chalta hai.
  - Dialog mein dikhega: *"Cancelled 6 hours before the visit (under 24 hours) — charge 100% of the visit fee."*
  - Client wale reason par **Charge** pehle se selected hoga.
  - Office isay badal sakta hai. Charge chunne par billing note pehle ki tarah zaroori rahega.
  - Save par notice hours, suggestion aur rule ki copy bhi save hogi, bilkul visit plan ki tarah. Is se baad mein setting badalne par purana record nahi badlega.
- "Cancelled by" rota dialog mein nahi hai. Reason se nikalega: `CLIENT_…` aur "Service not required" → service user, `PROVIDER_…` → agency. Yahi rule timebank pehle se use karta hai (`timebankCancelParty`).
- **Needs:** ek naya read-only endpoint, policy preview for one rota job. Server cancel save karte waqt notice hours khud dobara nikalega, browser ki value par bharosa nahi karega.

### 3. Visit plan → Changes for specific dates → Cancel visits
- **Before:** notice hours aur Charge / No charge suggestion pehle se dikhte hain.
- **After:** sirf ek line add hogi: *"Visits with a Charge decision are not added to the timebank."* Logic wahi rahegi.

### 4. Reports → Timebank (list)
- **Before:** Ruth ne 6 hours pehle 3h ka visit cancel kiya → Short **3h**, "Cancelled 3h". Hafta khatam hone par 3h bank mein.
- **After:**
  - Charged visit short nahi ginega. Ek naya hissa aayega: **"Cancelled, charged"**.
  - Contracted ka hisaab: `Contracted = Delivered + Not approved + Awaiting + Scheduled + Cancelled, charged + Short`
  - Bar mein naya rang, green aur amber ke ilawa koi rang.
  - Agar is wajah se hafta poora cover ho jaye to Ruth Short list mein nahi aayegi.
  - Export CSV mein bhi yeh column aayega.
- Charge na lage (No charge / Waive / finance to confirm) to sab kuch abhi jaisa: Short, aur hours bank mein.

### 5. Timebank → service user page
- **Week by week:** naya column "Cancelled, charged". Week row kholne par "What happened" mein likha aayega: *"Cancelled by service user — charged (6h notice)"*, Short 0, aur yeh line: "Charged — not added to the timebank".
- **Visits not fully delivered:** charged visit list mein rahega, kyunke care nahi mili. Lekin Short 0 hoga aur reason mein "charged" likha hoga.
- **In timebank:** charged visit ke hours ab bank mein nahi aayenge.

### 6. Koi aur screen nahi badlegi
Yeh screens nahi badlengi:
- invoice run, payroll aur carer pay ka hisaab
- Visit reconciliation
- carer app
- Carers wala timebank tab

## Backend changes (short)

| File | Change |
|---|---|
| `service-user-timebank.service.ts` | cancellation ke saath `chargeDecision` aur `noticeHours` bhi load karna |
| `service-user-timebank.util.ts` | CANCELLED aur CALLED_OFF + `CHARGE` → short nahi, naya `chargedCancelMinutes`; covered mein add |
| `scheduled-jobs-housekeeping` (service, controller, dto) | rota job ke liye policy preview endpoint; cancel par notice hours server khud nikale aur snapshot save kare |
| Admin: `ScheduleJobCancelDialog`, Timebank pages, `TimebankFill`, Settings panel | upar wale screen changes |

Koi DB schema change ya migration nahi. Saari fields pehle se `ScheduledJobCancellation` mein hain.

## Faisle (user, 4 Nov — second round)

1. **Purane cancellations nahi badlenge.** Rule sirf naye cancellations par lagega. Tareeqa: naya code har cancel par `policySnapshot` mein ek marker save karega. Timebank sirf us cancellation ko bank se bahar rakhega jis par `CHARGE` ho **aur** yeh marker ho. Purane records mein marker nahi hai, is liye woh pehle jaise rahenge. Date wala constant ya schema change nahi chahiye.
2. **Bank se liya hua extra visit:** agar woh late cancel ho aur Charge lage, to liye hue hours **wapis bank mein nahi** aayenge. Ledger mein `VISIT_CANCELLED` wala give-back is case mein nahi hoga.
3. **Naam:** "Cancelled, charged" pasand nahi aaya. Naya naam user chunega.
4. Funded care ka "finance to confirm" (decision 5) baad mein.

## Known edges (not in this change)

- Visit plan se aisi date cancel ho jo abhi rota par aayi hi nahi, to sirf plan par exception banta hai, koi rota job nahi. Timebank us date ko "No visit on rota" short ginta hai, chahe us par Charge laga ho. 24 hours ke andar wale visits aam taur par rota par hote hain, is liye yeh kam hoga. Verify nahi kiya.
- Cancel ke baad charge decision badalne ka raasta nahi. Chahiye ho to alag kaam hai.

## Build + test (4 Nov)

- API: `visit-cancellation-policy.util.ts` (marker, party-from-reason, shared funding lookup), housekeeping `GET jobs/:id/cancellation-policy` + rota cancel saves notice/suggestion/snapshot, timebank util/service (`chargeableCancelMinutes`, outcome `CHARGEABLE_CANCELLATION`), ledger keeps hours held by a chargeable cancellation.
- Admin: rota cancel dialog suggestion, Timebank list + service user page column/bar/legend/CSV, hint lines in Settings → Job Cancellation and visit plan Cancel visits.
- Unit tests: 30 in timebank + policy specs (218 in the related suites) pass.
- Browser, local, Edie Marsh (self-funded):
  - rota cancel 22.1h before → Charge 100% suggested, note filled, saved with marker → Timebank "Chargeable cancellation 45m (1 visit)", not in Hours left;
  - 34.6h before → No charge → "Cancelled 30m" in Hours left (as before).
  - Preview: LA-funded Arthur → finance to confirm; hospital → no charge; agency reason → rules not applied.
- Not tested in browser: visit plan Cancel visits path (same server code), ledger no-give-back (unit test only), dark mode.

## End-to-end test (4 Nov, local, Edie Marsh, self-funded)

| # | Flow | Result |
|---|---|---|
| 1 | Rota cancel, 22.1h notice, Client request | Charge 100% suggested + note filled; saved CHARGE + marker; Timebank "Chargeable cancellation" — PASS |
| 2 | Rota cancel, 34.6h notice | No charge suggested; short "Cancelled 30m", goes to bank — PASS |
| 3 | Visit plan → Cancel visits, 6.5h notice | Billing column "Charge 100%", hint line shown; saved CHARGE + marker, source VISIT_PLAN — PASS |
| 4 | Rota **Called off**, 0h notice, Charge | Job CALLED_OFF; counted as chargeable, not Missed — PASS |
| 5 | Reinstate the called-off visit | Back to Missed; chargeable total drops (2h → 1h 15m) — PASS |
| 6 | Use timebank = Yes; extra 2h 30m visit over weekly hours | 30m taken from bank (6h 51m → 6h 21m available) — PASS |
| 7 | That extra visit cancelled with Charge (office override at 27.9h) | No "given back" entry after settle; bank stays 6h 21m; week chargeable 3h 45m — PASS |
| 8 | Settings → Job Cancellation hint, ledger wording | Hint shown; ledger text fixed to "(unless charged)"; Dom Rules hint updated — PASS |
| 9 | Dark mode | rose-400 on dark, rose-700 on light — PASS |
| — | Preview only: LA funded → finance to confirm; hospital → no charge; agency reason → rules not applied | PASS |

Sums checked each time: Delivered + Not approved + Awaiting + Scheduled + Chargeable + Short = Contracted (16h).
Settings restored (Use timebank = No). Test data left on Edie: cancelled visits 962649a9 (CHARGE), 54f8084f (NO_CHARGE), 19c261db (CHARGE, visit plan), extra visit e2a3a1b3 (CHARGE, holds 30m from bank); 369ed7d2 reinstated.
Steps 5 and 6 used the same API calls the UI dialogs make (reinstate, add extra visit), because the rota board's controls were slow to drive in the browser.
