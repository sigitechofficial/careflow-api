-- Azure Pricing (platform costs): read-only mirror of Azure Cost Management, Retail Prices,
-- Consumption budgets and Advisor for the Careflow subscription. Additive only: new "platform" schema.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "platform";

-- CreateTable
CREATE TABLE "platform"."AzureCostDaily" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "resourceGroup" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "meterCategory" TEXT NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AzureCostDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."AzureRetailPrice" (
    "id" UUID NOT NULL,
    "priceKey" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "skuId" TEXT,
    "serviceName" TEXT NOT NULL,
    "serviceFamily" TEXT,
    "productName" TEXT NOT NULL,
    "skuName" TEXT NOT NULL,
    "armSkuName" TEXT,
    "meterName" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,10) NOT NULL,
    "retailPrice" DECIMAL(20,10) NOT NULL,
    "tierMinimumUnits" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "armRegionName" TEXT NOT NULL,
    "location" TEXT,
    "type" TEXT NOT NULL,
    "isPrimaryMeterRegion" BOOLEAN,
    "effectiveStartDate" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AzureRetailPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."AzureBudgetSnapshot" (
    "id" UUID NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "timeGrain" TEXT NOT NULL,
    "currentSpend" DECIMAL(18,6) NOT NULL,
    "forecastSpend" DECIMAL(18,6),
    "currency" TEXT NOT NULL,
    "thresholds" JSONB NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AzureBudgetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."AzureForecastSnapshot" (
    "id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "actualToDate" DECIMAL(18,6) NOT NULL,
    "forecastTotal" DECIMAL(18,6) NOT NULL,
    "source" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AzureForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."AzureAdvisorRecommendation" (
    "id" UUID NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceName" TEXT,
    "annualSavings" DECIMAL(18,2),
    "currency" TEXT,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AzureAdvisorRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."AzureCostAnomaly" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,
    "baseline" DECIMAL(18,6) NOT NULL,
    "increasePercent" DECIMAL(12,2) NOT NULL,
    "topDriver" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AzureCostAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."AzureSyncRun" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggeredById" UUID,

    CONSTRAINT "AzureSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform"."PlatformCostSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "anomalyThresholdPercent" INTEGER NOT NULL DEFAULT 50,
    "anomalyMinDailyIncrease" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "monthlyReportEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyReportRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastMonthlyReportPeriod" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCostSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AzureCostDaily_date_idx" ON "platform"."AzureCostDaily"("date");

-- CreateIndex
CREATE INDEX "AzureCostDaily_serviceName_date_idx" ON "platform"."AzureCostDaily"("serviceName", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AzureCostDaily_date_resourceGroup_serviceName_resourceId_me_key" ON "platform"."AzureCostDaily"("date", "resourceGroup", "serviceName", "resourceId", "meterCategory");

-- CreateIndex
CREATE UNIQUE INDEX "AzureRetailPrice_priceKey_key" ON "platform"."AzureRetailPrice"("priceKey");

-- CreateIndex
CREATE INDEX "AzureRetailPrice_serviceName_idx" ON "platform"."AzureRetailPrice"("serviceName");

-- CreateIndex
CREATE INDEX "AzureRetailPrice_currency_armRegionName_idx" ON "platform"."AzureRetailPrice"("currency", "armRegionName");

-- CreateIndex
CREATE INDEX "AzureBudgetSnapshot_capturedAt_idx" ON "platform"."AzureBudgetSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "AzureBudgetSnapshot_name_capturedAt_idx" ON "platform"."AzureBudgetSnapshot"("name", "capturedAt");

-- CreateIndex
CREATE INDEX "AzureForecastSnapshot_month_capturedAt_idx" ON "platform"."AzureForecastSnapshot"("month", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AzureAdvisorRecommendation_recommendationId_key" ON "platform"."AzureAdvisorRecommendation"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "AzureCostAnomaly_date_key" ON "platform"."AzureCostAnomaly"("date");

-- CreateIndex
CREATE INDEX "AzureCostAnomaly_status_date_idx" ON "platform"."AzureCostAnomaly"("status", "date");

-- CreateIndex
CREATE INDEX "AzureSyncRun_startedAt_idx" ON "platform"."AzureSyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "AzureSyncRun_kind_status_startedAt_idx" ON "platform"."AzureSyncRun"("kind", "status", "startedAt");

-- CreateIndex
CREATE INDEX "AzureSyncRun_trigger_startedAt_idx" ON "platform"."AzureSyncRun"("trigger", "startedAt");

