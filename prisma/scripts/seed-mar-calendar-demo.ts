/**
 * MAR calendar demo seed — comprehensive, validated coverage.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-calendar-demo.ts [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-calendar-demo.ts --reset [serviceUserId]
 *   npx ts-node --transpile-only prisma/scripts/seed-mar-calendar-demo.ts --delete-only [serviceUserId]
 */
import {
  MedicationAdministrationStatus,
  MedicationKind,
  MedicationRecordStatus,
  MedicationSupplyModel,
  PrismaClient,
} from '@prisma/client';
import { statusCodeToAdministrationStatus } from '../../src/medication-charts/medication-chart-display.util';

const cliArgs = process.argv.slice(2);
const RESET_FIRST = cliArgs.includes('--reset');
const DELETE_ONLY = cliArgs.includes('--delete-only');
const SERVICE_USER_ID =
  cliArgs.find((a) => !a.startsWith('--')) ?? 'ea274b6c-9a8a-4bc1-b6c5-27e7c4bd5fdd';

type DemoMedSpec = {
  medicationName: string;
  strength: string;
  dose: string;
  timesPerDay: number;
  roundCodes: string[];
  frequencyLabel: string;
  frequencyCode: string;
  medicationKind?: MedicationKind;
  isControlled?: boolean;
  instructions?: string;
  /** Per administration-round dose override */
  slotDosesByCode?: Record<string, string>;
  /** Active from day of current month (1-based) — demonstrates N/A cells before start */
  startDayOfMonth?: number;
  /** Schedule applies only on these UTC weekday names */
  daysOfWeek?: string[];
  /** Seed G on morning slot, days 1–7 */
  sampleGivenMorning?: boolean;
  doseGivenOnRecord?: string;
  /** One MAR status code per day on morning slot (days 1…n) */
  statusCodeShowcase?: boolean;
  /** PRN: record Given on this day of month */
  prnGivenDay?: number;
};

/** Recordable MAR codes (legend also has Pending, Due, N/A from chart logic). */
const MAR_STATUS_SHOWCASE_CODES = [
  'G',
  'R',
  'N',
  'U',
  'H',
  'A',
  'C',
  'F',
  'I',
  'S',
  'T',
  'O',
  'P',
  'PCI',
] as const;

const DEMO_MEDS: DemoMedSpec[] = [
  {
    medicationName: 'Paracetamol — 5× daily (demo)',
    strength: '500mg',
    dose: '1 tablet',
    timesPerDay: 5,
    frequencyCode: 'FIVE_TIMES_DAILY',
    frequencyLabel: 'Five times daily',
    roundCodes: ['MORNING', 'MIDDAY', 'AFTERNOON', 'EVENING', 'NIGHT'],
    sampleGivenMorning: true,
  },
  {
    medicationName: 'Omeprazole — 4× daily (demo)',
    strength: '20mg',
    dose: '1 capsule',
    timesPerDay: 4,
    frequencyCode: 'FOUR_TIMES_DAILY',
    frequencyLabel: 'Four times daily',
    roundCodes: ['MORNING', 'MIDDAY', 'AFTERNOON', 'EVENING'],
  },
  {
    medicationName: 'Metformin — 3× daily (demo)',
    strength: '500mg',
    dose: '1 tablet',
    timesPerDay: 3,
    frequencyCode: 'THREE_TIMES_DAILY',
    frequencyLabel: 'Three times daily',
    roundCodes: ['MORNING', 'MIDDAY', 'EVENING'],
    instructions: 'Take with meals',
    slotDosesByCode: { MORNING: '1 tablet', MIDDAY: '2 tablets', EVENING: '1 tablet' },
  },
  {
    medicationName: 'Atorvastatin — 2× daily (demo)',
    strength: '20mg',
    dose: '1 tablet',
    timesPerDay: 2,
    frequencyCode: 'TWICE_DAILY',
    frequencyLabel: 'Twice daily',
    roundCodes: ['MORNING', 'EVENING'],
    statusCodeShowcase: true,
    instructions: 'Morning row: days 1–14 show each MAR status code (G…PCI); evening row stays Due until recorded',
  },
  {
    medicationName: 'Vitamin D — 1× daily (demo)',
    strength: '1000 IU',
    dose: '1 capsule',
    timesPerDay: 1,
    frequencyCode: 'ONCE_DAILY',
    frequencyLabel: 'Once daily',
    roundCodes: ['MORNING'],
    startDayOfMonth: 20,
    instructions: 'N/A on calendar before day 20 of month',
  },
  {
    medicationName: 'Co-codamol — 2 tablets/dose (demo)',
    strength: '30/500mg',
    dose: '2 tablets',
    timesPerDay: 5,
    frequencyCode: 'FIVE_TIMES_DAILY',
    frequencyLabel: 'Five times daily',
    roundCodes: ['MORNING', 'MIDDAY', 'AFTERNOON', 'EVENING', 'NIGHT'],
    isControlled: true,
    instructions: 'Controlled drug — 2 tablets each time',
    sampleGivenMorning: true,
    doseGivenOnRecord: '2 tablets',
  },
  {
    medicationName: 'Furosemide — Mon/Wed/Fri (demo)',
    strength: '40mg',
    dose: '1 tablet',
    timesPerDay: 1,
    frequencyCode: 'WEEKLY',
    frequencyLabel: 'Weekly (Mon, Wed, Fri)',
    roundCodes: ['MORNING'],
    daysOfWeek: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
    instructions: 'Specific days — N/A on other weekdays',
  },
  {
    medicationName: 'Vitamin B12 — weekly Tue (demo)',
    strength: '1mg',
    dose: '1 injection',
    timesPerDay: 1,
    frequencyCode: 'WEEKLY',
    frequencyLabel: 'Weekly (Tuesday)',
    roundCodes: ['MORNING'],
    daysOfWeek: ['TUESDAY'],
    instructions: 'Weekly chip — Tuesday mornings only',
  },
  {
    medicationName: 'Gaviscon — PRN (demo)',
    strength: '10ml',
    dose: '10–20ml',
    timesPerDay: 0,
    frequencyCode: 'AS_REQUIRED',
    frequencyLabel: 'As required (PRN)',
    roundCodes: [],
    medicationKind: MedicationKind.PRN,
    instructions: 'PRN row — blue + when needed; Given recorded day 8',
    prnGivenDay: 8,
  },
];

const prisma = new PrismaClient();

function monthStartUtc(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function medStartDate(base: Date, dayOfMonth?: number): Date {
  const d = new Date(base);
  if (dayOfMonth && dayOfMonth > 1) d.setUTCDate(dayOfMonth);
  return d;
}

function addDaysUtc(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function seedSupplyDelivery(
  medId: string,
  spec: DemoMedSpec,
  monthBase: Date,
  userId: string | null,
) {
  if (spec.medicationKind === MedicationKind.PRN || spec.timesPerDay === 0) return;

  const cycleDays = 28;
  const dosesPerDay = Math.max(1, spec.timesPerDay);
  const quantity = dosesPerDay * cycleDays;
  const deliveredAt = monthBase;
  const runsOutDate = addDaysUtc(monthBase, cycleDays - 1);

  const profile = await prisma.medicationSupplyProfile.upsert({
    where: { serviceUserMedicationId: medId },
    create: {
      serviceUserMedicationId: medId,
      supplyModel: MedicationSupplyModel.PRESCRIPTION_QTY,
      defaultQty: quantity,
      qtyUnit: spec.dose.toLowerCase().includes('injection') ? 'doses' : 'tabs',
      cycleDays,
      createdById: userId ?? undefined,
      updatedById: userId ?? undefined,
    },
    update: {
      defaultQty: quantity,
      qtyUnit: spec.dose.toLowerCase().includes('injection') ? 'doses' : 'tabs',
      updatedById: userId ?? undefined,
    },
  });

  const existing = await prisma.medicationSupplyDelivery.findFirst({
    where: {
      serviceUserMedicationId: medId,
      deliveredAt,
      deletedAt: null,
    },
  });

  const payload = {
    quantity,
    runsOutDate,
    cycleEndDate: runsOutDate,
    pharmacyName: 'Demo Pharmacy',
    notes: 'MAR calendar demo supply',
    receivedById: userId ?? undefined,
    updatedById: userId ?? undefined,
  };

  if (existing) {
    await prisma.medicationSupplyDelivery.update({
      where: { id: existing.id },
      data: payload,
    });
    return;
  }

  await prisma.medicationSupplyDelivery.create({
    data: {
      serviceUserId: SERVICE_USER_ID,
      serviceUserMedicationId: medId,
      supplyProfileId: profile.id,
      deliveredAt,
      ...payload,
      createdById: userId ?? undefined,
    },
  });
  console.log(`  + supply ${quantity} units · runs out ${runsOutDate.toISOString().slice(0, 10)}`);
}

async function ensureNightRound() {
  let rounds = await prisma.medicationAdministrationRound.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: 'asc' }],
  });
  if (!rounds.some((r) => r.code === 'NIGHT')) {
    await prisma.medicationAdministrationRound.create({
      data: {
        name: 'Night',
        code: 'NIGHT',
        time: '22:00',
        windowStart: '20:00',
        windowEnd: '23:59',
        sortOrder: 5,
        isActive: true,
      },
    });
    rounds = await prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
    console.log('Created missing Night administration round');
  }
  return rounds;
}

async function ensureFrequency(code: string, name: string, timesPerDay: number | null) {
  return prisma.medicationFrequency.upsert({
    where: { code },
    update: { name, timesPerDay, isActive: true, deletedAt: null },
    create: { code, name, timesPerDay, isActive: true },
  });
}

async function resetServiceUserMedications(serviceUserId: string) {
  const now = new Date();
  const meds = await prisma.serviceUserMedication.findMany({
    where: { serviceUserId, deletedAt: null },
    select: { id: true, medicationName: true },
  });
  if (meds.length === 0) {
    console.log('Reset: no active medications to remove.');
    return;
  }
  const medIds = meds.map((m) => m.id);
  const [schedules, events] = await Promise.all([
    prisma.medicationSchedule.updateMany({
      where: { serviceUserMedicationId: { in: medIds }, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    }),
    prisma.medicationAdministrationEvent.updateMany({
      where: { serviceUserId, serviceUserMedicationId: { in: medIds }, deletedAt: null },
      data: { deletedAt: now, isActive: false },
    }),
  ]);
  const removed = await prisma.serviceUserMedication.updateMany({
    where: { id: { in: medIds } },
    data: { deletedAt: now, isActive: false },
  });
  console.log(
    `Reset: removed ${removed.count} medication(s), ${schedules.count} schedule(s), ${events.count} event(s).`,
  );
}

async function syncSchedules(
  medId: string,
  spec: DemoMedSpec,
  roundsByCode: Map<string, { id: string; time: string }>,
  scheduleStart: Date,
  frequencyId: string | undefined,
  userId: string | null,
) {
  if (spec.medicationKind === MedicationKind.PRN || spec.roundCodes.length === 0) return;

  const wantedRoundIds = spec.roundCodes
    .map((c) => roundsByCode.get(c)?.id)
    .filter((id): id is string => Boolean(id));

  const existing = await prisma.medicationSchedule.findMany({
    where: { serviceUserMedicationId: medId, deletedAt: null },
    include: { round: true },
  });
  const wantedSet = new Set(wantedRoundIds);

  for (const sch of existing) {
    if (sch.roundId && !wantedSet.has(sch.roundId)) {
      await prisma.medicationSchedule.update({
        where: { id: sch.id },
        data: { deletedAt: new Date(), deletedById: userId ?? undefined, isActive: false },
      });
    }
  }

  for (const code of spec.roundCodes) {
    const round = roundsByCode.get(code);
    if (!round) {
      console.warn(`  ! round ${code} not found`);
      continue;
    }
    const slotDose = spec.slotDosesByCode?.[code]?.trim() || spec.dose;
    const data = {
      dose: slotDose,
      dueTime: round.time.slice(0, 5),
      startDate: scheduleStart,
      frequencyId: frequencyId ?? undefined,
      frequencyText: spec.frequencyLabel,
      daysOfWeek: spec.daysOfWeek ?? [],
      isActive: true,
      updatedById: userId ?? undefined,
    };
    const existingSlot = await prisma.medicationSchedule.findFirst({
      where: { serviceUserMedicationId: medId, roundId: round.id, deletedAt: null },
    });
    if (existingSlot) {
      await prisma.medicationSchedule.update({ where: { id: existingSlot.id }, data });
    } else {
      await prisma.medicationSchedule.create({
        data: {
          serviceUserMedicationId: medId,
          roundId: round.id,
          ...data,
          createdById: userId ?? undefined,
        },
      });
      console.log(`  + ${code} @ ${round.time} → ${slotDose}`);
    }
  }
}

async function seedStatusShowcase(
  medId: string,
  scheduleId: string,
  roundId: string,
  spec: DemoMedSpec,
  monthBase: Date,
  routeName: string,
  userId: string | null,
) {
  const y = monthBase.getUTCFullYear();
  const m = monthBase.getUTCMonth();
  let added = 0;
  for (let i = 0; i < MAR_STATUS_SHOWCASE_CODES.length; i++) {
    const code = MAR_STATUS_SHOWCASE_CODES[i];
    const day = i + 1;
    const scheduled = new Date(Date.UTC(y, m, day, 8, 0, 0));
    const schedule = await prisma.medicationSchedule.findUnique({ where: { id: scheduleId } });
    const dup = await prisma.medicationAdministrationEvent.findFirst({
      where: { medicationScheduleId: scheduleId, scheduledDateTime: scheduled, deletedAt: null },
    });
    const payload = {
      status: statusCodeToAdministrationStatus(code),
      statusCode: code,
      doseSnapshot: schedule?.dose ?? spec.dose,
      reason: ['R', 'N', 'U', 'O', 'P', 'PCI'].includes(code) ? 'Demo seed' : undefined,
      // Showcase row is for status colours — mark exceptions as already reviewed.
      managerReviewedAt: ['R', 'N', 'U', 'O', 'P', 'PCI'].includes(code) ? new Date() : undefined,
      managerReviewNotes: ['R', 'N', 'U', 'O', 'P', 'PCI'].includes(code) ? 'Demo seed reviewed' : undefined,
    };
    if (dup) {
      await prisma.medicationAdministrationEvent.update({ where: { id: dup.id }, data: payload });
      continue;
    }
    await prisma.medicationAdministrationEvent.create({
      data: {
        serviceUserId: SERVICE_USER_ID,
        serviceUserMedicationId: medId,
        medicationScheduleId: scheduleId,
        roundId,
        ...payload,
        scheduledDateTime: scheduled,
        actualDateTime: new Date(Date.UTC(y, m, day, 8, 5, 0)),
        medicationNameSnapshot: spec.medicationName,
        routeNameSnapshot: routeName,
        createdById: userId ?? undefined,
        updatedById: userId ?? undefined,
      },
    });
    added++;
  }
  console.log(`  + ${added} status cells (${MAR_STATUS_SHOWCASE_CODES.join(', ')})`);
}

async function seedMorningGiven(
  medId: string,
  scheduleId: string,
  roundId: string,
  spec: DemoMedSpec,
  monthBase: Date,
  routeName: string,
  userId: string | null,
  days = 7,
) {
  const schedule = await prisma.medicationSchedule.findUnique({ where: { id: scheduleId } });
  const y = monthBase.getUTCFullYear();
  const m = monthBase.getUTCMonth();
  let added = 0;
  for (let day = 1; day <= days; day++) {
    const scheduled = new Date(Date.UTC(y, m, day, 8, 0, 0));
    const dup = await prisma.medicationAdministrationEvent.findFirst({
      where: { medicationScheduleId: scheduleId, scheduledDateTime: scheduled, deletedAt: null },
    });
    if (dup) continue;
    await prisma.medicationAdministrationEvent.create({
      data: {
        serviceUserId: SERVICE_USER_ID,
        serviceUserMedicationId: medId,
        medicationScheduleId: scheduleId,
        roundId,
        status: MedicationAdministrationStatus.GIVEN,
        statusCode: 'G',
        scheduledDateTime: scheduled,
        actualDateTime: new Date(Date.UTC(y, m, day, 8, 10, 0)),
        medicationNameSnapshot: spec.medicationName,
        doseSnapshot: schedule?.dose ?? spec.dose,
        doseGiven: spec.doseGivenOnRecord ?? schedule?.dose ?? spec.dose,
        routeNameSnapshot: routeName,
        createdById: userId ?? undefined,
        updatedById: userId ?? undefined,
      },
    });
    added++;
  }
  if (added > 0) console.log(`  + ${added} Given (morning, days 1–${days})`);
}

async function verifySeed(serviceUserId: string): Promise<boolean> {
  const errors: string[] = [];
  const meds = await prisma.serviceUserMedication.findMany({
    where: { serviceUserId, deletedAt: null, medicationName: { contains: '(demo)' } },
    include: {
      frequency: true,
      schedules: { where: { deletedAt: null }, include: { round: true } },
    },
  });

  const specByName = new Map(DEMO_MEDS.map((s) => [s.medicationName, s]));

  if (meds.length !== DEMO_MEDS.length) {
    errors.push(`Expected ${DEMO_MEDS.length} demo meds, found ${meds.length}`);
  }

  for (const med of meds) {
    const spec = specByName.get(med.medicationName);
    if (!spec) {
      errors.push(`Unexpected demo med: ${med.medicationName}`);
      continue;
    }
    const kind = spec.medicationKind ?? MedicationKind.REGULAR;
    if (med.medicationKind !== kind) {
      errors.push(`${med.medicationName}: kind ${med.medicationKind} ≠ ${kind}`);
    }
    if (kind === MedicationKind.PRN) {
      if (med.schedules.length > 0) errors.push(`${med.medicationName}: PRN must have 0 schedules`);
      continue;
    }
    if (med.schedules.length !== spec.roundCodes.length) {
      errors.push(
        `${med.medicationName}: ${med.schedules.length} schedules ≠ ${spec.roundCodes.length} rounds`,
      );
    }
    for (const sch of med.schedules) {
      if (!sch.dueTime) errors.push(`${med.medicationName}: schedule missing dueTime`);
      if (!sch.dose) errors.push(`${med.medicationName}: schedule missing dose`);
      if (!sch.roundId) errors.push(`${med.medicationName}: schedule missing roundId`);
      const code = sch.round?.code;
      if (code && spec.slotDosesByCode?.[code]) {
        if (sch.dose !== spec.slotDosesByCode[code]) {
          errors.push(
            `${med.medicationName} ${code}: dose "${sch.dose}" ≠ "${spec.slotDosesByCode[code]}"`,
          );
        }
      }
    }
    if (spec.timesPerDay >= 1 && med.frequency?.timesPerDay != null) {
      if (spec.timesPerDay <= 4 && med.frequency.timesPerDay !== spec.timesPerDay) {
        errors.push(
          `${med.medicationName}: frequency timesPerDay ${med.frequency.timesPerDay} ≠ ${spec.timesPerDay}`,
        );
      }
      if (spec.timesPerDay === 5 && med.frequency?.code !== 'FIVE_TIMES_DAILY') {
        errors.push(`${med.medicationName}: expected FIVE_TIMES_DAILY frequency`);
      }
    }
  }

  const showcase = meds.find((m) => m.medicationName === 'Atorvastatin — 2× daily (demo)');
  if (showcase) {
    const events = await prisma.medicationAdministrationEvent.count({
      where: {
        serviceUserMedicationId: showcase.id,
        deletedAt: null,
        statusCode: { in: [...MAR_STATUS_SHOWCASE_CODES] },
      },
    });
    if (events < MAR_STATUS_SHOWCASE_CODES.length) {
      errors.push(`Status showcase: ${events}/${MAR_STATUS_SHOWCASE_CODES.length} code events`);
    }
  }

  const totalRows = meds
    .filter((m) => m.medicationKind !== MedicationKind.PRN)
    .reduce((n, m) => n + m.schedules.length, 0);
  const prnRows = meds.filter((m) => m.medicationKind === MedicationKind.PRN).length;

  console.log('\n── Verification ──');
  if (errors.length === 0) {
    console.log(`OK: ${meds.length} medications, ${totalRows} schedule rows, ${prnRows} PRN row(s), no discrepancies.`);
    return true;
  }
  console.error('FAILED:');
  for (const e of errors) console.error(`  • ${e}`);
  return false;
}

async function main() {
  const su = await prisma.serviceUser.findFirst({
    where: { id: SERVICE_USER_ID, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, preferredName: true },
  });
  if (!su) {
    console.error('Service user not found:', SERVICE_USER_ID);
    process.exit(1);
  }
  const name = [su.firstName, su.lastName].filter(Boolean).join(' ') || su.preferredName || su.id;
  console.log('Service user:', name, su.id);

  if (RESET_FIRST || DELETE_ONLY) {
    await resetServiceUserMedications(SERVICE_USER_ID);
    if (DELETE_ONLY) return;
    console.log('');
  } else {
    const existingDemo = await prisma.serviceUserMedication.count({
      where: {
        serviceUserId: SERVICE_USER_ID,
        deletedAt: null,
        medicationName: { contains: '(demo)' },
      },
    });
    if (existingDemo > 0) {
      console.error(
        `Aborting: ${existingDemo} demo medication row(s) already exist for this service user.`,
      );
      console.error('Re-run with --reset to replace them, or use probe-duplicate-medications.ts --fix.');
      process.exit(1);
    }
  }

  await ensureFiveTimesDailyFrequency();
  const rounds = await ensureNightRound();
  const roundsByCode = new Map(rounds.map((r) => [r.code, { id: r.id, time: r.time }]));

  const route =
    (await prisma.medicationRoute.findFirst({
      where: { deletedAt: null, isActive: true, name: { contains: 'Oral', mode: 'insensitive' } },
    })) ??
    (await prisma.medicationRoute.findFirst({ where: { deletedAt: null, isActive: true } }));
  const routeName = route?.name ?? 'Oral';

  const medType = await prisma.medicationType.findFirst({
    where: { deletedAt: null, isActive: true },
  });
  const userId =
    (await prisma.user.findFirst({ where: { deletedAt: null, isActive: true }, orderBy: { createdAt: 'asc' } }))
      ?.id ?? null;

  const monthBase = monthStartUtc();

  for (const spec of DEMO_MEDS) {
    console.log(`\n▸ ${spec.medicationName}`);
    const frequency = await prisma.medicationFrequency.findFirst({
      where: { code: spec.frequencyCode, deletedAt: null, isActive: true },
    });
    const kind = spec.medicationKind ?? MedicationKind.REGULAR;
    const startDate = medStartDate(monthBase, spec.startDayOfMonth);

    const med = await prisma.serviceUserMedication.create({
      data: {
        serviceUserId: SERVICE_USER_ID,
        medicationName: spec.medicationName,
        strength: spec.strength,
        dose: spec.dose,
        startDate,
        medicationKind: kind,
        status: MedicationRecordStatus.ACTIVE,
        routeId: route?.id,
        medicationTypeId: medType?.id,
        frequencyId: frequency?.id,
        frequencyText: spec.frequencyLabel,
        instructions: spec.instructions,
        isControlledMedication: spec.isControlled ?? false,
        createdById: userId ?? undefined,
        updatedById: userId ?? undefined,
      },
    });

    await syncSchedules(med.id, spec, roundsByCode, startDate, frequency?.id, userId);
    await seedSupplyDelivery(med.id, spec, monthBase, userId);

    const morningRound = roundsByCode.get('MORNING');
    const morningSchedule = morningRound
      ? await prisma.medicationSchedule.findFirst({
          where: { serviceUserMedicationId: med.id, roundId: morningRound.id, deletedAt: null },
        })
      : null;

    if (spec.statusCodeShowcase && morningSchedule && morningRound) {
      await seedStatusShowcase(med.id, morningSchedule.id, morningRound.id, spec, monthBase, routeName, userId);
    }

    if (spec.sampleGivenMorning && morningSchedule && morningRound) {
      await seedMorningGiven(med.id, morningSchedule.id, morningRound.id, spec, monthBase, routeName, userId);
    }

    if (spec.prnGivenDay && kind === MedicationKind.PRN) {
      const y = monthBase.getUTCFullYear();
      const m = monthBase.getUTCMonth();
      const scheduled = new Date(Date.UTC(y, m, spec.prnGivenDay, 12, 0, 0));
      await prisma.medicationAdministrationEvent.create({
        data: {
          serviceUserId: SERVICE_USER_ID,
          serviceUserMedicationId: med.id,
          status: MedicationAdministrationStatus.GIVEN,
          statusCode: 'G',
          isPrn: true,
          scheduledDateTime: scheduled,
          actualDateTime: scheduled,
          medicationNameSnapshot: spec.medicationName,
          doseSnapshot: spec.dose,
          doseGiven: '15ml',
          routeNameSnapshot: routeName,
          prnReason: 'Heartburn',
          createdById: userId ?? undefined,
          updatedById: userId ?? undefined,
        },
      });
      console.log(`  + PRN Given on day ${spec.prnGivenDay}`);
    }
  }

  const ok = await verifySeed(SERVICE_USER_ID);
  if (!ok) process.exit(1);

  console.log(
    `\nhttp://localhost:5173/service-users/${SERVICE_USER_ID}/medication?view=calendar`,
  );
}

async function ensureFiveTimesDailyFrequency() {
  await ensureFrequency('FIVE_TIMES_DAILY', 'Five times daily', 5);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
