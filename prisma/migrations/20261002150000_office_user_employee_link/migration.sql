-- AlterTable
ALTER TABLE "identity"."User" ADD COLUMN     "employeeId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "identity"."User"("employeeId");
