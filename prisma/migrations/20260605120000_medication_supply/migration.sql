-- Medication supply profiles and deliveries (§8.9–8.10)

CREATE TYPE "service_users"."MedicationSupplyModel" AS ENUM ('BLISTER_CYCLE', 'BOTTLE_28DAY', 'PRESCRIPTION_QTY');

CREATE TABLE "service_users"."MedicationSupplyProfile" (
    "id" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "supplyModel" "service_users"."MedicationSupplyModel" NOT NULL,
    "cycleDays" INTEGER DEFAULT 28,
    "bottleDiscardDays" INTEGER DEFAULT 28,
    "defaultQty" INTEGER,
    "qtyUnit" VARCHAR(20),
    "pharmacyName" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "MedicationSupplyProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MedicationSupplyProfile_serviceUserMedicationId_key" ON "service_users"."MedicationSupplyProfile"("serviceUserMedicationId");
CREATE INDEX "MedicationSupplyProfile_deletedAt_idx" ON "service_users"."MedicationSupplyProfile"("deletedAt");

ALTER TABLE "service_users"."MedicationSupplyProfile" ADD CONSTRAINT "MedicationSupplyProfile_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."MedicationSupplyDelivery" (
    "id" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "serviceUserMedicationId" UUID NOT NULL,
    "supplyProfileId" UUID,
    "deliveredAt" DATE NOT NULL,
    "cycleEndDate" DATE,
    "openedAt" DATE,
    "expiresAt" DATE,
    "runsOutDate" DATE,
    "quantity" INTEGER,
    "pharmacyName" TEXT,
    "receivedById" UUID,
    "witnessById" UUID,
    "notes" TEXT,
    "source" VARCHAR(32),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "MedicationSupplyDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationSupplyDelivery_serviceUserId_idx" ON "service_users"."MedicationSupplyDelivery"("serviceUserId");
CREATE INDEX "MedicationSupplyDelivery_serviceUserMedicationId_idx" ON "service_users"."MedicationSupplyDelivery"("serviceUserMedicationId");
CREATE INDEX "MedicationSupplyDelivery_deliveredAt_idx" ON "service_users"."MedicationSupplyDelivery"("deliveredAt");
CREATE INDEX "MedicationSupplyDelivery_deletedAt_idx" ON "service_users"."MedicationSupplyDelivery"("deletedAt");

ALTER TABLE "service_users"."MedicationSupplyDelivery" ADD CONSTRAINT "MedicationSupplyDelivery_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES "service_users"."ServiceUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."MedicationSupplyDelivery" ADD CONSTRAINT "MedicationSupplyDelivery_serviceUserMedicationId_fkey" FOREIGN KEY ("serviceUserMedicationId") REFERENCES "service_users"."ServiceUserMedication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_users"."MedicationSupplyDelivery" ADD CONSTRAINT "MedicationSupplyDelivery_supplyProfileId_fkey" FOREIGN KEY ("supplyProfileId") REFERENCES "service_users"."MedicationSupplyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."MedicationSupplyDelivery" ADD CONSTRAINT "MedicationSupplyDelivery_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."MedicationSupplyDelivery" ADD CONSTRAINT "MedicationSupplyDelivery_witnessById_fkey" FOREIGN KEY ("witnessById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_users"."MedicationSupplyDelivery" ADD CONSTRAINT "MedicationSupplyDelivery_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "identity"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
