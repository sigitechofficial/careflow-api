# 27 — Gate C7: Company Directors' National Insurance (Standard Annual Method AN)

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c7` (backend only, on `gate-c6`) · Synthetic data only. No push, deployment, HMRC submission or payment. Focused tests only: this is not a claim of production compliance.

## Implementation result

**Director data on the payroll profile.** Recorded through the existing audited profile API (`PUT` payroll profile, same permissions; the profile and its audit entry are saved in one transaction):

| Field | Values |
|---|---|
| `isDirector` | Confirmed by a person; `null` means not yet classified |
| `directorAppointedOn` | Date of appointment |
| `directorNicMethod` | Only `AN` is accepted |

Directorship is never inferred from a job title.

> **Effect:** existing staff stay unclassified (`null`), and **tax and NI are not calculated for them until someone records director status.** The harness records synthetic `false`.

**Director NI in the existing engine.** HMRC CA44 (2026 to 2027):

- **Earnings period:** annual for a director in post on 6 April. A director appointed during the year gets a pro rata annual period of the appointment week plus the remaining weeks, on 52 weeks (week 53 = 1 week).
- **Thresholds:**
  - Annual, from GOV.UK 2026–27: LEL £6,708, PT £12,570, ST £5,000, UEL £50,270. Monthly × 12 is not used.
  - Pro rata: LEL = weekly LEL × weeks. Every other threshold = annual ÷ 52 × weeks, rounded up to the pound (CA44 para 25).
  - Figures exist for 2026–27 only. Any other year is refused.
- **Cumulative calculation:** NI on the earnings paid in the director's period to date, less the employee and employer NI those payments already paid. The usual rounding applies (£0.005 or less disregarded).
  - Employer NI is recorded separately and is not deducted from pay.
  - A supplementary run is included automatically; the same-period sum from C6 is not also applied.
- **Earnings before appointment** (as an employee) stay on the ordinary period rules, and their NI is kept apart (CA44 para 33). They are attributed by payment date.
- **The run row records `directorNicMethodApplied = AN`** for the FPS.
- **Recalculation and closed runs:** recalculation overwrites only the run's own figures, and closed runs are refused as before.
- **Refused with the reason:**
  - director status, appointment date or method AN not recorded;
  - categories other than A or C;
  - a category change within the director's period;
  - another run in the tax year that is not closed;
  - YTD pay that does not match this system's closed runs (cannot be attributed);
  - no figures for the tax year.

## Files changed

- `prisma/schema.prisma` and the new migration
- `src/payroll/payroll-statutory.util.ts` and its spec
- `src/payroll/payroll-runs.service.ts`
- `src/payroll/payroll-employees.service.ts`
- `src/payroll/payroll-mapper.util.ts`
- `src/payroll/dto/payroll.dto.ts`
- `test/payroll-int/harness.ts`
- `test/payroll-int/paye-cumulative.int-spec.ts`

## Migration

`20261022100000_director_nic`: additive, four nullable columns, no row changed. Rollback is to drop them.
- Applied once on the disposable rehearsal database: 61 of 61 checks passed, including the schema match.
- The test database is built from the schema.
- **Not applied to the dev database.** Run `prisma migrate deploy` there when ready.
- `prisma generate` updated the client, but the engine file was locked by a running process. The engine itself is unchanged.

## Commit

Backend `dac006e` (this report in the next commit).

## Tests

| Check | Result |
|---|---|
| Unit: 3 new C7 checks plus the existing checks | 35 passed, 0 failed |
| Integration `paye-cumulative`: new C7 scenario; missing-director-data refusals added to the existing refusal test | 9 passed, 0 failed |
| Backend type-check | Clean |

**The three unit checks:**
1. **Annual period:** £3,000 → no NI (ordinary NI would be £156.16 / £387.45). £60,000 → £3,210.60 / £8,250.00.
2. **Pro rata thresholds match CA44's printed table:**

   | Appointed in | Weeks | LEL | PT | ST | UEL |
   |---|---|---|---|---|---|
   | Week 2 | 51 | £6,579 | £12,329 | £4,904 | £49,304 |
   | Week 10 | 43 | £5,547 | £10,395 | £4,135 | £41,570 |
   | Week 27 | 26 | £3,354 | £6,285 | £2,500 | £25,135 |
   | Week 52 or 53 | 1 | £129 | £242 | £97 | £967 |

3. **Two payments:** £0 / £750.00, then £594.40 / £1,500.00. Nothing is doubled.

**The integration scenario** (appointed 10 May, week 5, 48 weeks):

| Month | Employee NI | Employer NI | Net pay |
|---|---|---|---|
| April (still an employee) | £156.16 | £387.45 | £2,453.64 |
| May | £0 | £0 | £2,609.60 |
| June | £0 | £207.60 | £2,609.60 |

April's NI is not offset. Closed runs are refused and stay unchanged.

## Remaining director NI limitations

- The alternative method (AL) and its year-end reassessment are not implemented. Paying NI on account is not supported either.
- Directors in categories other than A and C (H, M, V and the rest), and category changes during the year, are refused.
- **Not handled:**
  - resignation and reappointment in the year;
  - earnings paid after the appointment ends;
  - several jobs or associated companies;
  - fees, bonuses and director's loan accounts as separate items.
- Opening YTD balances that did not come from runs here block directors.
- There is no screen for the director fields (backend API only).

## Next C8 recommendation

**C8: RTI-ready NI records.**
- Store the NI bands (LEL, LEL–PT, PT–UEL), NI to date per category and the director flags on the run row and the YTD ledger.
- Add a director-field screen on the payroll profile, so staff can be classified before the migration reaches real data.
