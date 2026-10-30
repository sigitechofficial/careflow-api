-- A "total amount" quote: the weekly price of the visits typed by hand.
ALTER TABLE "service_users"."EnquiryQuotationVersion" ADD COLUMN "manualWeeklyTotal" DECIMAL(12,2);
