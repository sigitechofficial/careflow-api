-- Leaving is entered on Employment (end date, reason). Create the matching leaving record for anyone who
-- already has an end date but no leaving record. createdAt is back-dated to when the end date was last saved
-- (or the end date, if earlier) so the "Notice given" survey trigger does not fire now for old leavers.
INSERT INTO employees."EmployeeLeavingRecord"
  (id, "employeeId", "leavingReasonId", "leavingDate", notes, "isActive", "createdAt", "updatedAt", "createdById", "updatedById")
SELECT gen_random_uuid(), e."employeeId", e."leavingReasonId", e."endDate", NULLIF(btrim(e."leavingNotes"), ''), true,
       LEAST(e."endDate", e."updatedAt"), LEAST(e."endDate", e."updatedAt"), e."updatedById", e."updatedById"
FROM employees."EmployeeEmployment" e
WHERE e."endDate" IS NOT NULL
  AND e."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM employees."EmployeeLeavingRecord" l WHERE l."employeeId" = e."employeeId" AND l."deletedAt" IS NULL
  );
