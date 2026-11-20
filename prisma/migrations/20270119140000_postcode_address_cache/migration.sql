-- Address lists per postcode from the address list service, kept 30 days (see PostcodeAddressCache).
CREATE TABLE IF NOT EXISTS platform."PostcodeAddressCache" (
  "postcode"  VARCHAR(10)  NOT NULL,
  "payload"   JSONB        NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PostcodeAddressCache_pkey" PRIMARY KEY ("postcode")
);
CREATE INDEX IF NOT EXISTS "PostcodeAddressCache_fetchedAt_idx" ON platform."PostcodeAddressCache" ("fetchedAt");
