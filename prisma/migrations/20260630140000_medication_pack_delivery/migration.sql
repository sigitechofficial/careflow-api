-- Flow 2 — pack cycle delivery + contents reconciliation (medication.md §35.4)

CREATE TYPE "service_users"."MedicationPackDeliveryStatus" AS ENUM ('PENDING', 'RECONCILED', 'FLAGGED', 'VERIFIED');
CREATE TYPE "service_users"."MedicationPackCondition" AS ENUM ('INTACT', 'DAMAGED');
CREATE TYPE "service_users"."MedicationPackDeliveryLineState" AS ENUM ('PENDING', 'MATCHED', 'MISSING', 'DISCREPANCY');

CREATE TABLE "service_users"."MedicationPackDelivery" (
    "id" UUID NOT NULL,
    "medicationPackId" UUID NOT NULL,
    "contentsSnapshotId" UUID,
    "cycleNumber" INTEGER NOT NULL,
    "status" "service_users"."MedicationPackDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receivedById" UUID,
    "deliveredBy" TEXT,
    "batchReference" TEXT,
    "condition" "service_users"."MedicationPackCondition" NOT NULL DEFAULT 'INTACT',
    "conditionNotes" TEXT,
    "countersignedAt" TIMESTAMP(3),
    "countersignedById" UUID,
    "countersignNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "MedicationPackDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationPackDelivery_medicationPackId_idx" ON "service_users"."MedicationPackDelivery"("medicationPackId");
CREATE INDEX "MedicationPackDelivery_status_idx" ON "service_users"."MedicationPackDelivery"("status");
CREATE INDEX "MedicationPackDelivery_deletedAt_idx" ON "service_users"."MedicationPackDelivery"("deletedAt");

ALTER TABLE "service_users"."MedicationPackDelivery" ADD CONSTRAINT "MedicationPackDelivery_medicationPackId_fkey" FOREIGN KEY ("medicationPackId") REFERENCES "service_users"."MedicationPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_users"."MedicationPackDeliveryLine" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "serviceUserMedicationId" UUID,
    "medicationName" TEXT NOT NULL,
    "strength" TEXT,
    "dose" TEXT,
    "expectedOnSnapshot" BOOLEAN NOT NULL DEFAULT true,
    "state" "service_users"."MedicationPackDeliveryLineState" NOT NULL DEFAULT 'PENDING',
    "confirmedPresent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicationPackDeliveryLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationPackDeliveryLine_deliveryId_idx" ON "service_users"."MedicationPackDeliveryLine"("deliveryId");

ALTER TABLE "service_users"."MedicationPackDeliveryLine" ADD CONSTRAINT "MedicationPackDeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "service_users"."MedicationPackDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
