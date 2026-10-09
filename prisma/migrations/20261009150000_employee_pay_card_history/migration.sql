-- CreateTable
CREATE TABLE "billing"."EmployeePayCardAssignment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "payCardId" UUID,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "EmployeePayCardAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeePayCardAssignment_employeeId_idx" ON "billing"."EmployeePayCardAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeePayCardAssignment_payCardId_idx" ON "billing"."EmployeePayCardAssignment"("payCardId");

-- AddForeignKey
ALTER TABLE "billing"."EmployeePayCardAssignment" ADD CONSTRAINT "EmployeePayCardAssignment_payCardId_fkey" FOREIGN KEY ("payCardId") REFERENCES "billing"."PayCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every carer's current own card becomes an open history row "from the start",
-- so pricing of past and future visits is unchanged until the card is next changed.
INSERT INTO "billing"."EmployeePayCardAssignment" ("id", "employeeId", "payCardId", "effectiveFrom", "effectiveTo", "reason", "createdAt", "createdById")
SELECT gen_random_uuid(), e."employeeId", e."defaultPayCardId", NULL, NULL, 'Existing assignment', CURRENT_TIMESTAMP, NULL
FROM "employees"."EmployeeEmployment" e
WHERE e."defaultPayCardId" IS NOT NULL AND e."deletedAt" IS NULL;
