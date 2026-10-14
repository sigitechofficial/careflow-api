# 28 — Gate C8: Director Classification on the Payroll Employee Profile

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c8` in both repositories. The frontend branch is based on `sprint-b4f`, the last frontend sprint; the backend branch is based on `gate-c7` and holds this report only. Synthetic data only. No push, deployment or migration. There are no backend source or calculation changes.

## UI implemented

**Payroll → Employees, profile dialog: new section "Director / National Insurance status".**

- **Three states:** Not yet classified / Not a director / Director.
- **The saved classification is shown** ("Saved: …"). An unclassified person carries the warning that tax and NI are not calculated until someone chooses.
- **Nothing is classified automatically.** A `null` status stays `null`, and the Save button stays disabled until a choice is made. "Not yet classified" cannot be chosen again once a person is classified.
- **Not a director** saves `isDirector: false`. No date is needed.
- **Director** saves `isDirector: true`, the appointment date and method `AN`.
  - The date is required: Save stays disabled, with a message, until it is entered.
  - The section explains that the alternative method (AL) is not supported yet.
- **The existing profile save (`useUpsertEmployeePayrollProfile`) is reused.** It sends only the director fields, so the tax code, NI category, bank details and other fields are not in the request body and stay as they are. The existing "Save profile" button does not send the director fields either, so it cannot erase them.
- **Permissions.** Only `payroll.employees.manage` can edit; the existing dialog is shown to those users only. Readers of the employee list see a new read-only **Director** column showing the saved status.
- **Errors and refresh.** Backend validation errors appear as the existing toast and inline in the section. After saving, the existing invalidation reloads the profile and the section shows the saved status.

## Files changed (frontend `care-admin`)

- New `src/features/payroll/components/DirectorStatusSection.tsx` and its test
- `src/features/payroll/pages/PayrollEmployeesPage.tsx`: the section and the Director column
- `src/features/payroll/types/payroll.types.ts` and `payroll-api.types.ts`: the three C7 fields

## Commit

Frontend `95cceb1`.

## Tests

| Check | Result |
|---|---|
| `DirectorStatusSection.test.tsx`: 3 tests | 3 passed, 0 failed |
| Frontend type-check (`tsconfig.json`, unfiltered) | 0 errors |
| Backend type-check | Not run: no backend source changed |

**The three tests:**
1. An unclassified profile shows "Not yet classified", and nothing is saved.
2. "Not a director" sends `{ isDirector: false }` only.
3. "Director" needs the date, then sends `true` + date + `AN`. A backend error is shown.

## Remaining blockers

- **The C7 migration `20261022100000_director_nic` is not applied to the dev database.** The screen saves the director fields only once it is. Apply it deliberately with `prisma migrate deploy`; it was not applied to any shared or real database in this sprint.
- **After that migration every existing profile is "Not yet classified",** so UK payroll tax and NI stop until each person is classified on this screen. Classify staff before the next payroll run.
- **Found, not changed (outside this feature).** The existing profile form shows category **A** when no NI category is recorded, and "Save profile" then saves A. This conflicts with the C6 rule that a missing category is never taken as A. The form should show "not set" and require a choice.

## Next sprint recommendation

**C9: NI category field fail-closed in the profile form.** Fix the issue above, with no default A and a required choice. After that, persist the RTI NI bands (LEL, LEL–PT, PT–UEL) and NI to date per category on the run row and the ledger.
