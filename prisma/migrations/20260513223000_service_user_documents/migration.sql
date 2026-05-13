-- CreateTable
CREATE TABLE "service_users"."ServiceUserLegalDocument" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "dnacprInPlace" BOOLEAN NOT NULL DEFAULT false,
    "dnacprCertificateUrl" TEXT,
    "dnacprStartDate" TIMESTAMP(3),
    "lpaHealthCertificateUrl" TEXT,
    "lpaFinanceCertificateUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserLegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserLegalDocument_serviceUserId_key" ON "service_users"."ServiceUserLegalDocument"("serviceUserId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserLegalDocument" ADD CONSTRAINT "ServiceUserLegalDocument_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "service_users"."ServiceUserDolsRecord" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "applicationDate" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "reportedToChc" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "certificateUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserDolsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserDolsRecord_serviceUserId_idx" ON "service_users"."ServiceUserDolsRecord"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserDolsRecord_deletedAt_idx" ON "service_users"."ServiceUserDolsRecord"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserDolsRecord" ADD CONSTRAINT "ServiceUserDolsRecord_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
