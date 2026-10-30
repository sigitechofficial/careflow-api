-- What the client copy of a quote shows: every visit with times and prices, or only the total and visits by time of day.
CREATE TYPE "service_users"."EnquiryQuoteClientLayout" AS ENUM ('DETAILED', 'SUMMARY');
ALTER TABLE "service_users"."EnquiryQuotationVersion" ADD COLUMN "clientLayout" "service_users"."EnquiryQuoteClientLayout" NOT NULL DEFAULT 'DETAILED';
