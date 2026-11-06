-- Survey library (Surveys -> Ready-made surveys). Ready-made surveys are catalogue rows
-- (isCatalogue = true, always isTemplate = true) owned by CareFlow. An organisation adopts one as
-- its own company-wide template; the template remembers the catalogue survey and the library
-- revision it is based on, so the organisation is told when the library is updated.

ALTER TABLE "surveys"."Survey" ADD COLUMN "isCatalogue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surveys"."Survey" ADD COLUMN "libraryReference" TEXT;
ALTER TABLE "surveys"."Survey" ADD COLUMN "libraryRevision" INTEGER;
ALTER TABLE "surveys"."Survey" ADD COLUMN "librarySourceId" UUID;
ALTER TABLE "surveys"."Survey" ADD COLUMN "libraryMeta" JSONB;

ALTER TABLE "surveys"."Survey"
  ADD CONSTRAINT "Survey_librarySourceId_fkey"
  FOREIGN KEY ("librarySourceId") REFERENCES "surveys"."Survey"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Survey_isCatalogue_idx" ON "surveys"."Survey"("isCatalogue");
CREATE INDEX "Survey_librarySourceId_idx" ON "surveys"."Survey"("librarySourceId");

-- One catalogue survey per library reference (retired ones are revived by the seed, not duplicated).
-- Not expressible in Prisma.
CREATE UNIQUE INDEX "Survey_catalogue_libraryReference_key"
  ON "surveys"."Survey"("libraryReference") WHERE "isCatalogue" = true;

-- Section headings of ready-made surveys survive on their questions.
ALTER TABLE "surveys"."SurveyQuestion" ADD COLUMN "sectionTitle" TEXT;
