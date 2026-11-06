-- Independent survey reviewers (SUR-CQC-001/002) are ordinary user accounts with only the
-- "Independent reviewer" role (no permissions of its own, no branch), never Temporary Inspector
-- logins: those can open service users' care records and exist for CQC and local authority visits.
-- A grant now names the user. No real grants exist yet, so any left are removed rather than moved.
DELETE FROM "surveys"."SurveyReviewerGrant";

ALTER TABLE "surveys"."SurveyReviewerGrant" DROP CONSTRAINT IF EXISTS "SurveyReviewerGrant_inspectorId_fkey";
DROP INDEX IF EXISTS "surveys"."SurveyReviewerGrant_inspectorId_idx";
ALTER TABLE "surveys"."SurveyReviewerGrant" DROP COLUMN IF EXISTS "inspectorId";

ALTER TABLE "surveys"."SurveyReviewerGrant" ADD COLUMN IF NOT EXISTS "userId" UUID NOT NULL;
CREATE INDEX IF NOT EXISTS "SurveyReviewerGrant_userId_idx" ON "surveys"."SurveyReviewerGrant"("userId");
ALTER TABLE "surveys"."SurveyReviewerGrant"
    ADD CONSTRAINT "SurveyReviewerGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The role itself: a system role with no permissions (also kept by prisma/seed.ts).
INSERT INTO "identity"."Role" ("id", "name", "description", "isActive", "createdAt", "updatedAt")
VALUES (
    gen_random_uuid(),
    'Independent reviewer',
    'Records survey answers only on the surveys a manager grants, for a set time (SUR-CQC-001/002). No other access, no branch. Never give it to staff.',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
