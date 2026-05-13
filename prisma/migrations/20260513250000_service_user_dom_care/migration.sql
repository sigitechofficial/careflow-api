-- CreateTable
CREATE TABLE "service_users"."ServiceUserDomCare" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "accessInstruction" TEXT NOT NULL DEFAULT '',
    "accessRisks" TEXT NOT NULL DEFAULT '',
    "doorCode" TEXT,
    "careInstructions" TEXT NOT NULL DEFAULT '',
    "weeklyContractedHours" TEXT,
    "contractDocumentUrl" TEXT,
    "numberOfCarers" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserDomCare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserDomCare_serviceUserId_key" ON "service_users"."ServiceUserDomCare"("serviceUserId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserDomCare" ADD CONSTRAINT "ServiceUserDomCare_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "service_users"."ServiceUserDomCarePreferredCarer" (
    "id" UUID NOT NULL,
    "serviceUserDomCareId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserDomCarePreferredCarer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserDomCarePreferredCarer_serviceUserDomCareId_employeeId_key" ON "service_users"."ServiceUserDomCarePreferredCarer"("serviceUserDomCareId", "employeeId");

-- CreateIndex
CREATE INDEX "ServiceUserDomCarePreferredCarer_serviceUserDomCareId_idx" ON "service_users"."ServiceUserDomCarePreferredCarer"("serviceUserDomCareId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserDomCarePreferredCarer" ADD CONSTRAINT "ServiceUserDomCarePreferredCarer_serviceUserDomCareId_fkey" FOREIGN KEY ("serviceUserDomCareId") REFERENCES "service_users"."ServiceUserDomCare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserDomCarePreferredCarer" ADD CONSTRAINT "ServiceUserDomCarePreferredCarer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "service_users"."ServiceUserDomCareBlockedCarer" (
    "id" UUID NOT NULL,
    "serviceUserDomCareId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceUserDomCareBlockedCarer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserDomCareBlockedCarer_serviceUserDomCareId_employeeId_key" ON "service_users"."ServiceUserDomCareBlockedCarer"("serviceUserDomCareId", "employeeId");

-- CreateIndex
CREATE INDEX "ServiceUserDomCareBlockedCarer_serviceUserDomCareId_idx" ON "service_users"."ServiceUserDomCareBlockedCarer"("serviceUserDomCareId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserDomCareBlockedCarer" ADD CONSTRAINT "ServiceUserDomCareBlockedCarer_serviceUserDomCareId_fkey" FOREIGN KEY ("serviceUserDomCareId") REFERENCES "service_users"."ServiceUserDomCare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserDomCareBlockedCarer" ADD CONSTRAINT "ServiceUserDomCareBlockedCarer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
