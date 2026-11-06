-- Supervision, appraisal and probation are tracked by the review schedule (Staff reviews, Settings →
-- Supervision → Review types), not as compliance documents. Retires the numbered "Supervision 1…8"
-- document types and their duplicate spellings, plus the single Supervision / Annual Appraisal /
-- Probation document types, with their requirements. Nothing is deleted: the types and
-- requirements are soft-retired, and any document a carer already uploaded stays on their record,
-- marked "no longer required" with the reason.

WITH retired AS (
  UPDATE "lookups"."ComplianceType"
  SET "isActive" = false, "deletedAt" = CURRENT_TIMESTAMP
  WHERE "code" IN (
    'SUPERVISION', 'SUPERVISION_1', 'SUPERVISION_2', 'SUPERVISION_3', 'SUPERVISION_4', 'SUPERVISION_4_ALT',
    'SUPERVISION_5', 'SUPERVISION_7', 'SUPERVISION_7_ALT', 'SUPERVISION_8', 'SUPERVISION_CONCERN',
    'ANNUAL_APPRAISAL', 'PROBATION'
  )
  AND "deletedAt" IS NULL
  RETURNING "id"
)
UPDATE "employees"."ComplianceRequirement"
SET "isActive" = false, "deletedAt" = CURRENT_TIMESTAMP
WHERE "complianceTypeId" IN (SELECT "id" FROM retired) AND "deletedAt" IS NULL;

UPDATE "employees"."EmployeeCompliance"
SET "isNoLongerRequired" = true,
    "noLongerRequiredReason" = 'Tracked by the review schedule (Staff reviews)',
    "noLongerRequiredAt" = CURRENT_TIMESTAMP
WHERE "isNoLongerRequired" = false
  AND "complianceTypeId" IN (
    SELECT "id" FROM "lookups"."ComplianceType"
    WHERE "code" IN (
      'SUPERVISION', 'SUPERVISION_1', 'SUPERVISION_2', 'SUPERVISION_3', 'SUPERVISION_4', 'SUPERVISION_4_ALT',
      'SUPERVISION_5', 'SUPERVISION_7', 'SUPERVISION_7_ALT', 'SUPERVISION_8', 'SUPERVISION_CONCERN',
      'ANNUAL_APPRAISAL', 'PROBATION'
    )
  );
