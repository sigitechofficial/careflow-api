CREATE TYPE "identity"."DateDisplayFormat" AS ENUM ('DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD');

ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "dateDisplayFormat" "identity"."DateDisplayFormat" NOT NULL DEFAULT 'DD_MM_YYYY';
