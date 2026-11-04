-- Additive: assessment forms an organisation requires for a care plan form.
-- No existing table or row is changed.

-- CreateTable
CREATE TABLE "care_pathway"."CarePlanRequiredAssessment" (
    "id" UUID NOT NULL,
    "carePlanFormId" UUID NOT NULL,
    "assessmentFormId" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarePlanRequiredAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarePlanRequiredAssessment_assessmentFormId_idx" ON "care_pathway"."CarePlanRequiredAssessment"("assessmentFormId");

-- CreateIndex
CREATE UNIQUE INDEX "CarePlanRequiredAssessment_carePlanFormId_assessmentFormId_key" ON "care_pathway"."CarePlanRequiredAssessment"("carePlanFormId", "assessmentFormId");

-- AddForeignKey
ALTER TABLE "care_pathway"."CarePlanRequiredAssessment" ADD CONSTRAINT "CarePlanRequiredAssessment_carePlanFormId_fkey" FOREIGN KEY ("carePlanFormId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_pathway"."CarePlanRequiredAssessment" ADD CONSTRAINT "CarePlanRequiredAssessment_assessmentFormId_fkey" FOREIGN KEY ("assessmentFormId") REFERENCES "care_pathway"."CarePathwayForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
