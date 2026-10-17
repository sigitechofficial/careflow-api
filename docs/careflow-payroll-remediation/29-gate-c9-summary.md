# 29 — Gate C9: Remove the Unsafe Default NI Category A

**Date:** 2026-10-14 · **Branch:** `payroll-remediation/gate-c9` in both repositories. The frontend branch is on `gate-c8`; the backend branch is on `gate-c8` and holds this report only. Synthetic data only. No backend, migration or NI calculation change. No push or deployment.

## Bug fixed

On the Payroll → Employees profile form, a profile with no NI category showed **A**, and "Save profile" saved A although nobody chose it. That broke the C6 rule that a missing category is never assumed.

**Now:**
- **A missing category (`null`, missing or empty) shows "Not set"** in the NI field and in the rate summary. A clear message says the category is not set, that tax and NI are not calculated without it, and that saving other fields leaves it not set.
- **A is never selected automatically.** A category is saved only after someone chooses it in the field.
- **Saving other fields with no category left out of the request.** The backend's existing rule (an absent field is unchanged) then keeps it not set, so nothing is created or changed.
- **A recorded category** displays and saves exactly as before.
- **Unchanged:**
  - the Director Classification section and its own save;
  - the permissions (`payroll.employees.manage` edits);
  - the profile mutation;
  - the "Ready" check, which already lists a missing NI category as an RTI issue.

## Files changed (frontend `care-admin`)

- `src/features/payroll/pages/PayrollEmployeesPage.tsx`
- New `src/features/payroll/pages/PayrollEmployeesPage.ni-category.test.tsx`

## Commit

Frontend `230c1a9`.

## Tests

| Check | Result |
|---|---|
| `PayrollEmployeesPage.ni-category.test.tsx`: 3 tests | 3 passed, 0 failed |
| Frontend type-check (`tsconfig.json`, unfiltered) | 0 errors |

**The three tests:**
1. A missing category shows "Not set", not A, with the message.
2. Choosing A saves A.
3. Saving the P45 flag with no category sends no `niCategory`; a recorded C is saved unchanged as C.

## Remaining blockers

- **The C7 migration `20261022100000_director_nic` is still not applied to the dev database.** It is needed before director status can be saved. After it, every profile is unclassified until set.
- **Profiles that already hold an A saved by the old default cannot be told apart from a real choice.** Before the first real run, review the NI category of each employee whose profile was saved through this form.
- **Seen while testing, not changed.** The form's reset effect re-runs whenever the tax code list is re-created. A new empty list on every render (for example while that list is still loading) can make the open dialog re-render repeatedly. In normal use the loaded list is stable.
- Other screens that show the NI category were not reviewed in this micro sprint.

## Next implementation recommendation

**C10: RTI NI data.** Store the NI bands (at LEL, LEL–PT, PT–UEL), NI to date per category and the director flags on the run row and the YTD ledger, ready for the FPS. Then review the form's reset effect noted above.
