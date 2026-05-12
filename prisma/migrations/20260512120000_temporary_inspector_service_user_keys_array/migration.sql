-- AlterTable: replace single optional key with array (empty = all service users)
ALTER TABLE "employees"."TemporaryInspector" ADD COLUMN "serviceUserKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "employees"."TemporaryInspector"
SET "serviceUserKeys" = ARRAY["serviceUserKey"]
WHERE "serviceUserKey" IS NOT NULL;

ALTER TABLE "employees"."TemporaryInspector" DROP COLUMN "serviceUserKey";
