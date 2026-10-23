/**
 * Mileage and travel time the visit pay run pays for one visit (beside the visit pay), from the
 * carer's pay card. Shared by the visit detail and the employee earnings summary so both agree.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import { loadPayCardRulesForVersion } from './pay-card-version.util';
import { calculateMileageAmount, calculateTravelTimeAmount } from './visit-reconciliation.util';
import {
  calculateUkMileage,
  pickMileageRates,
  ukTaxYearStartKey,
  type MileageVehicleType,
} from './pay-mileage.util';
import { mileageJourneysInTaxYear } from './mileage-ledger.store';
import { decidedTravelForVisit } from './travel-interval.util';

type Db = PrismaService | Prisma.TransactionClient;

export type VisitTravelPayRow = {
  id: string;
  payCardId: string | null;
  payCardVersion: number | null;
  employeeId: string | null;
  plannedStartDateTime: Date;
  travelMiles: Prisma.Decimal | number | null;
  travelMinutes: number | null;
};

export type VisitTravelPay = {
  mileage: { miles: number; unitRate: number | null; amount: number; explanation: string } | null;
  travel: { minutes: number; unitRate: number | null; amount: number; explanation: string } | null;
  total: number;
};

export async function priceVisitTravelPay(
  db: Db,
  row: VisitTravelPayRow,
  timeZone: string,
): Promise<VisitTravelPay | null> {
  if (!row.payCardId || !row.employeeId) return null;
  const visitDate = row.plannedStartDateTime;
  const [card, rules, intervals] = await Promise.all([
    db.payCard.findUnique({
      where: { id: row.payCardId },
      select: { mileageVehicleType: true, useUkMileageRates: true },
    }),
    loadPayCardRulesForVersion(db, row.payCardId, row.payCardVersion),
    db.travelTimeInterval.findMany({ where: { toVisitReconciliationId: row.id, status: 'APPROVED' } }),
  ]);

  const miles = row.travelMiles != null ? Number(row.travelMiles) : 0;
  let mileage: VisitTravelPay['mileage'] = null;
  if (miles > 0) {
    const dayKey = dayKeyInTimeZone(visitDate, timeZone);
    const vehicleType = (card?.mileageVehicleType as MileageVehicleType) ?? 'CAR_VAN';
    const [rateRows, journeys] = await Promise.all([
      db.mileageRate.findMany(),
      mileageJourneysInTaxYear(db, {
        employeeId: row.employeeId,
        taxYearStartKey: ukTaxYearStartKey(dayKey),
        timeZone,
      }),
    ]);
    const cardMileage = calculateMileageAmount(rules, visitDate, miles, false, timeZone);
    const uk = calculateUkMileage({
      miles,
      vehicleType,
      cardRatePerMile: cardMileage?.unitRate ?? null,
      useUkApprovedRates: card?.useUkMileageRates ?? true,
      ytdBusinessMiles: journeys
        .filter((j) => j.visitReconciliationId !== row.id && j.at < visitDate)
        .reduce((total, j) => total + j.miles, 0),
      rates: pickMileageRates(rateRows, vehicleType, dayKey),
    });
    const priced = uk ?? cardMileage;
    mileage = priced
      ? {
          miles,
          unitRate: priced.unitRate,
          amount: priced.amount,
          explanation: uk?.explanation ?? `${miles} mi × £${priced.unitRate.toFixed(2)}`,
        }
      : { miles, unitRate: null, amount: 0, explanation: 'No mileage rate on the pay card or for the day' };
  }

  // As the pay run: approved travel intervals decide, otherwise the minutes on the visit.
  const decided = decidedTravelForVisit(intervals);
  const minutes = decided ? decided.travelMinutes : (row.travelMinutes ?? 0);
  const priced = calculateTravelTimeAmount(rules, visitDate, minutes, false, timeZone);
  const travel =
    minutes > 0
      ? {
          minutes,
          unitRate: priced?.unitRate ?? null,
          amount: priced?.amount ?? 0,
          explanation: priced
            ? `${minutes} min × £${priced.unitRate.toFixed(2)}/hr`
            : 'No travel time rate on the pay card',
        }
      : null;

  if (!mileage && !travel) return null;
  return {
    mileage,
    travel,
    total: Math.round(((mileage?.amount ?? 0) + (travel?.amount ?? 0)) * 100) / 100,
  };
}
