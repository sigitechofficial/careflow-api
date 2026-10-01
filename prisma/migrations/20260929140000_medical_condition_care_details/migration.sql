-- Current conditions register: care impact, carer guidance, confirmation and IA provenance. Additive only.
ALTER TABLE "service_users"."ServiceUserMedicalCondition"
  ADD COLUMN "impactOnCare" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "carerGuidance" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "confirmationSource" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "sourceSubmissionId" UUID;
