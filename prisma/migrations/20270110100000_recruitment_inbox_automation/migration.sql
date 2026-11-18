-- Recruitment inbox settings: automation, rules and copies; what they did to each email.
ALTER TABLE "employees"."RecruitmentInboxSettings"
    ADD COLUMN "autoCreateCandidate" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "autoAcknowledge" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "rules" JSONB,
    ADD COLUMN "notifyTo" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "employees"."RecruitmentEmail"
    ADD COLUMN "automation" JSONB,
    ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
