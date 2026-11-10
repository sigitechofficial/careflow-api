-- Privacy and sharing: communication needs (Accessible Information Standard), who we may share with, and
-- information shared without consent.

CREATE TYPE "service_users"."ServiceUserSharingRecipientKind" AS ENUM ('CONTACT', 'PROFESSIONAL', 'ORGANISATION');

CREATE TYPE "service_users"."ServiceUserSharingBasis" AS ENUM ('CONSENT', 'BEST_INTERESTS', 'LPA_HEALTH_WELFARE', 'DEPUTY', 'OTHER');

CREATE TYPE "service_users"."ServiceUserSharingExceptionReason" AS ENUM ('SAFEGUARDING', 'VITAL_INTERESTS', 'LEGAL_DUTY', 'PREVENT_CRIME', 'OTHER');

CREATE TABLE "service_users"."ServiceUserCommunicationNeeds" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "interpreterNeeded" BOOLEAN NOT NULL DEFAULT false,
    "interpreterLanguage" VARCHAR(120) NOT NULL DEFAULT '',
    "formats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hearing" TEXT NOT NULL DEFAULT '',
    "sight" TEXT NOT NULL DEFAULT '',
    "contactViaContactId" UUID,
    "notes" TEXT NOT NULL DEFAULT '',
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceSubmissionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "ServiceUserCommunicationNeeds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."ServiceUserSharingAgreement" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "recipientKind" "service_users"."ServiceUserSharingRecipientKind" NOT NULL,
    "contactId" UUID,
    "recipientName" VARCHAR(255) NOT NULL,
    "recipientRole" VARCHAR(255) NOT NULL DEFAULT '',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "basis" "service_users"."ServiceUserSharingBasis" NOT NULL,
    "legalAuthorityId" UUID,
    "conditions" TEXT NOT NULL DEFAULT '',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "reviewOn" DATE,
    "stoppedAt" TIMESTAMP(3),
    "stoppedById" UUID,
    "stopReason" TEXT NOT NULL DEFAULT '',
    "source" "service_users"."ServiceUserClinicalDataSource" NOT NULL DEFAULT 'MANUAL',
    "sourceSubmissionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "ServiceUserSharingAgreement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_users"."ServiceUserSharingException" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "sharedOn" DATE NOT NULL,
    "sharedWith" VARCHAR(255) NOT NULL,
    "whatShared" TEXT NOT NULL,
    "reason" "service_users"."ServiceUserSharingExceptionReason" NOT NULL,
    "decidedBy" VARCHAR(255) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "ServiceUserSharingException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceUserCommunicationNeeds_serviceUserId_key" ON "service_users"."ServiceUserCommunicationNeeds"("serviceUserId");

CREATE INDEX "ServiceUserSharingAgreement_serviceUserId_idx" ON "service_users"."ServiceUserSharingAgreement"("serviceUserId");

CREATE INDEX "ServiceUserSharingAgreement_contactId_idx" ON "service_users"."ServiceUserSharingAgreement"("contactId");

CREATE INDEX "ServiceUserSharingException_serviceUserId_idx" ON "service_users"."ServiceUserSharingException"("serviceUserId");

ALTER TABLE "service_users"."ServiceUserCommunicationNeeds" ADD CONSTRAINT "ServiceUserCommunicationNeeds_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserCommunicationNeeds" ADD CONSTRAINT "ServiceUserCommunicationNeeds_contactViaContactId_fkey" FOREIGN KEY ("contactViaContactId") REFERENCES "service_users"."ServiceUserContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserSharingAgreement" ADD CONSTRAINT "ServiceUserSharingAgreement_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserSharingAgreement" ADD CONSTRAINT "ServiceUserSharingAgreement_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "service_users"."ServiceUserContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserSharingException" ADD CONSTRAINT "ServiceUserSharingException_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
