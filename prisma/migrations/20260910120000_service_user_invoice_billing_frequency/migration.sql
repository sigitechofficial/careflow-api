-- Service user invoice cadence (weekly vs monthly invoice runs).
-- BillingFrequency enum already lives in billing schema.

ALTER TABLE "service_users"."ServiceUser"
ADD COLUMN "invoiceBillingFrequency" "billing"."BillingFrequency" NOT NULL DEFAULT 'WEEKLY';
