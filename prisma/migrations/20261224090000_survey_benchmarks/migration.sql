-- Anonymised sector benchmarks (Phase 3). An agency opts in under a data-sharing agreement and shares, per
-- ready-made question, only a whole-per-cent positive share and a size band (src/surveys/survey-benchmark.util.ts).

-- This agency's choice (one row, id 'default').
CREATE TABLE "surveys"."SurveyBenchmarkSetting" (
    "id" TEXT NOT NULL,
    "sharing" BOOLEAN NOT NULL DEFAULT false,
    "agreementVersion" TEXT,
    "agreedById" UUID,
    "agreedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyBenchmarkSetting_pkey" PRIMARY KEY ("id")
);

-- Sector figures received from the benchmark service (only while sharing).
CREATE TABLE "surveys"."SurveyBenchmarkFigure" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "organisations" INTEGER NOT NULL,
    "median" INTEGER NOT NULL,
    "lowerQuartile" INTEGER NOT NULL,
    "upperQuartile" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SurveyBenchmarkFigure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyBenchmarkFigure_reference_questionKey_key" ON "surveys"."SurveyBenchmarkFigure"("reference", "questionKey");

-- The benchmark service's side: each agency's current figures, by a hash of its key (never its name).
CREATE TABLE "surveys"."SurveyBenchmarkContribution" (
    "id" UUID NOT NULL,
    "contributorHash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SurveyBenchmarkContribution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SurveyBenchmarkContribution_contributorHash_reference_questionKey_key" ON "surveys"."SurveyBenchmarkContribution"("contributorHash", "reference", "questionKey");
CREATE INDEX "SurveyBenchmarkContribution_reference_questionKey_idx" ON "surveys"."SurveyBenchmarkContribution"("reference", "questionKey");
