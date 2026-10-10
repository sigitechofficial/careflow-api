-- Corrective measures: type, linked records, the findings they address, and the course they created.
ALTER TABLE "incidents"."IncidentAction"
  ADD COLUMN "measureType" VARCHAR(40),
  ADD COLUMN "linkedRecords" JSONB,
  ADD COLUMN "addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "courseRecommendationId" UUID;
ALTER TABLE "incidents"."IncidentAction" ALTER COLUMN "addresses" DROP DEFAULT;

-- Course recommendations made from the Investigate tab become "Course for carer" measures.
INSERT INTO "incidents"."IncidentAction"
  ("id", "incidentId", "title", "description", "priority", "status", "isMandatory", "dueDate",
   "assignedEmployeeId", "measureType", "linkedRecords", "addresses", "courseRecommendationId",
   "createdAt", "updatedAt", "createdById", "updatedById")
SELECT
  gen_random_uuid(),
  r."incidentId",
  LEFT('Course: ' || COALESCE(c."title", 'Course'), 300),
  r."reason",
  'MEDIUM',
  'NOT_STARTED',
  false,
  r."dueAt",
  NULL,
  'COURSE',
  jsonb_build_array(
    jsonb_build_object('id', r."employeeId"::text, 'label', COALESCE(NULLIF(TRIM(COALESCE(p."firstName", '') || ' ' || COALESCE(p."lastName", '')), ''), 'Carer')),
    jsonb_build_object('id', r."courseId"::text, 'label', COALESCE(c."title", 'Course'))
  ),
  ARRAY[]::TEXT[],
  r."id",
  r."recommendedAt",
  r."updatedAt",
  r."createdById",
  r."updatedById"
FROM "incidents"."IncidentCarerCourseRecommendation" r
LEFT JOIN "learning"."LearningCourse" c ON c."id" = r."courseId"
LEFT JOIN "employees"."EmployeePersonalDetail" p ON p."employeeId" = r."employeeId"
WHERE r."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "incidents"."IncidentAction" a WHERE a."courseRecommendationId" = r."id");
