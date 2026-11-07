-- Staff policy acknowledgements belong to the employee (care workers use the Employee App and have
-- no User row). userId now only records which web user account acted, when there is one.
--
-- 1. employeeId (FK -> Employee, cascade delete) and channel ('WEB' | 'EMPLOYEE_APP').
-- 2. userId becomes nullable; deleting a user keeps the employee's acknowledgement (SET NULL).
-- 3. One acknowledgement row per version and employee.

ALTER TABLE "policies"."PolicyAcknowledgement" ADD COLUMN "employeeId" UUID;
ALTER TABLE "policies"."PolicyAcknowledgement" ADD COLUMN "channel" VARCHAR(20);

-- Nothing wrote PolicyAcknowledgement before this release. Link any stray rows to the employee
-- whose email matches the user, then drop rows that cannot be linked or would be duplicates.
UPDATE "policies"."PolicyAcknowledgement" pa
SET "employeeId" = pd."employeeId",
    "channel" = 'WEB'
FROM "identity"."User" u
JOIN "employees"."EmployeePersonalDetail" pd ON lower(pd."email") = lower(u."email")
WHERE u."id" = pa."userId";

DELETE FROM "policies"."PolicyAcknowledgement" WHERE "employeeId" IS NULL;

DELETE FROM "policies"."PolicyAcknowledgement" a
USING "policies"."PolicyAcknowledgement" b
WHERE a."versionId" = b."versionId"
  AND a."employeeId" = b."employeeId"
  AND (a."updatedAt", a."id") < (b."updatedAt", b."id");

ALTER TABLE "policies"."PolicyAcknowledgement" ALTER COLUMN "employeeId" SET NOT NULL;
ALTER TABLE "policies"."PolicyAcknowledgement" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "policies"."PolicyAcknowledgement" DROP CONSTRAINT "PolicyAcknowledgement_userId_fkey";
ALTER TABLE "policies"."PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "policies"."PolicyAcknowledgement" ADD CONSTRAINT "PolicyAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PolicyAcknowledgement_versionId_employeeId_key" ON "policies"."PolicyAcknowledgement"("versionId", "employeeId");
CREATE INDEX "PolicyAcknowledgement_employeeId_idx" ON "policies"."PolicyAcknowledgement"("employeeId");
