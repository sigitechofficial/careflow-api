-- Survey roadmap Phase 2, part 4: outside people (families, professionals, commissioners).
-- See src/surveys/survey-outside-people.service.ts.

-- One outside person a survey can go to (the "real person" for the 4-week rule): typed in once, or taken from a
-- record CareFlow already keeps (People involved on a person's record, a funder, a pathway professional), in which
-- case the record's details are read again at each send. kind: FAMILY | PROFESSIONAL | COMMISSIONER | OTHER.
CREATE TABLE IF NOT EXISTS "surveys"."SurveyExternalContact" (
  "id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organisation" TEXT,
  "role" TEXT,
  "email" TEXT,
  "mobile" TEXT,
  "phone" TEXT,
  "sourceType" TEXT NOT NULL DEFAULT 'TYPED',
  "sourceId" UUID,
  "serviceUserId" UUID,
  "locationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SurveyExternalContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyExternalContact_source_key" ON "surveys"."SurveyExternalContact"("sourceType", "sourceId") WHERE "sourceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "SurveyExternalContact_kind_idx" ON "surveys"."SurveyExternalContact"("kind");
CREATE INDEX IF NOT EXISTS "SurveyExternalContact_serviceUserId_idx" ON "surveys"."SurveyExternalContact"("serviceUserId");
CREATE INDEX IF NOT EXISTS "SurveyExternalContact_deletedAt_idx" ON "surveys"."SurveyExternalContact"("deletedAt");

-- Reusable lists of outside people (e.g. "GP practices", "Commissioners").
CREATE TABLE IF NOT EXISTS "surveys"."SurveyContactList" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "locationIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "createdById" UUID,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SurveyContactList_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "surveys"."SurveyContactListMember" (
  "listId" UUID NOT NULL,
  "contactId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SurveyContactListMember_pkey" PRIMARY KEY ("listId", "contactId"),
  CONSTRAINT "SurveyContactListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "surveys"."SurveyContactList"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SurveyContactListMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "surveys"."SurveyExternalContact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SurveyContactListMember_contactId_idx" ON "surveys"."SurveyContactListMember"("contactId");

-- A named outside person sent a survey with their own link (public surveys that are not anonymous).
ALTER TABLE "surveys"."SurveyRecipient" ADD COLUMN IF NOT EXISTS "externalContactId" UUID;
DO $$ BEGIN
  ALTER TABLE "surveys"."SurveyRecipient" ADD CONSTRAINT "SurveyRecipient_externalContactId_fkey" FOREIGN KEY ("externalContactId") REFERENCES "surveys"."SurveyExternalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyRecipient_surveyId_externalContactId_key" ON "surveys"."SurveyRecipient"("surveyId", "externalContactId") WHERE "externalContactId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "SurveyRecipient_externalContactId_sentAt_idx" ON "surveys"."SurveyRecipient"("externalContactId", "sentAt");

-- A survey about one person we support (a family's or GP's views on that person's care): found from their record.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "aboutServiceUserId" UUID;
CREATE INDEX IF NOT EXISTS "Survey_aboutServiceUserId_idx" ON "surveys"."Survey"("aboutServiceUserId");

-- Named answers recorded as given by a family member or representative chosen from People involved: that
-- contact (their own survey contact, decision P10). Never set on an answer that is not linked to anyone.
ALTER TABLE "surveys"."SurveyResponse" ADD COLUMN IF NOT EXISTS "respondentContactId" UUID;
CREATE INDEX IF NOT EXISTS "SurveyResponse_respondentContactId_idx" ON "surveys"."SurveyResponse"("respondentContactId");
