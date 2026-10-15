-- A published care plan version can be the evidence for an incident "Care plan update" measure.
ALTER TABLE "service_users"."ServiceUserCarePlanPublishedVersion" ADD COLUMN "incidentActionId" UUID;
CREATE INDEX "ServiceUserCarePlanPublishedVersion_incidentActionId_idx" ON "service_users"."ServiceUserCarePlanPublishedVersion"("incidentActionId");
