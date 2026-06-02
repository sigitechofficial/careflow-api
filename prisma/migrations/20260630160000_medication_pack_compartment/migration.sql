-- Flow 1 Step 3 — pack tray compartments (time slots) (medication.md §35.5)

CREATE TABLE "service_users"."MedicationPackCompartment" (
    "id" UUID NOT NULL,
    "medicationPackId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "dueTime" VARCHAR(5) NOT NULL,
    "windowStart" VARCHAR(5),
    "windowEnd" VARCHAR(5),
    "lateThresholdMinutes" INTEGER NOT NULL DEFAULT 0,
    "witnessRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MedicationPackCompartment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MedicationPackCompartment_medicationPackId_idx" ON "service_users"."MedicationPackCompartment"("medicationPackId");
CREATE INDEX "MedicationPackCompartment_deletedAt_idx" ON "service_users"."MedicationPackCompartment"("deletedAt");

ALTER TABLE "service_users"."MedicationPackCompartment" ADD CONSTRAINT "MedicationPackCompartment_medicationPackId_fkey" FOREIGN KEY ("medicationPackId") REFERENCES "service_users"."MedicationPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
