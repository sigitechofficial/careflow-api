-- Org-level carer-app check-in methods (GPS / Manual / NFC / QR).
ALTER TABLE "identity"."OrganisationGeneralSettings"
  ADD COLUMN "domCheckInGpsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "domCheckInManualEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "domCheckInNfcEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "domCheckInQrEnabled" BOOLEAN NOT NULL DEFAULT false;
