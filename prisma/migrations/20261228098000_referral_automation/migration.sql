-- Referral automation: settings, branch coverage and named managers, and the checks/decision/reply on each email.
-- AlterTable
ALTER TABLE "service_users"."ReferralEmail" ADD COLUMN     "checks" JSONB,
ADD COLUMN     "decision" TEXT,
ADD COLUMN     "decisionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "locationId" UUID,
ADD COLUMN     "replyError" TEXT,
ADD COLUMN     "replySentAt" TIMESTAMP(3),
ADD COLUMN     "replySentById" UUID,
ADD COLUMN     "replySentTo" TEXT,
ADD COLUMN     "replySubject" TEXT,
ADD COLUMN     "replyText" TEXT;

-- CreateTable
CREATE TABLE "service_users"."ReferralAutomationSettings" (
    "id" UUID NOT NULL,
    "autoCreateEnquiry" BOOLEAN NOT NULL DEFAULT true,
    "autoReply" BOOLEAN NOT NULL DEFAULT true,
    "autoReplyDecisions" TEXT[] DEFAULT ARRAY['YES', 'POSSIBLY', 'NEED_INFO', 'NO']::TEXT[],
    "minNoticeDays" INTEGER NOT NULL DEFAULT 2,
    "answerPriceQuestions" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralAutomationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."ReferralBranchCoverage" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "localAuthorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replyManagerName" TEXT,
    "replyManagerTitle" TEXT,
    "replyPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralBranchCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralBranchCoverage_locationId_key" ON "service_users"."ReferralBranchCoverage"("locationId");

-- Starting coverage (edit in Settings → Referral automation). Councils per branch; replies signed by the
-- branch's first registered manager.
INSERT INTO service_users."ReferralAutomationSettings" (id, "updatedAt") SELECT gen_random_uuid(), now()
WHERE NOT EXISTS (SELECT 1 FROM service_users."ReferralAutomationSettings");

INSERT INTO service_users."ReferralBranchCoverage" (id, "locationId", "localAuthorities", "replyManagerName", "replyManagerTitle", "replyPhone", "updatedAt")
SELECT gen_random_uuid(), sa."locationId",
  CASE sa.name
    WHEN 'Allfor Care Croydon' THEN ARRAY['Croydon', 'Merton']
    WHEN 'Allfor Care Hammersmith' THEN ARRAY['Hammersmith and Fulham', 'Kensington and Chelsea', 'Wandsworth']
    WHEN 'Allfor Care Harrow' THEN ARRAY['Harrow', 'Brent']
    WHEN 'Allfor Care Hounslow' THEN ARRAY['Hounslow', 'Ealing', 'Hillingdon']
    WHEN 'Allfor Care Doncaster' THEN ARRAY['Doncaster']
    ELSE ARRAY[]::text[]
  END,
  sa."registeredManagers"[1], CASE WHEN sa."registeredManagers"[1] IS NULL THEN NULL ELSE 'Registered Manager' END,
  sa.phone, now()
FROM scheduling."ScheduleArea" sa
WHERE sa."locationId" IS NOT NULL AND sa."deletedAt" IS NULL AND sa.name LIKE 'Allfor Care %'
  AND NOT EXISTS (SELECT 1 FROM service_users."ReferralBranchCoverage" c WHERE c."locationId" = sa."locationId");
