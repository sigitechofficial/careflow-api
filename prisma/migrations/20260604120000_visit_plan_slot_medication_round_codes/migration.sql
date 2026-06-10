-- Align visit plan slot codes with medication administration round codes (Settings → Time slots).

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

DROP TYPE "service_users"."VisitPlanSlotCode";
