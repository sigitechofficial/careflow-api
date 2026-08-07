-- T02: HMRC PAYE Online / Gateway credentials on employer settings singleton.
ALTER TABLE "payroll"."PayrollEmployerSettings"
  ADD COLUMN IF NOT EXISTS "activeHmrcEnvironment" TEXT NOT NULL DEFAULT 'TEST',
  ADD COLUMN IF NOT EXISTS "gatewayTestUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayTestPasswordEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayLiveUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayLivePasswordEnc" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayCredentialsUpdatedAt" TIMESTAMP(3);
