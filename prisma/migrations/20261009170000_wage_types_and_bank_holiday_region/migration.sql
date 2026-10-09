-- AlterTable
ALTER TABLE "billing"."PayCard" ADD COLUMN     "bankHolidayRegion" TEXT;

-- CreateTable
CREATE TABLE "billing"."WageType" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "allowedMethods" TEXT[],
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "WageType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WageType_code_key" ON "billing"."WageType"("code");


-- System wage type catalogue (idempotent). Names/descriptions are editable later; codes are protected.
INSERT INTO "billing"."WageType" ("id", "code", "name", "category", "unit", "allowedMethods", "description", "isSystem", "isActive", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'BASIC_HOURLY', 'Basic hourly pay', 'STANDARD', 'HOUR', ARRAY['HOURLY_RATE'], 'Standard care visit hourly rate, paid on approved payable minutes.', true, true, 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FIXED_SALARY', 'Fixed salary', 'STANDARD', 'MONTH', ARRAY['FIXED_PER_MONTH','ANNUAL_SALARY'], 'Monthly or annual salary (configured on the carer''s UK payroll pay agreement).', true, true, 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PER_VISIT', 'Per visit pay', 'STANDARD', 'VISIT', ARRAY['FIXED_PER_VISIT'], 'Fixed amount per eligible visit length. Minimum wage compliance still applies.', true, true, 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'WEEKEND', 'Weekend pay', 'ENHANCED', 'HOUR', ARRAY['HOURLY_RATE','RATE_MULTIPLIER'], 'Saturday and Sunday rates (separate or shared).', true, true, 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BANK_HOLIDAY', 'Bank holiday pay', 'ENHANCED', 'HOUR', ARRAY['HOURLY_RATE','RATE_MULTIPLIER'], 'Enhanced rate on bank holidays from the pay card''s nation calendar.', true, true, 50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'NIGHT_SHIFT', 'Night shift pay', 'ENHANCED', 'HOUR', ARRAY['HOURLY_RATE','RATE_MULTIPLIER'], 'Night time-band rate (e.g. 22:00–06:00), including shifts crossing midnight.', true, true, 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OVERTIME', 'Overtime pay', 'ENHANCED', 'HOUR', ARRAY['HOURLY_RATE','RATE_MULTIPLIER'], 'Hours above a weekly or pay-period threshold.', true, true, 70, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TRAVEL_TIME', 'Travel time pay', 'TRAVEL', 'HOUR', ARRAY['HOURLY_RATE'], 'Approved travel between care assignments (not home-to-work commuting).', true, true, 80, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MILEAGE', 'Mileage allowance', 'TRAVEL', 'MILE', ARRAY['PER_MILE'], 'Per-mile reimbursement of approved business miles; kept separate from taxable wages.', true, true, 90, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SLEEP_IN', 'Sleep-in allowance', 'SPECIALIST', 'SHIFT', ARRAY['FIXED_PER_SHIFT'], 'Fixed payment per qualifying sleep-in shift.', true, true, 100, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'WAKING_NIGHT', 'Waking night pay', 'SPECIALIST', 'HOUR', ARRAY['HOURLY_RATE'], 'Hourly active-duty night shift.', true, true, 110, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LIVE_IN', 'Live-in care pay', 'SPECIALIST', 'DAY', ARRAY['FIXED_PER_DAY','FIXED_PER_WEEK'], 'Daily or weekly live-in arrangement.', true, true, 120, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ON_CALL', 'On-call allowance', 'ADDITIONAL', 'SHIFT', ARRAY['FIXED_PER_SHIFT'], 'Fixed amount per agreed on-call period; calls worked recorded separately.', true, true, 130, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TRAINING', 'Training pay', 'ADDITIONAL', 'HOUR', ARRAY['HOURLY_RATE','FIXED_AMOUNT'], 'Approved training attendance (hourly or fixed).', true, true, 140, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HOLIDAY_PAY', 'Holiday pay', 'ADDITIONAL', 'AMOUNT', ARRAY['STATUTORY_CALCULATION'], 'Statutory or contractual holiday pay from leave records.', true, true, 150, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SICK_PAY', 'Sick pay', 'ADDITIONAL', 'AMOUNT', ARRAY['STATUTORY_CALCULATION'], 'Statutory or contractual sick pay from absence records.', true, true, 160, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BONUS', 'Bonus / incentive', 'ADDITIONAL', 'AMOUNT', ARRAY['FIXED_AMOUNT'], 'Fixed or variable amount with reason, period and approval.', true, true, 170, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MANUAL_ADJUSTMENT', 'Manual pay adjustment', 'ADDITIONAL', 'AMOUNT', ARRAY['FIXED_AMOUNT'], 'Positive or negative adjustment with mandatory reason and audit trail.', true, true, 180, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
