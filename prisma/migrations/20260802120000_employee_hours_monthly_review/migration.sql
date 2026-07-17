-- CreateTable
CREATE TABLE "employees"."EmployeeHoursMonthlyReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "reviewCompleted" BOOLEAN NOT NULL DEFAULT false,
  "smsReportingRequired" BOOLEAN,
  "complianceStatusOverride" TEXT,
  "comments" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" UUID,

  CONSTRAINT "EmployeeHoursMonthlyReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeHoursMonthlyReview_employeeId_year_month_key"
  ON "employees"."EmployeeHoursMonthlyReview"("employeeId", "year", "month");

-- CreateIndex
CREATE INDEX "EmployeeHoursMonthlyReview_year_month_idx"
  ON "employees"."EmployeeHoursMonthlyReview"("year", "month");

-- AddForeignKey
ALTER TABLE "employees"."EmployeeHoursMonthlyReview"
  ADD CONSTRAINT "EmployeeHoursMonthlyReview_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
