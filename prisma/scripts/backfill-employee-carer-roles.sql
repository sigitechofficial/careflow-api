-- Set every active employee employment to the Carer role.
-- Run: Get-Content prisma/scripts/backfill-employee-carer-roles.sql | npx prisma db execute --stdin --schema prisma/schema.prisma

INSERT INTO lookups."EmployeeRoleLookup" (id, name, "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Carer', true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM lookups."EmployeeRoleLookup" WHERE name = 'Carer' AND "deletedAt" IS NULL
);

UPDATE employees."EmployeeEmployment" ee
SET
  "roleId" = carer_role.id,
  "updatedAt" = NOW()
FROM (
  SELECT id FROM lookups."EmployeeRoleLookup"
  WHERE name = 'Carer' AND "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
) AS carer_role
WHERE ee."deletedAt" IS NULL
  AND (
    ee."roleId" IS NULL
    OR ee."roleId" IS DISTINCT FROM carer_role.id
  );
