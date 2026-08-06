-- CreateEnum
CREATE TYPE "payroll"."PayrollTaxCodeGroup" AS ENUM ('STANDARD', 'SPECIAL', 'SCOTLAND', 'WALES');

-- CreateTable
CREATE TABLE "payroll"."PayrollTaxCode" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "group" "payroll"."PayrollTaxCodeGroup" NOT NULL DEFAULT 'STANDARD',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PayrollTaxCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollTaxCode_code_key" ON "payroll"."PayrollTaxCode"("code");

-- CreateIndex
CREATE INDEX "PayrollTaxCode_isActive_sortOrder_idx" ON "payroll"."PayrollTaxCode"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "PayrollTaxCode_group_idx" ON "payroll"."PayrollTaxCode"("group");

-- CreateIndex
CREATE INDEX "PayrollTaxCode_deletedAt_idx" ON "payroll"."PayrollTaxCode"("deletedAt");
