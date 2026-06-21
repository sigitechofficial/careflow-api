-- Bank holidays for visit plan generate skip
CREATE TABLE IF NOT EXISTS "lookups"."BankHoliday" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "holidayDate" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "region" TEXT NOT NULL DEFAULT 'UK',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BankHoliday_holidayDate_region_key" ON "lookups"."BankHoliday"("holidayDate", "region");
CREATE INDEX IF NOT EXISTS "BankHoliday_holidayDate_idx" ON "lookups"."BankHoliday"("holidayDate");

-- UK bank holidays 2026 (sample seed)
INSERT INTO "lookups"."BankHoliday" ("holidayDate", "name", "region")
VALUES
  ('2026-01-01', 'New Year''s Day', 'UK'),
  ('2026-04-03', 'Good Friday', 'UK'),
  ('2026-04-06', 'Easter Monday', 'UK'),
  ('2026-05-04', 'Early May bank holiday', 'UK'),
  ('2026-05-25', 'Spring bank holiday', 'UK'),
  ('2026-08-31', 'Summer bank holiday', 'UK'),
  ('2026-12-25', 'Christmas Day', 'UK'),
  ('2026-12-28', 'Boxing Day (substitute)', 'UK')
ON CONFLICT ("holidayDate", "region") DO NOTHING;
