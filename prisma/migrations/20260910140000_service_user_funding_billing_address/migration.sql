-- Billing postal address on each funding line (where invoices are sent).
ALTER TABLE "service_users"."ServiceUserFunding"
  ADD COLUMN IF NOT EXISTS "billingAddressLine1" TEXT,
  ADD COLUMN IF NOT EXISTS "billingAddressLine2" TEXT,
  ADD COLUMN IF NOT EXISTS "billingTown" TEXT,
  ADD COLUMN IF NOT EXISTS "billingCounty" TEXT,
  ADD COLUMN IF NOT EXISTS "billingCountry" TEXT,
  ADD COLUMN IF NOT EXISTS "billingPostcode" TEXT;
