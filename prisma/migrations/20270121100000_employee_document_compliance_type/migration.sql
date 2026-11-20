-- EmployeeDocument.complianceTypeId is in schema.prisma but was never created by a migration, so
-- databases built from migrations lack it and every EmployeeDocument read fails (P2022), e.g. the
-- Care app "My profile". Additive only; safe where the column already exists.

ALTER TABLE "employees"."EmployeeDocument" ADD COLUMN IF NOT EXISTS "complianceTypeId" UUID;

CREATE INDEX IF NOT EXISTS "EmployeeDocument_complianceTypeId_idx" ON "employees"."EmployeeDocument"("complianceTypeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmployeeDocument_complianceTypeId_fkey') THEN
    ALTER TABLE "employees"."EmployeeDocument"
      ADD CONSTRAINT "EmployeeDocument_complianceTypeId_fkey"
      FOREIGN KEY ("complianceTypeId") REFERENCES "lookups"."ComplianceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
