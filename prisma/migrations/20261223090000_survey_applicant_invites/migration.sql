-- Job applicants invited to an anonymous public survey with one-time links (Phase 3).
-- The link's token is kept only as a hash and is never linked to the applicant; the applicant is
-- recorded only as invited (never twice), never with their link or whether they answered.

ALTER TABLE "surveys"."Survey" ADD COLUMN "applicantInvitesFrom" TIMESTAMP(3);

CREATE TABLE "surveys"."SurveyApplicantInvite" (
    "id" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "SurveyApplicantInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyApplicantInvite_tokenHash_key" ON "surveys"."SurveyApplicantInvite"("tokenHash");
CREATE INDEX "SurveyApplicantInvite_surveyId_idx" ON "surveys"."SurveyApplicantInvite"("surveyId");
ALTER TABLE "surveys"."SurveyApplicantInvite"
    ADD CONSTRAINT "SurveyApplicantInvite_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "surveys"."SurveyApplicantInvited" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "surveyId" UUID NOT NULL,
    "invitedOn" DATE NOT NULL,
    CONSTRAINT "SurveyApplicantInvited_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyApplicantInvited_candidateId_key" ON "surveys"."SurveyApplicantInvited"("candidateId");
CREATE INDEX "SurveyApplicantInvited_surveyId_idx" ON "surveys"."SurveyApplicantInvited"("surveyId");
ALTER TABLE "surveys"."SurveyApplicantInvited"
    ADD CONSTRAINT "SurveyApplicantInvited_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"."Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
