-- QBO-style sequential invoice numbers per service-user invoice on a run.

CREATE TABLE "billing"."InvoiceNumberSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastValue" INTEGER NOT NULL DEFAULT 1000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceNumberSequence_pkey" PRIMARY KEY ("id")
);

INSERT INTO "billing"."InvoiceNumberSequence" ("id", "lastValue", "updatedAt")
VALUES (1, 1000, CURRENT_TIMESTAMP);

CREATE TABLE "billing"."InvoiceDocument" (
    "id" UUID NOT NULL,
    "invoiceRunId" UUID NOT NULL,
    "serviceUserId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "sequenceValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceDocument_invoiceNumber_key" ON "billing"."InvoiceDocument"("invoiceNumber");
CREATE UNIQUE INDEX "InvoiceDocument_invoiceRunId_serviceUserId_key" ON "billing"."InvoiceDocument"("invoiceRunId", "serviceUserId");
CREATE INDEX "InvoiceDocument_invoiceRunId_idx" ON "billing"."InvoiceDocument"("invoiceRunId");
CREATE INDEX "InvoiceDocument_serviceUserId_idx" ON "billing"."InvoiceDocument"("serviceUserId");

ALTER TABLE "billing"."InvoiceDocument"
ADD CONSTRAINT "InvoiceDocument_invoiceRunId_fkey"
FOREIGN KEY ("invoiceRunId") REFERENCES "billing"."InvoiceRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
