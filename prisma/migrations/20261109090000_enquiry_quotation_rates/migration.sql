-- Other rates typed on a quote (short visits, weekend, bank holiday, sleeping and waking nights).
ALTER TABLE "service_users"."EnquiryQuotationVersion" ADD COLUMN "rates" JSONB;
