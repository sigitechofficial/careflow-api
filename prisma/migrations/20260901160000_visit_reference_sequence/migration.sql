-- Per branch + day sequence for VIS-[BRANCH]-[YYYYMMDD]-[NNNN] visit references
CREATE TABLE "billing"."VisitReferenceSequence" (
    "branchCode" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitReferenceSequence_pkey" PRIMARY KEY ("branchCode","dayKey")
);
