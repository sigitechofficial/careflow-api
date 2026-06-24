ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "domAutoExtendRotaEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "domRotaHorizonDays" INTEGER NOT NULL DEFAULT 28,
  ADD COLUMN "domRotaHorizonMode" TEXT NOT NULL DEFAULT 'FIXED_DAYS',
  ADD COLUMN "domAutoExtendRotaRunHour" INTEGER NOT NULL DEFAULT 12;
