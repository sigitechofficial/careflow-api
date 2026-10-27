-- CreateEnum
CREATE TYPE "service_users"."EnquiryStage" AS ENUM ('NEW', 'CONTACTED', 'ASSESSMENT', 'OFFER', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "service_users"."EnquirySource" AS ENUM ('SELF', 'FAMILY', 'GP', 'HOSPITAL', 'LOCAL_AUTHORITY', 'NHS', 'SOCIAL_WORKER', 'WEBSITE', 'WORD_OF_MOUTH', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryType" AS ENUM ('PRIVATE', 'LOCAL_AUTHORITY', 'NHS', 'HOSPITAL');

-- CreateEnum
CREATE TYPE "service_users"."EnquiryUrgency" AS ENUM ('ROUTINE', 'URGENT');

-- CreateTable
CREATE TABLE "service_users"."Enquiry" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "stage" "service_users"."EnquiryStage" NOT NULL DEFAULT 'NEW',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "contactName" TEXT,
    "contactRelationship" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "source" "service_users"."EnquirySource" NOT NULL DEFAULT 'OTHER',
    "sourceDetail" TEXT,
    "enquiryType" "service_users"."EnquiryType",
    "urgency" "service_users"."EnquiryUrgency" NOT NULL DEFAULT 'ROUTINE',
    "needs" TEXT,
    "ownerId" UUID,
    "lostReason" TEXT,
    "convertedServiceUserId" UUID,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "recordedById" UUID,
    "deletedById" UUID,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryEvent" (
    "id" UUID NOT NULL,
    "enquiryId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "userId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."EnquiryNumberSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquiryNumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_referenceNumber_key" ON "service_users"."Enquiry"("referenceNumber");

-- CreateIndex
CREATE INDEX "Enquiry_stage_idx" ON "service_users"."Enquiry"("stage");

-- CreateIndex
CREATE INDEX "Enquiry_source_idx" ON "service_users"."Enquiry"("source");

-- CreateIndex
CREATE INDEX "Enquiry_ownerId_idx" ON "service_users"."Enquiry"("ownerId");

-- CreateIndex
CREATE INDEX "Enquiry_deletedAt_idx" ON "service_users"."Enquiry"("deletedAt");

-- CreateIndex
CREATE INDEX "EnquiryEvent_enquiryId_idx" ON "service_users"."EnquiryEvent"("enquiryId");

-- AddForeignKey
ALTER TABLE "service_users"."EnquiryEvent" ADD CONSTRAINT "EnquiryEvent_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "service_users"."Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

