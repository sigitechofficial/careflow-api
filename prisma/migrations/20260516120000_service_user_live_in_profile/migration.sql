-- Live-in Service Profile (lookups + profile + carers + contract documents)

CREATE TYPE "service_users"."LiveInProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');

CREATE TABLE "service_users"."LiveInServiceType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "LiveInServiceType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveInServiceType_code_key" ON "service_users"."LiveInServiceType"("code");

CREATE TABLE "service_users"."LiveInLevelOfCare" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "LiveInLevelOfCare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveInLevelOfCare_code_key" ON "service_users"."LiveInLevelOfCare"("code");

CREATE TABLE "service_users"."LiveInScanType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "LiveInScanType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveInScanType_code_key" ON "service_users"."LiveInScanType"("code");

CREATE TABLE "service_users"."ServiceUserLiveInProfile" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "isLiveInEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "serviceTypeId" UUID,
    "residentContactId" UUID,
    "levelOfCareId" UUID,
    "scanTypeId" UUID,
    "numberOfCarers" INTEGER NOT NULL DEFAULT 1,
    "careInstructions" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "status" "service_users"."LiveInProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,
    CONSTRAINT "ServiceUserLiveInProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserLiveInProfile_serviceUserId_key" ON "service_users"."ServiceUserLiveInProfile"("serviceUserId");
CREATE INDEX "ServiceUserLiveInProfile_deletedAt_idx" ON "service_users"."ServiceUserLiveInProfile"("deletedAt");
CREATE INDEX "ServiceUserLiveInProfile_status_idx" ON "service_users"."ServiceUserLiveInProfile"("status");

ALTER TABLE "service_users"."ServiceUserLiveInProfile" ADD CONSTRAINT "ServiceUserLiveInProfile_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInProfile" ADD CONSTRAINT "ServiceUserLiveInProfile_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "service_users"."LiveInServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInProfile" ADD CONSTRAINT "ServiceUserLiveInProfile_residentContactId_fkey" FOREIGN KEY ("residentContactId") REFERENCES "service_users"."ServiceUserContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInProfile" ADD CONSTRAINT "ServiceUserLiveInProfile_levelOfCareId_fkey" FOREIGN KEY ("levelOfCareId") REFERENCES "service_users"."LiveInLevelOfCare"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInProfile" ADD CONSTRAINT "ServiceUserLiveInProfile_scanTypeId_fkey" FOREIGN KEY ("scanTypeId") REFERENCES "service_users"."LiveInScanType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_users"."ServiceUserLiveInPreferredCarer" (
    "id" UUID NOT NULL,
    "liveInProfileId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "ServiceUserLiveInPreferredCarer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserLiveInPreferredCarer_liveInProfileId_employeeId_key" ON "service_users"."ServiceUserLiveInPreferredCarer"("liveInProfileId", "employeeId");
CREATE INDEX "ServiceUserLiveInPreferredCarer_liveInProfileId_idx" ON "service_users"."ServiceUserLiveInPreferredCarer"("liveInProfileId");
CREATE INDEX "ServiceUserLiveInPreferredCarer_employeeId_idx" ON "service_users"."ServiceUserLiveInPreferredCarer"("employeeId");

ALTER TABLE "service_users"."ServiceUserLiveInPreferredCarer" ADD CONSTRAINT "ServiceUserLiveInPreferredCarer_liveInProfileId_fkey" FOREIGN KEY ("liveInProfileId") REFERENCES "service_users"."ServiceUserLiveInProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInPreferredCarer" ADD CONSTRAINT "ServiceUserLiveInPreferredCarer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."ServiceUserLiveInBlockedCarer" (
    "id" UUID NOT NULL,
    "liveInProfileId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "ServiceUserLiveInBlockedCarer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserLiveInBlockedCarer_liveInProfileId_employeeId_key" ON "service_users"."ServiceUserLiveInBlockedCarer"("liveInProfileId", "employeeId");
CREATE INDEX "ServiceUserLiveInBlockedCarer_liveInProfileId_idx" ON "service_users"."ServiceUserLiveInBlockedCarer"("liveInProfileId");
CREATE INDEX "ServiceUserLiveInBlockedCarer_employeeId_idx" ON "service_users"."ServiceUserLiveInBlockedCarer"("employeeId");

ALTER TABLE "service_users"."ServiceUserLiveInBlockedCarer" ADD CONSTRAINT "ServiceUserLiveInBlockedCarer_liveInProfileId_fkey" FOREIGN KEY ("liveInProfileId") REFERENCES "service_users"."ServiceUserLiveInProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInBlockedCarer" ADD CONSTRAINT "ServiceUserLiveInBlockedCarer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."ServiceUserLiveInContractDocument" (
    "id" UUID NOT NULL,
    "liveInProfileId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ServiceUserLiveInContractDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceUserLiveInContractDocument_liveInProfileId_idx" ON "service_users"."ServiceUserLiveInContractDocument"("liveInProfileId");
CREATE INDEX "ServiceUserLiveInContractDocument_deletedAt_idx" ON "service_users"."ServiceUserLiveInContractDocument"("deletedAt");

ALTER TABLE "service_users"."ServiceUserLiveInContractDocument" ADD CONSTRAINT "ServiceUserLiveInContractDocument_liveInProfileId_fkey" FOREIGN KEY ("liveInProfileId") REFERENCES "service_users"."ServiceUserLiveInProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_users"."ServiceUserLiveInContractDocument" ADD CONSTRAINT "ServiceUserLiveInContractDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
