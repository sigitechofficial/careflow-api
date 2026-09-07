-- Carer lone-worker SOS: new exception kind + structured GPS/message context

ALTER TYPE "scheduling"."EcmExceptionKind" ADD VALUE IF NOT EXISTS 'CARER_SOS';

ALTER TABLE "scheduling"."EcmException"
  ADD COLUMN IF NOT EXISTS "context" JSONB;
