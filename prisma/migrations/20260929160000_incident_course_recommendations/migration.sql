-- CreateTable: course recommendations after investigation
CREATE TABLE "incidents"."IncidentCarerCourseRecommendation" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "learningAssignmentId" UUID,
    "reason" TEXT,
    "dueAt" TIMESTAMP(3),
    "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentCarerCourseRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncidentCarerCourseRecommendation_incidentId_employeeId_courseId_key"
  ON "incidents"."IncidentCarerCourseRecommendation"("incidentId", "employeeId", "courseId");

CREATE INDEX "IncidentCarerCourseRecommendation_incidentId_idx"
  ON "incidents"."IncidentCarerCourseRecommendation"("incidentId");

CREATE INDEX "IncidentCarerCourseRecommendation_employeeId_idx"
  ON "incidents"."IncidentCarerCourseRecommendation"("employeeId");

CREATE INDEX "IncidentCarerCourseRecommendation_courseId_idx"
  ON "incidents"."IncidentCarerCourseRecommendation"("courseId");

CREATE INDEX "IncidentCarerCourseRecommendation_learningAssignmentId_idx"
  ON "incidents"."IncidentCarerCourseRecommendation"("learningAssignmentId");

CREATE INDEX "IncidentCarerCourseRecommendation_deletedAt_idx"
  ON "incidents"."IncidentCarerCourseRecommendation"("deletedAt");

ALTER TABLE "incidents"."IncidentCarerCourseRecommendation"
  ADD CONSTRAINT "IncidentCarerCourseRecommendation_incidentId_fkey"
  FOREIGN KEY ("incidentId") REFERENCES "incidents"."Incident"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
