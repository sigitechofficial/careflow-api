-- Gate C13: HMRC student / postgraduate loan start and stop notices (SL1, SL2, PGL1, PGL2).
-- Additive: one new, empty table. No notice is created from the existing loan checkboxes, so
-- their provenance stays unresolved for production review. Rollback: drop the table.

-- CreateTable
CREATE TABLE "payroll"."EmployeeLoanNotice" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "noticeType" TEXT NOT NULL,
    "studentLoanPlan" TEXT,
    "hmrcReference" TEXT,
    "noticeDate" DATE NOT NULL,
    "receivedOn" DATE NOT NULL,
    "effectivePayday" DATE NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID NOT NULL,

    CONSTRAINT "EmployeeLoanNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeLoanNotice_employeeId_idx" ON "payroll"."EmployeeLoanNotice"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLoanNotice_employeeId_noticeType_hmrcReference_key" ON "payroll"."EmployeeLoanNotice"("employeeId", "noticeType", "hmrcReference");

