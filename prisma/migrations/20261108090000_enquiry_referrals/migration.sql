-- Referrals are managed with enquiries: a kind (ENQUIRY / REFERRAL), the referral's details and an Emergency urgency.
CREATE TYPE "service_users"."EnquiryKind" AS ENUM ('ENQUIRY', 'REFERRAL');

ALTER TYPE "service_users"."EnquiryUrgency" ADD VALUE IF NOT EXISTS 'EMERGENCY';

ALTER TABLE "service_users"."Enquiry"
  ADD COLUMN "kind" "service_users"."EnquiryKind" NOT NULL DEFAULT 'ENQUIRY',
  ADD COLUMN "referringOrganisation" TEXT,
  ADD COLUMN "referrerRole" TEXT,
  ADD COLUMN "referralReference" TEXT,
  ADD COLUMN "referralDate" TIMESTAMP(3);

CREATE INDEX "Enquiry_kind_idx" ON "service_users"."Enquiry"("kind");
