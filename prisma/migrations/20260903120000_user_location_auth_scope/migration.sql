-- Authorization branch membership for office users (Approach A org scope).
-- Non-destructive: additive table only; existing users keep prior access until scoped.

CREATE TABLE "identity"."UserLocation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserLocation_userId_locationId_key"
ON "identity"."UserLocation"("userId", "locationId");

CREATE INDEX "UserLocation_userId_idx"
ON "identity"."UserLocation"("userId");

CREATE INDEX "UserLocation_locationId_idx"
ON "identity"."UserLocation"("locationId");

ALTER TABLE "identity"."UserLocation"
ADD CONSTRAINT "UserLocation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "identity"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "identity"."UserLocation"
ADD CONSTRAINT "UserLocation_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "lookups"."Location"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
