-- CreateEnum
CREATE TYPE "service_users"."ReferralSourceType" AS ENUM ('LOCAL_AUTHORITY', 'NHS', 'HOSPITAL', 'SOCIAL_WORKER', 'GP', 'PRIVATE', 'FAMILY', 'SELF_REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."ReferralReceivedVia" AS ENUM ('EMAIL', 'PHONE', 'PORTAL', 'IN_PERSON', 'LETTER', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."ReferralPriority" AS ENUM ('ROUTINE', 'URGENT', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "service_users"."ReferralStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'ASSESSMENT_BOOKED', 'ON_HOLD', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "service_users"."CareQuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "service_users"."QuotationPayerType" AS ENUM ('SERVICE_USER', 'FAMILY', 'REPRESENTATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "service_users"."QuotationChargeFrequency" AS ENUM ('ONE_OFF', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "service_users"."ServiceUserReferral" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "status" "service_users"."ReferralStatus" NOT NULL DEFAULT 'NEW',
    "priority" "service_users"."ReferralPriority" NOT NULL DEFAULT 'ROUTINE',
    "sourceType" "service_users"."ReferralSourceType" NOT NULL,
    "referringOrganisation" TEXT,
    "referrerName" TEXT,
    "referrerRole" TEXT,
    "referrerPhone" TEXT,
    "referrerEmail" TEXT,
    "referralDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedVia" "service_users"."ReferralReceivedVia" NOT NULL DEFAULT 'EMAIL',
    "receivedByEmployeeId" UUID,
    "locationId" UUID,
    "responsibleEmployeeId" UUID,
    "careRequirements" TEXT,
    "expectedStartDate" DATE,
    "requestedHoursPerWeek" DECIMAL(6,2),
    "fundingTypeId" UUID,
    "funderId" UUID,
    "fundingNotes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "decisionAt" TIMESTAMP(3),
    "decisionById" UUID,
    "decisionReason" TEXT,
    "notes" TEXT,
    "recordedById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,

    CONSTRAINT "ServiceUserReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."CareQuotation" (
    "id" UUID NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rootQuotationId" UUID,
    "serviceUserId" UUID NOT NULL,
    "referralId" UUID,
    "visitPlanId" UUID,
    "status" "service_users"."CareQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "responsibleEmployeeId" UUID,
    "payerType" "service_users"."QuotationPayerType" NOT NULL DEFAULT 'SERVICE_USER',
    "payerName" TEXT,
    "payerRelationship" TEXT,
    "payerEmail" TEXT,
    "payerPhone" TEXT,
    "payerAddress" TEXT,
    "validUntil" DATE,
    "startDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "notes" TEXT,
    "terms" TEXT,
    "weeklyCareCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "weeklyChargesCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyChargesCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "oneOffChargesCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "weeklyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "monthlyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "weeklyHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "sentById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByName" TEXT,
    "acceptanceMethod" TEXT,
    "acceptanceRecordedById" UUID,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CareQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."CareQuotationLine" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "daysOfWeek" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visitsPerWeek" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "numberOfCarers" INTEGER NOT NULL DEFAULT 1,
    "hourlyRate" DECIMAL(10,2) NOT NULL,
    "weeklyHours" DECIMAL(8,2) NOT NULL,
    "weeklyCost" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CareQuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."CareQuotationCharge" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "service_users"."QuotationChargeFrequency" NOT NULL DEFAULT 'WEEKLY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CareQuotationCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ServiceUserReferralEvent" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "referralId" UUID,
    "quotationId" UUID,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "changes" JSONB,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceUserReferralEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ReferralNumberSequence" (
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralNumberSequence_pkey" PRIMARY KEY ("kind","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceUserReferral_referenceNumber_key" ON "service_users"."ServiceUserReferral"("referenceNumber");

-- CreateIndex
CREATE INDEX "ServiceUserReferral_serviceUserId_idx" ON "service_users"."ServiceUserReferral"("serviceUserId");

-- CreateIndex
CREATE INDEX "ServiceUserReferral_status_idx" ON "service_users"."ServiceUserReferral"("status");

-- CreateIndex
CREATE INDEX "ServiceUserReferral_locationId_idx" ON "service_users"."ServiceUserReferral"("locationId");

-- CreateIndex
CREATE INDEX "ServiceUserReferral_deletedAt_idx" ON "service_users"."ServiceUserReferral"("deletedAt");

-- CreateIndex
CREATE INDEX "CareQuotation_serviceUserId_idx" ON "service_users"."CareQuotation"("serviceUserId");

-- CreateIndex
CREATE INDEX "CareQuotation_referralId_idx" ON "service_users"."CareQuotation"("referralId");

-- CreateIndex
CREATE INDEX "CareQuotation_rootQuotationId_idx" ON "service_users"."CareQuotation"("rootQuotationId");

-- CreateIndex
CREATE INDEX "CareQuotation_status_idx" ON "service_users"."CareQuotation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CareQuotation_referenceNumber_revision_key" ON "service_users"."CareQuotation"("referenceNumber", "revision");

-- CreateIndex
CREATE INDEX "CareQuotationLine_quotationId_idx" ON "service_users"."CareQuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "CareQuotationCharge_quotationId_idx" ON "service_users"."CareQuotationCharge"("quotationId");

-- CreateIndex
CREATE INDEX "ServiceUserReferralEvent_serviceUserId_createdAt_idx" ON "service_users"."ServiceUserReferralEvent"("serviceUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceUserReferralEvent_referralId_idx" ON "service_users"."ServiceUserReferralEvent"("referralId");

-- CreateIndex
CREATE INDEX "ServiceUserReferralEvent_quotationId_idx" ON "service_users"."ServiceUserReferralEvent"("quotationId");

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserReferral" ADD CONSTRAINT "ServiceUserReferral_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CareQuotation" ADD CONSTRAINT "CareQuotation_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CareQuotation" ADD CONSTRAINT "CareQuotation_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "service_users"."ServiceUserReferral"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CareQuotationLine" ADD CONSTRAINT "CareQuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "service_users"."CareQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."CareQuotationCharge" ADD CONSTRAINT "CareQuotationCharge_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "service_users"."CareQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."ServiceUserReferralEvent" ADD CONSTRAINT "ServiceUserReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "service_users"."ServiceUserReferral"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Document types so referral and quotation files live in the existing service user document store.
INSERT INTO "lookups"."ServiceUserDocumentTypeCatalog"
  ("id", "code", "name", "defaultAccessLevel", "cqcLegalStandard", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), v.code, v.name, 'COORDINATOR_MANAGER', 'Reg 17', v.sort, NOW()
FROM (VALUES
  ('REFERRAL_DOCUMENT', 'Referral document', 180),
  ('CARE_QUOTATION', 'Care quotation / agreement', 190)
) AS v(code, name, sort)
WHERE NOT EXISTS (SELECT 1 FROM "lookups"."ServiceUserDocumentTypeCatalog" t WHERE t."code" = v.code);

-- Backfill: service users with the earlier key/value referral fields get one referral record
-- (the old values are left in place).
WITH legacy AS (
  SELECT r."serviceUserId",
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_AUTHORITY' THEN btrim(r."referenceValue") END) AS authority,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_SOURCE' THEN btrim(r."referenceValue") END) AS source,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_DATE' THEN btrim(r."referenceValue") END) AS ref_date,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_RECEIVED_VIA' THEN btrim(r."referenceValue") END) AS via,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_RECEIVED_AT' THEN btrim(r."referenceValue") END) AS received_at,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_NOTES' THEN btrim(r."referenceValue") END) AS notes,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_RECORDED_BY' THEN btrim(r."referenceValue") END) AS recorded_by,
    max(CASE WHEN r."referenceType" = 'SU_PROFILE_REFERRAL_RECORDED_AT' THEN btrim(r."referenceValue") END) AS recorded_at
  FROM "service_users"."ServiceUserReference" r
  WHERE r."referenceType" LIKE 'SU_PROFILE_REFERRAL_%'
    AND r."deletedAt" IS NULL
    AND btrim(coalesce(r."referenceValue", '')) <> ''
  GROUP BY r."serviceUserId"
),
parsed AS (
  SELECT l.*, su."locationId", su."createdAt" AS su_created,
    row_number() OVER (ORDER BY su."createdAt", l."serviceUserId") AS n,
    CASE WHEN l.ref_date ~ '^\d{4}-\d{2}-\d{2}' THEN (substr(l.ref_date, 1, 10) || ' 12:00:00')::timestamp END AS ref_ts,
    CASE WHEN l.received_at ~ '^\d{4}-\d{2}-\d{2}T' THEN (l.received_at::timestamptz AT TIME ZONE 'UTC') END AS received_ts,
    CASE WHEN l.recorded_at ~ '^\d{4}-\d{2}-\d{2}T' THEN (l.recorded_at::timestamptz AT TIME ZONE 'UTC') END AS recorded_ts
  FROM legacy l
  JOIN "service_users"."ServiceUser" su ON su."id" = l."serviceUserId" AND su."deletedAt" IS NULL
  WHERE NOT EXISTS (SELECT 1 FROM "service_users"."ServiceUserReferral" x WHERE x."serviceUserId" = l."serviceUserId")
),
inserted AS (
  INSERT INTO "service_users"."ServiceUserReferral"
    ("id", "referenceNumber", "serviceUserId", "status", "priority", "sourceType", "referringOrganisation",
     "referrerName", "referralDate", "receivedAt", "receivedVia", "locationId", "notes", "createdAt", "updatedAt")
  SELECT gen_random_uuid(), 'REF-LEGACY-' || lpad(p.n::text, 4, '0'), p."serviceUserId", 'ACCEPTED', 'ROUTINE', 'OTHER',
    p.authority, p.source, p.ref_ts,
    coalesce(p.received_ts, p.ref_ts, p.recorded_ts, p.su_created),
    (CASE lower(coalesce(p.via, ''))
      WHEN 'email' THEN 'EMAIL' WHEN 'phone' THEN 'PHONE' WHEN 'letter / post' THEN 'LETTER'
      WHEN 'portal / online' THEN 'PORTAL' WHEN 'in person' THEN 'IN_PERSON' ELSE 'OTHER' END
    )::"service_users"."ReferralReceivedVia",
    p."locationId", p.notes, coalesce(p.recorded_ts, p.su_created), NOW()
  FROM parsed p
  RETURNING "id", "serviceUserId"
)
INSERT INTO "service_users"."ServiceUserReferralEvent" ("id", "serviceUserId", "referralId", "action", "toStatus", "note", "createdAt")
SELECT gen_random_uuid(), i."serviceUserId", i."id", 'LEGACY_IMPORTED', 'ACCEPTED',
  'Imported from the earlier referral fields'
    || CASE WHEN p.recorded_by IS NOT NULL THEN '. Originally recorded by ' || p.recorded_by ELSE '' END
    || CASE WHEN p.recorded_ts IS NOT NULL THEN ' on ' || to_char(p.recorded_ts, 'DD/MM/YYYY HH24:MI') || ' UTC' ELSE '' END,
  NOW()
FROM inserted i
JOIN parsed p ON p."serviceUserId" = i."serviceUserId";
