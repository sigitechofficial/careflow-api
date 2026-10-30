-- Quotes are priced by hand: an hourly rate per quote version (additive).
ALTER TABLE "service_users"."EnquiryQuotationVersion" ADD COLUMN "hourlyRate" DECIMAL(10,2);
