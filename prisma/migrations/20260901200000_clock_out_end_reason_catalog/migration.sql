-- Org-configurable early / late clock-out end reasons (admin Settings).
-- Label-only — no catalog codes. Empty table until office adds reasons.

CREATE TABLE "scheduling"."VisitClockOutEndReasonCatalog" (
    "id" UUID NOT NULL,
    "kind" "scheduling"."VisitClockInArrivalKind" NOT NULL,
    "label" TEXT NOT NULL,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitClockOutEndReasonCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitClockOutEndReasonCatalog_kind_label_key"
  ON "scheduling"."VisitClockOutEndReasonCatalog"("kind", "label");

CREATE INDEX "VisitClockOutEndReasonCatalog_kind_isActive_idx"
  ON "scheduling"."VisitClockOutEndReasonCatalog"("kind", "isActive");

CREATE INDEX "VisitClockOutEndReasonCatalog_sortOrder_idx"
  ON "scheduling"."VisitClockOutEndReasonCatalog"("sortOrder");
