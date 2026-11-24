-- Visit Log: who did each action (carer app or office) and which office user.
-- Additive only; existing rows stay NULL and are treated as carer rows.
ALTER TABLE "scheduling"."VisitTimelineEvent" ADD COLUMN IF NOT EXISTS "actorKind" VARCHAR(16);
ALTER TABLE "scheduling"."VisitTimelineEvent" ADD COLUMN IF NOT EXISTS "createdByUserId" UUID;
