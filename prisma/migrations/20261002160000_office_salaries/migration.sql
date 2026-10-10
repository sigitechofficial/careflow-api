-- CreateEnum
CREATE TYPE "payroll"."OfficeSalaryPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateTable
CREATE TABLE "payroll"."OfficeUserSalary" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "period" "payroll"."OfficeSalaryPeriod" NOT NULL DEFAULT 'MONTHLY',
    "payDay" INTEGER,
    "startDate" DATE,
    "bankAccountName" TEXT,
    "bankSortCode" TEXT,
    "bankAccountNumber" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "OfficeUserSalary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll"."OfficeSalaryPayment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" DATE,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "OfficeSalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeUserSalary_userId_key" ON "payroll"."OfficeUserSalary"("userId");

-- CreateIndex
CREATE INDEX "OfficeSalaryPayment_month_idx" ON "payroll"."OfficeSalaryPayment"("month");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeSalaryPayment_userId_month_key" ON "payroll"."OfficeSalaryPayment"("userId", "month");

-- Permission: office salaries are visible to Super Admin and Admin only.
INSERT INTO "identity"."Permission" ("id", "key", "description", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'office_salaries.manage', 'View and manage office user salaries and payments', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "identity"."Permission" p WHERE p."key" = 'office_salaries.manage');

INSERT INTO "identity"."RolePermission" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "identity"."Role" r
CROSS JOIN "identity"."Permission" p
WHERE r."name" IN ('Super Admin', 'Admin')
  AND p."key" = 'office_salaries.manage'
  AND NOT EXISTS (
    SELECT 1 FROM "identity"."RolePermission" rp
    WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );
