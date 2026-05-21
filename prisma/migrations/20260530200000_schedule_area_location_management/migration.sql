ALTER TABLE "scheduling"."ScheduleArea"
  ADD COLUMN "markerColorHex" VARCHAR(16),
  ADD COLUMN "incidentMessageUserIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "incidentEmailUserIds" JSONB NOT NULL DEFAULT '[]';
