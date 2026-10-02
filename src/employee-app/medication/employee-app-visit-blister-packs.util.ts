import type { MedicationPackStatus, MedicationPackType } from '@prisma/client';
import {
  buildMarAdminEchoFields,
  emptyMarAdminEchoFields,
  type MarAdminEventEchoSource,
} from './employee-app-mar-echo.util';
import { dayKeyInTimeZone } from '../../common/utils/operational-day.util';
import type { MedicationWitnessEcho } from '../../medications/medication-witness.util';
import {
  filterCompartmentsForVisitRound,
  medMatchesCompartmentDueTime,
  normalizePackDueTime,
  plannedHowAssistedLabel,
  type VisitMedicationRound,
} from './employee-app-visit-medication-round.util';
import { dueTimeFallsInHmWindow } from '../../service-user-visit-plans/visit-medication-window.util';
import type { MarBodyMapSite } from './employee-app-mar-body-map-site.util';

function filterCompartmentsForVisit(
  compartments: Array<{ label: string; dueTime: string; windowStart?: string | null; windowEnd?: string | null; witnessRequired: boolean; id: string }>,
  visitRound: VisitMedicationRound | null,
  visitWindow?: { startHm: string; endHm: string } | null,
) {
  if (visitWindow?.startHm && visitWindow?.endHm) {
    return compartments.filter((c) =>
      dueTimeFallsInHmWindow(c.dueTime, visitWindow.startHm, visitWindow.endHm),
    );
  }
  return filterCompartmentsForVisitRound(compartments, visitRound);
}

type Tone = 'danger' | 'warning' | 'primary' | 'success' | 'neutral';

export type EmployeeAppBlisterPackMedicine = {
  memberId: string;
  id: string;
  scheduledDoseId: string;
  medicationScheduleId: string | null;
  name: string;
  strength: string | null;
  dose: string | null;
  route: string | null;
  detailLine: string;
  detail: string;
  isPrn: false;
  done: boolean;
  isRecorded: boolean;
  resolved: boolean;
  controlled: boolean;
  timeCritical: boolean;
  allergyWarning: boolean;
  allergyWarningMessage: string | null;
  relatedAllergy: string | null;
  administrationEventId: string | null;
  outcomeCode: string | null;
  outcomeLabel: string | null;
  supportLevel: string | null;
  notes: string | null;
  reasonCode: string | null;
  timeGiven: string | null;
  administeredAt: string | null;
  deviceRecordedAt: string | null;
  prnIndication: string | null;
  prnEffectiveness: string | null;
  savedAtLabel: string | null;
  witness: MedicationWitnessEcho | null;
  dueStatus: 'due' | 'recorded';
  countsTowardScheduledProgress: true;
  reasonForMedication: string | null;
  instructions: string | null;
  howAssisted: string | null;
  bodyMapSite: MarBodyMapSite | null;
  scheduledLabel: string;
  tags: Array<{ id: string; label: string; tone: Tone }>;
};

export type EmployeeAppBlisterPackCompartment = {
  id: string;
  label: string;
  dueTime: string;
  windowStart: string | null;
  windowEnd: string | null;
  witnessRequired: boolean;
  medicineCount: number;
  pendingCount: number;
  canRecordRound: boolean;
  medicines: EmployeeAppBlisterPackMedicine[];
};

export type EmployeeAppBlisterPack = {
  id: string;
  name: string;
  packType: MedicationPackType;
  status: MedicationPackStatus;
  roundLabel: string | null;
  compartments: EmployeeAppBlisterPackCompartment[];
};

type PackMemberMed = {
  id: string;
  medicationName: string;
  dose: string | null;
  strength: string | null;
  reasonForMedication?: string | null;
  instructions: string | null;
  howAssisted?: string | null;
  isControlledMedication: boolean;
  timeCritical?: boolean;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  route: { name: string } | null;
  medicationPack: { adminRules: unknown } | null;
  schedules: Array<{ id: string; dueTime: string | null; round: { name: string } | null }>;
};

type PackInput = {
  id: string;
  name: string;
  packType: MedicationPackType;
  status: MedicationPackStatus;
  roundLabel: string | null;
  compartments: Array<{
    id: string;
    label: string;
    dueTime: string;
    windowStart: string | null;
    windowEnd: string | null;
    witnessRequired: boolean;
  }>;
  members: Array<{
    id: string;
    serviceUserMedicationId: string;
    serviceUserMedication: PackMemberMed;
  }>;
};

type MapPackMedicineInput = {
  memberId: string;
  med: PackMemberMed;
  compartmentDueTime: string;
  allergyLower: string[];
  eventByMed: Map<string, MarAdminEventEchoSource>;
  bodyMapSiteByMedId?: Map<string, MarBodyMapSite>;
  timeZone?: string;
};

function mapPackMedicine(input: MapPackMedicineInput): EmployeeAppBlisterPackMedicine {
  const { memberId, med, compartmentDueTime, allergyLower, eventByMed, bodyMapSiteByMedId, timeZone } =
    input;
  const dose = [med.dose, med.strength].filter(Boolean).join(' ') || null;
  const route = med.route?.name ?? null;
  const schedule =
    med.schedules.find((s) => normalizePackDueTime(s.dueTime) === normalizePackDueTime(compartmentDueTime)) ??
    med.schedules[0];
  const timing = schedule?.round?.name ?? null;
  const detailParts = [dose, route, timing].filter(Boolean);
  const allergyHit = allergyLower.some((a) => med.medicationName.toLowerCase().includes(a));
  const adminRules =
    med.medicationPack?.adminRules && typeof med.medicationPack.adminRules === 'object'
      ? (med.medicationPack.adminRules as Record<string, unknown>)
      : {};
  const tags: EmployeeAppBlisterPackMedicine['tags'] = [];
  if (allergyHit) tags.push({ id: 'allergy', label: 'Allergy', tone: 'danger' });
  if (med.isControlledMedication) tags.push({ id: 'cd', label: 'CD', tone: 'warning' });
  if (Boolean(med.timeCritical) || Boolean(adminRules.timeCritical)) {
    tags.push({ id: 'time_critical', label: 'Time-critical', tone: 'warning' });
  }

  const evt = eventByMed.get(med.id);
  const echo = evt ? buildMarAdminEchoFields(evt, timeZone) : emptyMarAdminEchoFields();
  const dueTime = normalizePackDueTime(compartmentDueTime);
  const relatedAllergy = allergyHit
    ? allergyLower.find((a) => med.medicationName.toLowerCase().includes(a)) ?? null
    : null;

  return {
    memberId,
    id: med.id,
    scheduledDoseId: `${med.id}:${dueTime}`,
    medicationScheduleId: schedule?.id ?? null,
    name: med.medicationName,
    strength: med.strength ?? null,
    dose: med.dose ?? null,
    route,
    detailLine: detailParts.join(' · '),
    detail: detailParts.join(' · '),
    isPrn: false,
    controlled: Boolean(med.isControlledMedication),
    timeCritical: Boolean(med.timeCritical) || Boolean(adminRules.timeCritical),
    allergyWarning: Boolean(allergyHit),
    allergyWarningMessage: relatedAllergy ? `Related allergy: ${relatedAllergy}` : null,
    relatedAllergy,
    dueStatus: echo.done ? 'recorded' : 'due',
    countsTowardScheduledProgress: true,
    reasonForMedication: med.reasonForMedication?.trim() || null,
    instructions: med.instructions ?? null,
    howAssisted: plannedHowAssistedLabel(med.howAssisted),
    bodyMapSite: bodyMapSiteByMedId?.get(med.id) ?? null,
    scheduledLabel: dueTime,
    tags,
    ...echo,
  };
}

function medicationActiveOnVisitDay(
  med: { startDate?: Date | string | null; endDate?: Date | string | null },
  visitAt: Date,
  timeZone: string | undefined,
): boolean {
  // Medication start/end are calendar labels; compare with the visit's org-local day.
  const day = timeZone
    ? new Date(`${dayKeyInTimeZone(visitAt, timeZone)}T00:00:00.000Z`)
    : new Date(Date.UTC(visitAt.getUTCFullYear(), visitAt.getUTCMonth(), visitAt.getUTCDate()));
  if (med.startDate) {
    const start = new Date(med.startDate);
    if (!Number.isNaN(start.getTime()) && start > day) return false;
  }
  if (med.endDate) {
    const end = new Date(med.endDate);
    if (!Number.isNaN(end.getTime()) && end < day) return false;
  }
  return true;
}

export function buildVisitBlisterPacks(input: {
  packs: PackInput[];
  visitRound: VisitMedicationRound | null;
  visitWindow?: { startHm: string; endHm: string } | null;
  allergyLower: string[];
  eventByMed: Map<string, MarAdminEventEchoSource>;
  bodyMapSiteByMedId?: Map<string, MarBodyMapSite>;
  timeZone?: string;
  visitAt?: Date;
}): EmployeeAppBlisterPack[] {
  const {
    packs,
    visitRound,
    visitWindow,
    allergyLower,
    eventByMed,
    bodyMapSiteByMedId,
    timeZone,
    visitAt,
  } = input;

  return packs
    .map((pack) => {
      const activeMembers = pack.members.filter((m) => m.serviceUserMedication);
      const compartments = filterCompartmentsForVisit(pack.compartments, visitRound, visitWindow)
        .map((compartment) => {
          const slotMembers = activeMembers.filter((member) => {
            if (
              !medMatchesCompartmentDueTime(
                member.serviceUserMedication.schedules,
                compartment.dueTime,
              )
            ) {
              return false;
            }
            if (!visitAt) return true;
            const recorded = eventByMed.has(member.serviceUserMedication.id);
            return recorded || medicationActiveOnVisitDay(member.serviceUserMedication, visitAt, timeZone);
          });
          const medicines = slotMembers.map((member) =>
            mapPackMedicine({
              memberId: member.id,
              med: member.serviceUserMedication,
              compartmentDueTime: compartment.dueTime,
              allergyLower,
              eventByMed,
              bodyMapSiteByMedId,
              timeZone,
            }),
          );
          const pendingCount = medicines.filter((m) => !m.isRecorded).length;
          return {
            id: compartment.id,
            label: compartment.label,
            dueTime: normalizePackDueTime(compartment.dueTime),
            windowStart: compartment.windowStart ? normalizePackDueTime(compartment.windowStart) : null,
            windowEnd: compartment.windowEnd ? normalizePackDueTime(compartment.windowEnd) : null,
            witnessRequired: compartment.witnessRequired,
            medicineCount: medicines.length,
            pendingCount,
            canRecordRound: medicines.length > 0 && pendingCount > 0,
            medicines,
          };
        })
        .filter((c) => c.medicines.length > 0);

      if (compartments.length === 0) return null;

      return {
        id: pack.id,
        name: pack.name,
        packType: pack.packType,
        status: pack.status,
        roundLabel: pack.roundLabel,
        compartments,
      };
    })
    .filter((pack): pack is EmployeeAppBlisterPack => pack != null);
}

export function collectActivePackMedicationIds(packs: PackInput[]): Set<string> {
  const ids = new Set<string>();
  for (const pack of packs) {
    for (const member of pack.members) {
      ids.add(member.serviceUserMedicationId);
    }
  }
  return ids;
}
