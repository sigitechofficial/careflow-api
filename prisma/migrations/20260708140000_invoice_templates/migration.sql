-- Invoice templates (Step 2 — funder export profiles, field mappings, defaults)

CREATE TYPE "billing"."InvoiceTemplateType" AS ENUM ('PDF', 'XLSX', 'CSV', 'XML', 'JSON', 'API');
CREATE TYPE "billing"."InvoiceTemplateScope" AS ENUM ('ORGANISATION_DEFAULT', 'FUNDER', 'FUNDING_CONTRACT');

CREATE TABLE "billing"."InvoiceTemplate" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "templateType" "billing"."InvoiceTemplateType" NOT NULL,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "scope" "billing"."InvoiceTemplateScope" NOT NULL DEFAULT 'FUNDER',
  "funderId" UUID,
  "serviceUserFundingId" UUID,
  "deliveryMethod" TEXT,
  "groupingRule" TEXT,
  "fileNamePattern" TEXT,
  "billingFrequency" "billing"."BillingFrequency" NOT NULL DEFAULT 'WEEKLY',
  "status" "billing"."BillingCardStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdById" UUID,
  "updatedById" UUID,

  CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceTemplate_code_key" ON "billing"."InvoiceTemplate"("code");
CREATE INDEX "InvoiceTemplate_deletedAt_idx" ON "billing"."InvoiceTemplate"("deletedAt");
CREATE INDEX "InvoiceTemplate_status_idx" ON "billing"."InvoiceTemplate"("status");
CREATE INDEX "InvoiceTemplate_funderId_idx" ON "billing"."InvoiceTemplate"("funderId");
CREATE INDEX "InvoiceTemplate_serviceUserFundingId_idx" ON "billing"."InvoiceTemplate"("serviceUserFundingId");
CREATE INDEX "InvoiceTemplate_scope_idx" ON "billing"."InvoiceTemplate"("scope");

ALTER TABLE "billing"."InvoiceTemplate"
  ADD CONSTRAINT "InvoiceTemplate_funderId_fkey"
  FOREIGN KEY ("funderId") REFERENCES "service_users"."Funder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing"."InvoiceTemplate"
  ADD CONSTRAINT "InvoiceTemplate_serviceUserFundingId_fkey"
  FOREIGN KEY ("serviceUserFundingId") REFERENCES "service_users"."ServiceUserFunding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "billing"."InvoiceTemplateField" (
  "id" UUID NOT NULL,
  "invoiceTemplateId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "systemFieldKey" TEXT NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "InvoiceTemplateField_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceTemplateField_invoiceTemplateId_idx" ON "billing"."InvoiceTemplateField"("invoiceTemplateId");

ALTER TABLE "billing"."InvoiceTemplateField"
  ADD CONSTRAINT "InvoiceTemplateField_invoiceTemplateId_fkey"
  FOREIGN KEY ("invoiceTemplateId") REFERENCES "billing"."InvoiceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_users"."Funder"
  ADD COLUMN "defaultInvoiceTemplateId" UUID;

CREATE INDEX "Funder_defaultInvoiceTemplateId_idx" ON "service_users"."Funder"("defaultInvoiceTemplateId");

ALTER TABLE "service_users"."Funder"
  ADD CONSTRAINT "Funder_defaultInvoiceTemplateId_fkey"
  FOREIGN KEY ("defaultInvoiceTemplateId") REFERENCES "billing"."InvoiceTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_users"."ServiceUserFunding"
  ADD COLUMN "defaultInvoiceTemplateId" UUID;

CREATE INDEX "ServiceUserFunding_defaultInvoiceTemplateId_idx" ON "service_users"."ServiceUserFunding"("defaultInvoiceTemplateId");

ALTER TABLE "service_users"."ServiceUserFunding"
  ADD CONSTRAINT "ServiceUserFunding_defaultInvoiceTemplateId_fkey"
  FOREIGN KEY ("defaultInvoiceTemplateId") REFERENCES "billing"."InvoiceTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
