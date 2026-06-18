# Deprecated compliance type codes

Soft-retired in `seedWorkforceCatalog` — rows remain in DB with `isActive=false` so existing `EmployeeCompliance` FKs are preserved.

| Code | Replaced by |
|------|-------------|
| SUPERVISION_1 … SUPERVISION_8 | SUPERVISION |
| SUPERVISION_4_ALT, SUPERVISION_7_ALT | SUPERVISION |
| SUPERVISION_CONCERN | SUPERVISION (use notes on EmployeeReview / compliance record) |

Canonical moving & handling code: **MOVING_HANDLING_PEOPLE** (legacy **MANUAL_HANDLING** retained for backward compatibility).
