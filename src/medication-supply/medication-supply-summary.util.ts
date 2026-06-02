import { MedicationKind, MedicationSupplyModel } from '@prisma/client';

export function inferMedicationSupplyModel(med: {
  medicationPackId: string | null;
  medicationType: { name: string } | null;
  route: { name: string } | null;
}): MedicationSupplyModel {
  if (med.medicationPackId) return MedicationSupplyModel.BLISTER_CYCLE;
  const typeName = med.medicationType?.name?.toLowerCase() ?? '';
  const routeName = med.route?.name?.toLowerCase() ?? '';
  if (typeName.includes('drop') || routeName.includes('eye') || routeName.includes('topical')) {
    return MedicationSupplyModel.BOTTLE_28DAY;
  }
  return MedicationSupplyModel.PRESCRIPTION_QTY;
}

export const CONSUMING_MAR_STATUS_CODES = ['G', 'F', 'I', 'S', 'T'] as const;

export {
  dedupeMedicationsByName,
  groupMedicationsByName,
} from '../medications/medication-name-dedupe.util';

export type MedicationSupplySummary = {
  supplyModel: MedicationSupplyModel;
  quantityRemaining: number | null;
  quantityTotal: number | null;
  qtyUnit: string;
  daysRemaining: number | null;
  /** Latest pharmacy delivery / receipt date (ISO date). */
  deliveredAt: string | null;
  cycleEndDate: string | null;
  runsOutDate: string | null;
  expiresAt: string | null;
  openedAt: string | null;
  pharmacyName: string | null;
  packName: string | null;
};

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type SupplySummaryInput = {
  medicationKind: MedicationKind;
  dose: string | null;
  supplyModel: MedicationSupplyModel;
  packName: string | null;
  schedules: { daysOfWeek: string[] }[];
  supplyProfile: {
    defaultQty: number | null;
    qtyUnit: string | null;
  } | null;
  latestDelivery: {
    deliveredAt: Date;
    quantity: number | null;
    cycleEndDate: Date | null;
    expiresAt: Date | null;
    runsOutDate: Date | null;
    openedAt: Date | null;
    pharmacyName: string | null;
  } | null;
  consumedSinceDelivery: number;
};

export function utcDayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}

export function estimateDosesPerDay(schedules: { daysOfWeek: string[] }[]): number {
  if (schedules.length === 0) return 0;
  let total = 0;
  for (const sch of schedules) {
    const dow = sch.daysOfWeek ?? [];
    if (dow.length === 0 || dow.length >= 7) total += 1;
    else total += dow.length / 7;
  }
  return total || schedules.length;
}

export function inferQtyUnit(dose: string | null, profileUnit: string | null): string {
  if (profileUnit?.trim()) return profileUnit.trim();
  const d = (dose ?? '').toLowerCase();
  if (d.includes('tablet') || d.includes(' tab')) return 'tabs';
  if (d.includes('capsule')) return 'capsules';
  if (d.includes('injection') || d.includes('drop') || d.includes('ml')) return 'doses';
  return 'units';
}

export function computeMedicationSupplySummary(
  input: SupplySummaryInput,
  today = new Date(),
): MedicationSupplySummary | null {
  const { latestDelivery, supplyProfile, supplyModel, schedules, consumedSinceDelivery, medicationKind, dose } =
    input;

  if (medicationKind === MedicationKind.PRN) return null;
  if (!latestDelivery && supplyProfile?.defaultQty == null) return null;

  const totalQty = latestDelivery?.quantity ?? supplyProfile?.defaultQty ?? null;
  const qtyUnit = inferQtyUnit(dose, supplyProfile?.qtyUnit ?? null);

  let quantityRemaining: number | null = null;
  if (totalQty != null) {
    quantityRemaining = Math.max(0, totalQty - consumedSinceDelivery);
  }

  let daysRemaining: number | null = null;
  if (latestDelivery) {
    if (supplyModel === MedicationSupplyModel.BLISTER_CYCLE && latestDelivery.cycleEndDate) {
      daysRemaining = Math.max(0, utcDayDiff(today, latestDelivery.cycleEndDate));
    } else if (supplyModel === MedicationSupplyModel.BOTTLE_28DAY && latestDelivery.expiresAt) {
      daysRemaining = Math.max(0, utcDayDiff(today, latestDelivery.expiresAt));
    } else if (latestDelivery.runsOutDate) {
      daysRemaining = Math.max(0, utcDayDiff(today, latestDelivery.runsOutDate));
    }
  }

  if (daysRemaining == null && quantityRemaining != null) {
    const dosesPerDay = estimateDosesPerDay(schedules);
    if (dosesPerDay > 0) {
      daysRemaining = Math.max(0, Math.floor(quantityRemaining / dosesPerDay));
    }
  }

  if (quantityRemaining == null && daysRemaining == null && !latestDelivery) return null;

  return {
    supplyModel,
    quantityRemaining,
    quantityTotal: totalQty,
    qtyUnit,
    daysRemaining,
    deliveredAt: latestDelivery ? isoDateOnly(latestDelivery.deliveredAt) : null,
    cycleEndDate: latestDelivery?.cycleEndDate ? isoDateOnly(latestDelivery.cycleEndDate) : null,
    runsOutDate: latestDelivery?.runsOutDate ? isoDateOnly(latestDelivery.runsOutDate) : null,
    expiresAt: latestDelivery?.expiresAt ? isoDateOnly(latestDelivery.expiresAt) : null,
    openedAt: latestDelivery?.openedAt ? isoDateOnly(latestDelivery.openedAt) : null,
    pharmacyName: latestDelivery?.pharmacyName?.trim() || null,
    packName: input.packName?.trim() || null,
  };
}
