-- Schema changes that were added to schema.prisma without a migration:
--   * ServiceUser.careLevel  (0e2f27b, 16 Oct: care level Standard/Complex)
--   * SpecialVisit table      (2016d00, 15 Oct: special visit module)
-- Written idempotently (IF NOT EXISTS) because some databases may already have them via `prisma db push`.

-- AlterTable
ALTER TABLE "service_users"."ServiceUser" ADD COLUMN IF NOT EXISTS "careLevel" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "employees"."SpecialVisit" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "visitDate" DATE NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "SpecialVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SpecialVisit_employeeId_idx" ON "employees"."SpecialVisit"("employeeId");
CREATE INDEX IF NOT EXISTS "SpecialVisit_visitDate_idx" ON "employees"."SpecialVisit"("visitDate");
CREATE INDEX IF NOT EXISTS "SpecialVisit_deletedAt_idx" ON "employees"."SpecialVisit"("deletedAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpecialVisit_employeeId_fkey') THEN
    ALTER TABLE "employees"."SpecialVisit"
      ADD CONSTRAINT "SpecialVisit_employeeId_fkey" FOREIGN KEY ("employeeId")
      REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
