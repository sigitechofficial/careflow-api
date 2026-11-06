-- An adopted policy remembers which ready-made (catalogue) policy it came from and which library
-- revision its content is based on, so the organisation can be told when the library is updated.
-- Kept on the document (not in version content), so it survives editing and new versions.

ALTER TABLE "policies"."PolicyDocument" ADD COLUMN "libraryDocumentId" UUID;
ALTER TABLE "policies"."PolicyDocument" ADD COLUMN "libraryRevision" INTEGER;

ALTER TABLE "policies"."PolicyDocument"
  ADD CONSTRAINT "PolicyDocument_libraryDocumentId_fkey"
  FOREIGN KEY ("libraryDocumentId") REFERENCES "policies"."PolicyDocument"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PolicyDocument_libraryDocumentId_idx" ON "policies"."PolicyDocument"("libraryDocumentId");

-- Policies adopted before this release kept the library reference (POL-XX-NNN for LIB-POL-XX-NNN).
UPDATE "policies"."PolicyDocument" d
SET "libraryDocumentId" = c."id",
    "libraryRevision" = 1
FROM "policies"."PolicyDocument" c
WHERE c."isCatalogue" = true
  AND d."isCatalogue" = false
  AND c."reference" = 'LIB-' || d."reference";
