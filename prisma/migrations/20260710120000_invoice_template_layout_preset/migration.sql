-- Invoice template layout presets (standard / LA / NHS / private — Birdie, Nourish, Access style)
CREATE TYPE "billing"."InvoiceTemplateLayoutPreset" AS ENUM (
  'STANDARD',
  'LOCAL_AUTHORITY',
  'NHS',
  'PRIVATE_CLIENT'
);

ALTER TABLE "billing"."InvoiceTemplate"
  ADD COLUMN "layoutPreset" "billing"."InvoiceTemplateLayoutPreset" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "includeRemittance" BOOLEAN NOT NULL DEFAULT false;
