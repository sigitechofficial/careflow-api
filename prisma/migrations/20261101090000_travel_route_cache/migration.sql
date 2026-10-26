-- Google driving distance and time between two map points, so the rota and visit billing do not ask
-- Google again for the same journey. Additive only.
CREATE TABLE "scheduling"."TravelRouteCache" (
    "id" UUID NOT NULL,
    "originKey" VARCHAR(32) NOT NULL,
    "destinationKey" VARCHAR(32) NOT NULL,
    "meters" INTEGER NOT NULL,
    "seconds" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TravelRouteCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TravelRouteCache_originKey_destinationKey_key" ON "scheduling"."TravelRouteCache"("originKey", "destinationKey");