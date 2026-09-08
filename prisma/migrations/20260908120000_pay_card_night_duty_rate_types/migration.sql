-- Pay cards store night-duty rates on BillingRateType (charge cards use BillingChargeMethod).
ALTER TYPE "billing"."BillingRateType" ADD VALUE IF NOT EXISTS 'SLEEP_IN';
ALTER TYPE "billing"."BillingRateType" ADD VALUE IF NOT EXISTS 'WAKING_NIGHT';
