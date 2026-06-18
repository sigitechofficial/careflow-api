-- Recovery for failed 20260715120000_service_user_folder_documents migration.
-- Run after: npx prisma migrate resolve --rolled-back 20260715120000_service_user_folder_documents

DROP TABLE IF EXISTS "service_users"."ServiceUserDocumentRecord";
DROP TABLE IF EXISTS "lookups"."ServiceUserDocumentTypeCatalog";

ALTER TABLE "service_users"."ServiceUserLegalDocument"
  DROP COLUMN IF EXISTS "dnacprStatusConfirmation",
  DROP COLUMN IF EXISTS "dnacprPhysicalLocation",
  DROP COLUMN IF EXISTS "lpaStatusConfirmation";

DROP TYPE IF EXISTS "service_users"."ServiceUserDocumentAccessLevel";
DROP TYPE IF EXISTS "service_users"."ServiceUserDocumentRecordStatus";
DROP TYPE IF EXISTS "service_users"."ServiceUserDnacprStatusConfirmation";
DROP TYPE IF EXISTS "service_users"."ServiceUserLpaStatusConfirmation";
