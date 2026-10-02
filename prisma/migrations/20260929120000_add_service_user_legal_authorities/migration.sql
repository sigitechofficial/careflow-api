-- CreateEnum
CREATE TYPE "service_users"."ServiceUserLegalAuthorityCategory" AS ENUM (
  'LPA_HEALTH_WELFARE',
  'LPA_PROPERTY_FINANCE',
  'EPA',
  'DEPUTY_HEALTH_WELFARE',
  'DEPUTY_PROPERTY_AFFAIRS',
  'COURT_ORDER',
  'APPOINTEE',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "service_users"."ServiceUserLegalAuthorityVerification" AS ENUM (
  'REPORTED',
  'DOCUMENT_SEEN',
  'VERIFIED',
  'NOT_VALID'
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserLegalAuthority" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "category" "service_users"."ServiceUserLegalAuthorityCategory" NOT NULL,
    "holderName" VARCHAR(255) NOT NULL,
    "holderRelationship" VARCHAR(255) NOT NULL DEFAULT '',
    "holderContact" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "lifeSustainingTreatment" BOOLEAN,
    "registeredOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "reference" VARCHAR(255) NOT NULL DEFAULT '',
    "verificationStatus" "service_users"."ServiceUserLegalAuthorityVerification" NOT NULL DEFAULT 'REPORTED',
    "verificationMethod" TEXT NOT NULL DEFAULT '',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" UUID,
    "documentUrl" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceSubmissionId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserLegalAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceUserLegalAuthority_serviceUserId_idx" ON "service_users"."ServiceUserLegalAuthority"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserLegalAuthority_deletedAt_idx" ON "service_users"."ServiceUserLegalAuthority"("deletedAt");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserLegalAuthority" ADD CONSTRAINT "ServiceUserLegalAuthority_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
