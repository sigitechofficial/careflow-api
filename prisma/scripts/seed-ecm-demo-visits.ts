/**
 * ECM regulatory demo seed — creates multi-scenario completed visits so graphs/reports
 * show realistic CQC/NHS-style timing evidence (planned vs actual, exceptions, confidence).
 *
 * Prereqs: service users (prefer SU-TEST-* personas) + active employees + schedule area.
 *
 * Usage:
 *   npm run seed:ecm-demo
 *   npm run seed:ecm-demo -- --days=14 --reset
 *   npm run seed:ecm-demo -- --from=2026-07-01 --to=2026-07-14
 */

import { NestFactory } from '@nestjs/core';
import {
  AllocationStatus,
  Prisma,
  PrismaClient,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitAttendanceEventType,
  VisitAttendanceVerificationMethod,
} from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { EcmEvaluationService } from '../../src/ecm/ecm-evaluation.service';

const JOB_PREFIX = 'ECM-DEMO';
const DEMO_META = { ecmDemoSeed: true, purpose: 'CQC_NHS_ECM_EVIDENCE' } as const;

type ScenarioCode =
  | 'ON_TIME'
  | 'EARLY'
  | 'LATE'
  | 'VERY_LATE'
  | 'SHORT'
  | 'LONG'
  | 'MISSED_POTENTIAL'
  | 'MISSED_CONFIRMED'
  | 'MISSING_CHECKOUT'
  | 'GEOFENCE'
  | 'MANUAL'
  | 'NO_ACCESS_STYLE';

type SlotDef = { label: string; hour: number; minute: number; durationMin: number };

type ScenarioDef = {
  code: ScenarioCode;
  /** Human label for job notes / CQC evidence narrative */
  evidenceNote: string;
};

const SLOTS: SlotDef[] = [
  { label: 'Morning', hour: 8, minute: 0, durationMin: 60 },
  { label: 'Midday', hour: 12, minute: 30, durationMin: 45 },
  { label: 'Evening', hour: 17, minute: 0, durationMin: 60 },
];

/** Weighted rotation — mirrors expected operational mix. */
const SCENARIO_ROTATION: ScenarioDef[] = [
  { code: 'ON_TIME', evidenceNote: 'Arrived within permitted window; full planned duration; GPS verified.' },
  { code: 'ON_TIME', evidenceNote: 'On-time electronic check-in/out within geofence.' },
  { code: 'ON_TIME', evidenceNote: 'Verified attendance; duration within tolerance.' },
  { code: 'ON_TIME', evidenceNote: 'Punctual start and end; confidence VERIFIED.' },
  { code: 'LATE', evidenceNote: 'Late start (>15 min); duration completed; reason: previous visit overran.' },
  { code: 'LATE', evidenceNote: 'Late arrival; travel delay recorded for commissioner evidence.' },
  { code: 'VERY_LATE', evidenceNote: 'Very late start (>30 min); escalation-relevant for time-critical SUs.' },
  { code: 'EARLY', evidenceNote: 'Early arrival outside permitted window; still completed planned care.' },
  { code: 'SHORT', evidenceNote: 'Actual duration short of planned; understay flagged for review.' },
  { code: 'SHORT', evidenceNote: 'Short visit; investigate unmet needs / early departure.' },
  { code: 'LONG', evidenceNote: 'Overstay beyond long-visit tolerance; overrun documented.' },
  { code: 'MISSED_POTENTIAL', evidenceNote: 'No check-in after missed threshold; potential missed pending triage.' },
  { code: 'MISSED_CONFIRMED', evidenceNote: 'Confirmed missed visit after welfare checks / office confirmation.' },
  { code: 'MISSING_CHECKOUT', evidenceNote: 'Checked in but missing checkout past planned end.' },
  { code: 'GEOFENCE', evidenceNote: 'Attendance captured outside geofence radius; integrity review.' },
  { code: 'MANUAL', evidenceNote: 'Office manual attendance with reason; confidence MANUALLY_VERIFIED.' },
  { code: 'NO_ACCESS_STYLE', evidenceNote: 'Late with no-access style operational flag for exception queue.' },
];

const REASON_BY_SCENARIO: Partial<Record<ScenarioCode, string>> = {
  LATE: 'PREVIOUS_VISIT_OVERRAN',
  VERY_LATE: 'INSUFFICIENT_TRAVEL_TIME',
  SHORT: 'SERVICE_USER_REQUESTED_CHANGE',
  LONG: 'LONG_PLANNED_INSUFFICIENT',
  MISSED_POTENTIAL: 'CARER_SICKNESS',
  MISSED_CONFIRMED: 'NO_ACCESS',
  MISSING_CHECKOUT: 'MISSING_CHECKOUT',
  GEOFENCE: 'OUTSIDE_GEOFENCE',
  MANUAL: 'MOBILE_APPLICATION_PROBLEM',
  EARLY: 'ROTA_ERROR',
  NO_ACCESS_STYLE: 'NO_ACCESS',
};

function parseArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return arg?.split('=')[1]?.trim() || undefined;
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function addDaysIso(iso: string, days: number): string {
  const d = utcDay(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateOnly(d);
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
    if (out.length > 62) break;
  }
  return out;
}

function plannedRange(dayIso: string, slot: SlotDef): { start: Date; end: Date } {
  const start = new Date(
    `${dayIso}T${String(slot.hour).padStart(2, '0')}:${String(slot.minute).padStart(2, '0')}:00.000Z`,
  );
  const end = new Date(start.getTime() + slot.durationMin * 60_000);
  return { start, end };
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

type AttendancePlan = {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  method: VisitAttendanceVerificationMethod;
  outsideGeofence: boolean;
  outsideReason?: string;
  distanceMeters?: number;
  isMockLocation?: boolean;
  confirmedMissed?: boolean;
  /** Evaluation "now" for historical missed / missing checkout */
  evaluateAt: Date;
  operationalHint?: string;
};

function buildAttendance(scenario: ScenarioCode, start: Date, end: Date): AttendancePlan {
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);
  const dayEnd = addMinutes(end, 180);

  switch (scenario) {
    case 'ON_TIME':
      return {
        checkInAt: addMinutes(start, 2),
        checkOutAt: addMinutes(end, 1),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'EARLY':
      return {
        checkInAt: addMinutes(start, -18),
        checkOutAt: addMinutes(end, -15),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'LATE':
      return {
        checkInAt: addMinutes(start, 22),
        checkOutAt: addMinutes(end, 24),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'VERY_LATE':
      return {
        checkInAt: addMinutes(start, 38),
        checkOutAt: addMinutes(end, 40),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'SHORT':
      return {
        checkInAt: addMinutes(start, 1),
        checkOutAt: addMinutes(start, Math.max(15, durationMin - 20)),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'LONG':
      return {
        checkInAt: addMinutes(start, 0),
        checkOutAt: addMinutes(end, 25),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'MISSED_POTENTIAL':
      return {
        checkInAt: null,
        checkOutAt: null,
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: addMinutes(start, 95),
      };
    case 'MISSED_CONFIRMED':
      return {
        checkInAt: null,
        checkOutAt: null,
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        confirmedMissed: true,
        evaluateAt: addMinutes(start, 120),
      };
    case 'MISSING_CHECKOUT':
      return {
        checkInAt: addMinutes(start, 3),
        checkOutAt: null,
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: addMinutes(end, 45),
      };
    case 'GEOFENCE':
      return {
        checkInAt: addMinutes(start, 5),
        checkOutAt: addMinutes(end, 4),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: true,
        outsideReason: 'CHECK_IN_OUTSIDE_RADIUS',
        distanceMeters: 240,
        evaluateAt: dayEnd,
      };
    case 'MANUAL':
      return {
        checkInAt: addMinutes(start, 4),
        checkOutAt: addMinutes(end, 2),
        method: VisitAttendanceVerificationMethod.MANUAL_OFFICE,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
    case 'NO_ACCESS_STYLE':
      return {
        checkInAt: addMinutes(start, 25),
        checkOutAt: addMinutes(start, 35),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        operationalHint: 'NO_ACCESS',
        evaluateAt: dayEnd,
      };
    default:
      return {
        checkInAt: addMinutes(start, 0),
        checkOutAt: addMinutes(end, 0),
        method: VisitAttendanceVerificationMethod.MOBILE_GPS,
        outsideGeofence: false,
        evaluateAt: dayEnd,
      };
  }
}

function homeCoords(seed: number): { lat: number; lng: number } {
  // Spread around central London for distinct SU locations
  return {
    lat: 51.5 + (seed % 7) * 0.012,
    lng: -0.14 + (seed % 5) * 0.015,
  };
}

async function main() {
  const daysArg = Number(parseArg('--days') ?? '14');
  const days = Number.isFinite(daysArg) && daysArg > 0 ? Math.min(Math.floor(daysArg), 45) : 14;
  const reset = process.argv.includes('--reset');
  const today = formatDateOnly(new Date());
  const dateTo = parseArg('--to') ?? addDaysIso(today, -1); // prefer completed historical days
  const dateFrom = parseArg('--from') ?? addDaysIso(dateTo, -(days - 1));
  const dates = eachDateInclusive(dateFrom, dateTo);

  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const evaluation = app.get(EcmEvaluationService);

    if (reset) {
      const existing = await prisma.scheduledJob.findMany({
        where: {
          deletedAt: null,
          OR: [
            { jobName: { startsWith: JOB_PREFIX } },
            {
              metadata: {
                path: ['ecmDemoSeed'],
                equals: true,
              },
            },
          ],
        },
        select: { id: true },
      });
      if (existing.length) {
        await prisma.scheduledJob.deleteMany({
          where: { id: { in: existing.map((j) => j.id) } },
        });
        console.log(`[seed:ecm-demo] reset removed ${existing.length} prior ECM-DEMO jobs`);
      }
    }

    const serviceUsers = await prisma.serviceUser.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [
          { serviceUserNumber: { startsWith: 'SU-TEST-' } },
          { serviceUserNumber: { startsWith: 'SU-' } },
        ],
      },
      orderBy: { serviceUserNumber: 'asc' },
      take: 6,
      select: {
        id: true,
        serviceUserNumber: true,
        firstName: true,
        lastName: true,
        preferredName: true,
      },
    });

    if (serviceUsers.length < 2) {
      throw new Error(
        'Need at least 2 active service users (run npm run seed:personas first for SU-TEST-* ).',
      );
    }

    const employees = await prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      take: 8,
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
        employment: { select: { employeeNumber: true } },
      },
    });

    if (employees.length < 2) {
      throw new Error('Need at least 2 active employees/carers to allocate ECM demo visits.');
    }

    const areas = await prisma.scheduleArea.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      take: 4,
      select: { id: true, name: true, code: true },
    });

    const admin =
      (await prisma.user.findFirst({
        where: { email: 'admin@careadmin.local', isActive: true, deletedAt: null },
      })) ??
      (await prisma.user.findFirst({
        where: { isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      }));

    console.log(
      `[seed:ecm-demo] range ${dateFrom} → ${dateTo} · ${serviceUsers.length} SUs · ${employees.length} carers · ${areas.length || 1} areas`,
    );

    let created = 0;
    let evaluated = 0;
    let skipped = 0;
    const scenarioCounts: Record<string, number> = {};

    for (const [dayIdx, dayIso] of dates.entries()) {
      const day = utcDay(dayIso);
      let batch = await prisma.scheduleBatch.findFirst({
        where: { scheduleDate: day, deletedAt: null, isActive: true },
      });
      if (!batch) {
        batch = await prisma.scheduleBatch.create({
          data: {
            scheduleDate: day,
            status: 'BUILT',
            buildSource: 'MANUAL',
            name: `ECM demo ${dayIso}`,
            builtAt: new Date(),
            builtById: admin?.id ?? null,
            metadata: { ...DEMO_META, dayIso } as Prisma.InputJsonValue,
            createdById: admin?.id ?? null,
          },
        });
      }

      for (const [suIdx, su] of serviceUsers.entries()) {
        const suLabel =
          su.preferredName?.trim() ||
          [su.firstName, su.lastName].filter(Boolean).join(' ') ||
          su.serviceUserNumber;
        const coords = homeCoords(suIdx + dayIdx);
        const area = areas.length ? areas[(suIdx + dayIdx) % areas.length]! : null;

        for (const [slotIdx, slot] of SLOTS.entries()) {
          // Skip some evening slots on weekends for realistic volume variation
          const dow = utcDay(dayIso).getUTCDay(); // 0 Sun
          if ((dow === 0 || dow === 6) && slot.label === 'Evening' && suIdx % 2 === 1) {
            skipped += 1;
            continue;
          }

          const rot =
            (dayIdx * 17 + suIdx * 5 + slotIdx * 3) % SCENARIO_ROTATION.length;
          const scenario = SCENARIO_ROTATION[rot]!;
          scenarioCounts[scenario.code] = (scenarioCounts[scenario.code] ?? 0) + 1;

          const { start, end } = plannedRange(dayIso, slot);
          const jobName = `${JOB_PREFIX} · ${slot.label} — ${suLabel}`;

          const already = await prisma.scheduledJob.findFirst({
            where: {
              deletedAt: null,
              serviceUserId: su.id,
              jobName,
              scheduledStartDateTime: start,
            },
            select: { id: true },
          });
          if (already) {
            skipped += 1;
            continue;
          }

          const employee = employees[(suIdx + slotIdx + dayIdx) % employees.length]!;
          const carerLabel =
            employee.employment?.employeeNumber?.trim() ||
            [employee.personalDetail?.firstName, employee.personalDetail?.lastName]
              .filter(Boolean)
              .join(' ') ||
            employee.id.slice(0, 8);
          const plan = buildAttendance(scenario.code, start, end);

          const job = await prisma.scheduledJob.create({
            data: {
              scheduleBatchId: batch.id,
              scheduleAreaId: area?.id ?? null,
              serviceUserId: su.id,
              jobName,
              description: `[${scenario.code}] ${scenario.evidenceNote}`,
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              estimatedDurationMinutes: slot.durationMin,
              requiredCarers: 1,
              status: ScheduledJobStatus.ALLOCATED,
              address: `${10 + suIdx} Demo Care Street`,
              postcode: `E${1 + (suIdx % 9)} ${2 + slotIdx}AA`,
              latitude: coords.lat,
              longitude: coords.lng,
              notes: `ECM regulatory demo · ${scenario.code} · carer ${carerLabel}`,
              metadata: {
                ...DEMO_META,
                scenario: scenario.code,
                slot: slot.label,
                dayIso,
                areaName: area?.name ?? null,
              } as Prisma.InputJsonValue,
              createdById: admin?.id ?? null,
            },
          });

          const visit = await prisma.scheduledVisit.create({
            data: {
              scheduledJobId: job.id,
              serviceUserId: su.id,
              visitName: `${slot.label} — ${suLabel}`,
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              requiredCarers: 1,
              status: ScheduledVisitStatus.PLANNED,
              createdById: admin?.id ?? null,
            },
          });

          const allocation = await prisma.jobAllocation.create({
            data: {
              scheduledJobId: job.id,
              scheduledVisitId: visit.id,
              employeeId: employee.id,
              status: AllocationStatus.CONFIRMED,
              confirmedAt: addMinutes(start, -120),
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              durationMinutes: slot.durationMin,
              isLeadCarer: true,
              notes: `ECM demo allocation · ${scenario.code}`,
              allocatedById: admin?.id ?? null,
            },
          });

          const baseLat = Number(coords.lat);
          const baseLng = Number(coords.lng);
          const eventLat = plan.outsideGeofence ? baseLat + 0.008 : baseLat;
          const eventLng = plan.outsideGeofence ? baseLng + 0.006 : baseLng;

          if (plan.checkInAt) {
            await prisma.visitAttendanceEvent.create({
              data: {
                scheduledJobId: job.id,
                scheduledVisitId: visit.id,
                jobAllocationId: allocation.id,
                employeeId: employee.id,
                eventType: VisitAttendanceEventType.CHECK_IN,
                verificationMethod: plan.method,
                occurredAt: plan.checkInAt,
                deviceCapturedAt: plan.checkInAt,
                clientEventId: `ecm-demo-in-${job.id}`,
                latitude: eventLat,
                longitude: eventLng,
                accuracyMeters: plan.outsideGeofence ? 35 : 12,
                isMockLocation: plan.isMockLocation ?? false,
                outsideGeofence: plan.outsideGeofence,
                outsideGeofenceReason: plan.outsideReason ?? null,
                distanceMeters: plan.distanceMeters ?? null,
                identityConfirmed: plan.method === VisitAttendanceVerificationMethod.MOBILE_GPS,
                notes: scenario.evidenceNote,
              },
            });
          }

          if (plan.checkOutAt) {
            await prisma.visitAttendanceEvent.create({
              data: {
                scheduledJobId: job.id,
                scheduledVisitId: visit.id,
                jobAllocationId: allocation.id,
                employeeId: employee.id,
                eventType: VisitAttendanceEventType.CHECK_OUT,
                verificationMethod: plan.method,
                occurredAt: plan.checkOutAt,
                deviceCapturedAt: plan.checkOutAt,
                clientEventId: `ecm-demo-out-${job.id}`,
                latitude: eventLat,
                longitude: eventLng,
                accuracyMeters: plan.outsideGeofence ? 40 : 14,
                isMockLocation: false,
                outsideGeofence: plan.outsideGeofence,
                outsideGeofenceReason: plan.outsideReason ?? null,
                distanceMeters: plan.distanceMeters ?? null,
                identityConfirmed: true,
                notes: scenario.evidenceNote,
              },
            });
          }

          const result = await evaluation.evaluateJob(job.id, {
            now: plan.evaluateAt,
            confirmedMissed: plan.confirmedMissed === true,
          });

          // Enrich open exceptions with CQC-style reason codes for reason-ranking graphs
          const reason = REASON_BY_SCENARIO[scenario.code];
          if (reason && result?.evaluation?.id) {
            await prisma.ecmException.updateMany({
              where: {
                ecmVisitEvaluationId: result.evaluation.id,
                reasonCode: null,
              },
              data: { reasonCode: reason },
            });
          }

          // Stamp NO_ACCESS operational code when scenario requires it
          if (plan.operationalHint === 'NO_ACCESS' && result?.evaluation?.id) {
            const ev = await prisma.ecmVisitEvaluation.findUnique({
              where: { id: result.evaluation.id },
              select: { operationalExceptionCodes: true },
            });
            const codes = new Set(ev?.operationalExceptionCodes ?? []);
            codes.add('NO_ACCESS');
            await prisma.ecmVisitEvaluation.update({
              where: { id: result.evaluation.id },
              data: { operationalExceptionCodes: [...codes] },
            });
          }

          created += 1;
          evaluated += 1;
        }
      }
    }

    console.log('[seed:ecm-demo] done', {
      dateFrom,
      dateTo,
      created,
      evaluated,
      skipped,
      scenarioCounts,
      tip: 'Open /ecm/graph and /ecm/reports — select the seeded date range',
    });
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error('[seed:ecm-demo] failed', err);
  process.exitCode = 1;
});
