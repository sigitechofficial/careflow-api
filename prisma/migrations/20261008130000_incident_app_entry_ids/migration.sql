-- Carer-app incidents reported outside a visit have no visit blob, so the register row keeps the
-- app's entry id (for edits and offline retries) and the last applied write key (replays).
ALTER TABLE "incidents"."Incident" ADD COLUMN "appClientEntryId" TEXT;
ALTER TABLE "incidents"."Incident" ADD COLUMN "appLastWriteKey" TEXT;
CREATE UNIQUE INDEX "Incident_appClientEntryId_key" ON "incidents"."Incident"("appClientEntryId");
