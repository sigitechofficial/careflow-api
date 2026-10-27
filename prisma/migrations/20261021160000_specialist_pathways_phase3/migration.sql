-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayProfessional" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organisation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpecialistPathwayProfessional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_users"."SpecialistPathwayDocument" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SpecialistPathwayDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialistPathwayProfessional_caseId_idx" ON "service_users"."SpecialistPathwayProfessional"("caseId");

-- CreateIndex
CREATE INDEX "SpecialistPathwayDocument_caseId_idx" ON "service_users"."SpecialistPathwayDocument"("caseId");

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayProfessional" ADD CONSTRAINT "SpecialistPathwayProfessional_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "service_users"."SpecialistPathwayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_users"."SpecialistPathwayDocument" ADD CONSTRAINT "SpecialistPathwayDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "service_users"."SpecialistPathwayCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

