-- CreateTable
CREATE TABLE "employees"."EmployeePortalAccount" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "refreshTokenHash" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "EmployeePortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePortalAccount_employeeId_key" ON "employees"."EmployeePortalAccount"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePortalAccount_email_key" ON "employees"."EmployeePortalAccount"("email");

-- CreateIndex
CREATE INDEX "EmployeePortalAccount_deletedAt_idx" ON "employees"."EmployeePortalAccount"("deletedAt");

-- AddForeignKey
ALTER TABLE "employees"."EmployeePortalAccount" ADD CONSTRAINT "EmployeePortalAccount_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
