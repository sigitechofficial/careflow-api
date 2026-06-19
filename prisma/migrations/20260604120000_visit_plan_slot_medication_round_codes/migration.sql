-- Align visit plan slot codes with medication administration round codes (Settings → Time slots).
-- Runs only when VisitPlanSlot already exists (table is created in 20260708120000_service_user_visit_plans).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'service_users'
      AND table_name = 'VisitPlanSlot'
  ) THEN
    ALTER TABLE "service_users"."VisitPlanSlot"
      ALTER COLUMN "slotCode" TYPE TEXT
      USING (
        CASE
          WHEN "medicationRoundCode" IS NOT NULL AND TRIM("medicationRoundCode") <> '' THEN "medicationRoundCode"
          WHEN "slotCode"::text = 'LUNCH' THEN 'MIDDAY'
          WHEN "slotCode"::text = 'TEA' THEN 'AFTERNOON'
          ELSE "slotCode"::text
        END
      );

    DROP TYPE IF EXISTS "service_users"."VisitPlanSlotCode";
  END IF;
END $$;
