/**
 * CARE employee-app QA visits (Flutter E2E).
 *
 * Seeds 4 rich, unchecked-in visits for the test carer so Home / Schedule /
 * Visit Workspace (Overview, Tasks, MAR, Obs, Log) + clock-in/out can be tested
 * without admin UI entry.
 *
 * Usage:
 *   npm run seed:employee-app-qa
 *   npm run seed:employee-app-qa -- --reset
 *   QA_CARER_EMAIL=ema@gmail.com QA_SUPPORT_CARER_EMAIL=employee1@gmail.com npm run seed:employee-app-qa
 *
 * Env:
 *   QA_CARER_EMAIL          default ema@gmail.com
 *   QA_SUPPORT_CARER_EMAIL  default employee1@gmail.com (Visit B co-carer)
 */

import {
  AllocationStatus,
  InitialAssessmentRiskLevel,
  InitialAssessmentRiskStatus,
  InitialAssessmentRiskType,
  FlashMessageStatus,
  InitialAssessmentStatus,
  MedicationKind,
  MedicationPackStatus,
  MedicationRecordStatus,
  Prisma,
  PrismaClient,
  ScheduleStatus,
  ScheduledJobPriority,
  ScheduledJobStatus,
  ScheduledVisitStatus,
  VisitPlanScheduleFrequency,
  VisitPlanSlotKind,
  VisitPlanStatus,
} from '@prisma/client';

const META_FLAG = 'qaEmployeeAppSeed';
const SEED_VERSION = 'CARE_EMP_QA_V1';
const SU_PREFIX = 'SU-QA-EMP-';

type VisitLetter = 'A' | 'B' | 'C' | 'D';

type TaskSeed = {
  catalogueName: string;
  /** Create catalogue task if missing (e.g. Medication prompt). */
  createIfMissing?: boolean;
  priority: 'required' | 'optional';
  instructions: string;
};

type MedSeed = {
  name: string;
  dose: string;
  strength: string;
  kind: 'REGULAR' | 'PRN';
  dueTime?: string;
  instructions?: string;
  isControlled?: boolean;
  timeCritical?: boolean;
  /** Substring match against allergy names for allergyWarning. */
  allergyNameHint?: string;
};

type ClientSeed = {
  number: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  dob: string;
  nhsNumber: string;
  allergies: string[];
  lat: number;
  lng: number;
  addressLine1: string;
  town: string;
  postcode: string;
  keySafe: string;
  accessInstructions: string;
  medicalHistory: string;
  careInstructions: string;
  riskTypes: InitialAssessmentRiskType[];
  flashMessage?: string;
};

type VisitDef = {
  letter: VisitLetter;
  purpose: string;
  dayOffset: 0 | 1;
  startHm: string;
  endHm: string;
  visitName: string;
  roundCode: 'MORNING' | 'MIDDAY' | 'AFTERNOON';
  slotCode: string;
  requiredCarers: number;
  clientKey: 'margaret' | 'dorothy' | 'harold';
  medicationRequired: boolean;
  timeCriticalSlot?: boolean;
  priority?: ScheduledJobPriority;
  tasks: TaskSeed[];
  meds: MedSeed[];
  onHomeToday: boolean;
  scheduleDates: string[];
};

function parseArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return arg?.split('=')[1]?.trim() || undefined;
}

function utcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateOnly(d);
}

function isoWindow(dayIso: string, startHm: string, endHm: string): { start: Date; end: Date } {
  const start = new Date(`${dayIso}T${startHm}:00.000Z`);
  const end = new Date(`${dayIso}T${endHm}:00.000Z`);
  return { start, end };
}

function weekdayInt(dayIso: string): number {
  return new Date(`${dayIso}T12:00:00.000Z`).getUTCDay();
}

async function main() {
  const reset = process.argv.includes('--reset') || process.argv.includes('--force');
  const carerEmail = (process.env.QA_CARER_EMAIL || parseArg('--carer') || 'ema@gmail.com')
    .trim()
    .toLowerCase();
  const supportEmail = (
    process.env.QA_SUPPORT_CARER_EMAIL ||
    parseArg('--support') ||
    'employee1@gmail.com'
  )
    .trim()
    .toLowerCase();

  const prisma = new PrismaClient();
  const today = utcDateOnly(new Date());
  const tomorrow = addDaysIso(today, 1);

  const clients: Record<VisitDef['clientKey'], ClientSeed> = {
    margaret: {
      number: `${SU_PREFIX}MARGARET`,
      firstName: 'Margaret',
      lastName: 'Ellison',
      preferredName: 'Maggie',
      dob: '1942-03-14',
      nhsNumber: '943 476 5919',
      allergies: ['Penicillin', 'Latex'],
      lat: 31.4639,
      lng: 74.2425,
      addressLine1: '14 Birch Close',
      town: 'Croydon',
      postcode: 'CR0 2AB',
      keySafe: '4821',
      accessInstructions: 'Key safe left of porch. Dog is friendly — leave in kitchen.',
      medicalHistory: 'Hypertension; osteoarthritis; history of falls (2024).',
      careInstructions:
        'Prefers female carer for personal care. Speaks clearly; hearing aids in morning. Falls risk — use walking frame.',
      riskTypes: [InitialAssessmentRiskType.FALLS, InitialAssessmentRiskType.SKIN_INTEGRITY],
      flashMessage: 'Family visiting Sunday — leave living room tidy; check hearing aids charged.',
    },
    dorothy: {
      number: `${SU_PREFIX}DOROTHY`,
      firstName: 'Dorothy',
      lastName: 'Whitmore',
      preferredName: 'Dot',
      dob: '1938-11-02',
      nhsNumber: '701 234 8891',
      allergies: ['Aspirin', 'Shellfish', 'Ibuprofen'],
      lat: 31.4639,
      lng: 74.2425,
      addressLine1: '7 Parkview Court',
      town: 'Croydon',
      postcode: 'CR0 4TX',
      keySafe: '9910',
      accessInstructions: 'Buzzer 7. Hoist stored in bedroom cupboard. Two carers required for transfers.',
      medicalHistory: 'CVA residual weakness; pressure ulcer risk; swallow soft diet.',
      careInstructions:
        'Double-up for all transfers. Time-critical midday meds. Strong allergy to Aspirin — check eMAR warnings.',
      riskTypes: [
        InitialAssessmentRiskType.MOVING_HANDLING,
        InitialAssessmentRiskType.SKIN_INTEGRITY,
        InitialAssessmentRiskType.MEDICATION,
      ],
      flashMessage: 'District nurse wound review tomorrow — photograph only if instructed.',
    },
    harold: {
      number: `${SU_PREFIX}HAROLD`,
      firstName: 'Harold',
      lastName: 'Benson',
      preferredName: 'Harry',
      dob: '1955-07-22',
      nhsNumber: '485 102 3370',
      allergies: ['Codeine'],
      lat: 31.4639,
      lng: 74.2425,
      addressLine1: '22 Green Lane',
      town: 'Croydon',
      postcode: 'CR2 6NQ',
      keySafe: '3307',
      accessInstructions: 'Side gate unlocked. Glucometer on kitchen table.',
      medicalHistory: 'Type 2 diabetes; recurrent falls; COPD (mild).',
      careInstructions:
        'Falls risk + diabetes — record BP, temp, SpO2, blood sugar each afternoon visit. Escalate hypo protocol if BM <4.',
      riskTypes: [InitialAssessmentRiskType.FALLS, InitialAssessmentRiskType.NUTRITION],
      flashMessage: 'GP increased metformin yesterday — watch for GI upset; encourage fluids.',
    },
  };

  const visits: VisitDef[] = [
    {
      letter: 'A',
      purpose: 'Personal care happy path — tasks + light MAR + BP',
      dayOffset: 0,
      startHm: '07:00',
      endHm: '10:00',
      visitName: 'Morning',
      roundCode: 'MORNING',
      slotCode: 'QA_MORNING',
      requiredCarers: 1,
      clientKey: 'margaret',
      medicationRequired: true,
      onHomeToday: true,
      scheduleDates: [today],
      tasks: [
        {
          catalogueName: 'Assisted wash',
          priority: 'required',
          instructions:
            'Wash & dress. Checklist: wash face/hands; wash underarms; apply moisturiser to dry areas; choose day clothes; dentures if worn.',
        },
        {
          catalogueName: 'Pad / continence-product change',
          priority: 'required',
          instructions:
            'Continence care. Checklist: check pad dryness; change if wet/soiled; cleanse skin; apply barrier cream; dispose clinically.',
        },
        {
          catalogueName: 'Meal prep',
          priority: 'required',
          instructions: 'Support breakfast — porridge or toast per preference; sit upright; encourage full glass of water.',
        },
        {
          catalogueName: 'Medication prompt',
          createIfMissing: true,
          priority: 'required',
          instructions: 'Prompt & supervise morning medicines on eMAR. Do not leave tablets unattended.',
        },
        {
          catalogueName: 'Blood pressure',
          priority: 'required',
          instructions: 'Record seated BP after 5 minutes rest. Link to Obs tab (BLOOD_PRESSURE).',
        },
        {
          catalogueName: 'Light tidying of care environment',
          priority: 'optional',
          instructions: 'Quick tidy of bedroom and bathroom after personal care.',
        },
        {
          catalogueName: 'Encourage fluids',
          priority: 'optional',
          instructions: 'Offer preferred drink; record approximate intake if declined/partial.',
        },
      ],
      meds: [
        {
          name: 'Amlodipine',
          dose: '1 tablet',
          strength: '5mg',
          kind: 'REGULAR',
          dueTime: '08:00',
          instructions: 'Morning with breakfast.',
        },
        {
          name: 'Omeprazole',
          dose: '1 capsule',
          strength: '20mg',
          kind: 'REGULAR',
          dueTime: '08:00',
          instructions: '30 minutes before food if possible.',
        },
      ],
    },
    {
      letter: 'B',
      purpose: 'Double-up + rich eMAR (scheduled + PRN)',
      dayOffset: 0,
      startHm: '12:00',
      endHm: '14:00',
      visitName: 'Midday',
      roundCode: 'MIDDAY',
      slotCode: 'QA_MIDDAY',
      requiredCarers: 2,
      clientKey: 'dorothy',
      medicationRequired: true,
      timeCriticalSlot: true,
      priority: ScheduledJobPriority.HIGH,
      onHomeToday: true,
      scheduleDates: [today],
      tasks: [
        {
          catalogueName: 'Hoist use',
          priority: 'required',
          instructions:
            'Two-person hoist transfer bed ↔ chair. Checklist: sling size correct; brakes on; second carer present; check skin under straps; document any redness.',
        },
        {
          catalogueName: 'Check pressure areas',
          priority: 'required',
          instructions:
            'Skin / pressure check. Checklist: sacrum; heels; hips; elbows; document blanching or broken skin.',
        },
        {
          catalogueName: 'Medication prompt',
          createIfMissing: true,
          priority: 'required',
          instructions: 'Complete full midday eMAR round including time-critical and controlled doses.',
        },
        {
          catalogueName: 'Pain scale',
          priority: 'required',
          instructions: 'Ask 0–10 pain score (Obs PAIN / pain_score).',
        },
        {
          catalogueName: 'Encourage fluids',
          priority: 'optional',
          instructions: 'Reassure and update family contact if Dot asks — note in visit log.',
        },
      ],
      meds: [
        {
          name: 'Levodopa / Carbidopa',
          dose: '1 tablet',
          strength: '100/25mg',
          kind: 'REGULAR',
          dueTime: '12:00',
          instructions: 'Time-critical — give within window.',
          timeCritical: true,
        },
        {
          name: 'Aspirin dispersible',
          dose: '1 tablet',
          strength: '75mg',
          kind: 'REGULAR',
          dueTime: '12:00',
          instructions: 'ALLERGY WARNING — do not give; document outcome on MAR.',
          allergyNameHint: 'Aspirin',
        },
        {
          name: 'Morphine sulphate MR',
          dose: '1 tablet',
          strength: '10mg',
          kind: 'REGULAR',
          dueTime: '12:00',
          instructions: 'Controlled drug — dual check with co-carer.',
          isControlled: true,
        },
        {
          name: 'Senna',
          dose: '2 tablets',
          strength: '7.5mg',
          kind: 'REGULAR',
          dueTime: '12:00',
          instructions: 'With midday meal.',
        },
        {
          name: 'Furosemide',
          dose: '1 tablet',
          strength: '20mg',
          kind: 'REGULAR',
          dueTime: '08:00',
          instructions: 'Morning dose — may show as overdue at midday if not previously recorded.',
          timeCritical: true,
        },
        {
          name: 'Paracetamol',
          dose: '1–2 tablets',
          strength: '500mg',
          kind: 'PRN',
          instructions: 'PRN for pain. Max 8 tablets/24h. Min interval 4 hours. Soft diet only.',
        },
        {
          name: 'Lorazepam',
          dose: '0.5–1 mg',
          strength: '1mg',
          kind: 'PRN',
          instructions: 'PRN for severe anxiety/agitation. Controlled. Max 2mg/24h. Min interval 6 hours.',
          isControlled: true,
        },
      ],
    },
    {
      letter: 'C',
      purpose: 'Obs-heavy clinical afternoon',
      dayOffset: 0,
      startHm: '16:00',
      endHm: '18:00',
      visitName: 'Afternoon',
      roundCode: 'AFTERNOON',
      slotCode: 'QA_AFTERNOON',
      requiredCarers: 1,
      clientKey: 'harold',
      medicationRequired: true,
      onHomeToday: true,
      scheduleDates: [today],
      tasks: [
        {
          catalogueName: 'Blood pressure',
          priority: 'required',
          instructions: 'Record BP (Obs BLOOD_PRESSURE). Note if unable — use unableReasons.',
        },
        {
          catalogueName: 'Blood glucose reading',
          priority: 'required',
          instructions: 'Capillary BM before tea (Obs BLOOD_SUGAR). Escalate if <4 or >15.',
        },
        {
          catalogueName: 'Meal prep',
          priority: 'required',
          instructions: 'Support light tea — carbohydrate aware; encourage fluids.',
        },
        {
          catalogueName: 'Fluid intake recording',
          priority: 'optional',
          instructions: 'Optional fluid monitor entry if drinks taken.',
        },
      ],
      meds: [
        {
          name: 'Metformin',
          dose: '1 tablet',
          strength: '500mg',
          kind: 'REGULAR',
          dueTime: '16:00',
          instructions: 'With afternoon meal.',
        },
        {
          name: 'Paracetamol',
          dose: '1–2 tablets',
          strength: '500mg',
          kind: 'PRN',
          instructions: 'PRN analgesia. Max 8/24h. Avoid if recent dose <4h.',
        },
      ],
    },
    {
      letter: 'D',
      purpose: 'Tomorrow schedule edge case',
      dayOffset: 1,
      startHm: '08:00',
      endHm: '10:00',
      visitName: 'Morning',
      roundCode: 'MORNING',
      slotCode: 'QA_TOMORROW_AM',
      requiredCarers: 1,
      // Separate client from Visit A so MORNING task/med assignments do not collide.
      clientKey: 'harold',
      medicationRequired: true,
      onHomeToday: false,
      scheduleDates: [tomorrow],
      tasks: [
        {
          catalogueName: 'Assisted wash',
          priority: 'required',
          instructions: 'Morning wash & dress. Checklist: face/hands; underarms; moisturise; day clothes.',
        },
        {
          catalogueName: 'Blood pressure',
          priority: 'required',
          instructions: 'Record BP (Obs BLOOD_PRESSURE). Also expect TEMPERATURE via Obs catalog.',
        },
        {
          catalogueName: 'Medication prompt',
          createIfMissing: true,
          priority: 'required',
          instructions: 'Morning eMAR prompt.',
        },
      ],
      meds: [
        {
          name: 'Metformin',
          dose: '1 tablet',
          strength: '500mg',
          kind: 'REGULAR',
          dueTime: '08:00',
          instructions: 'Morning dose with breakfast.',
        },
        {
          name: 'Paracetamol',
          dose: '1–2 tablets',
          strength: '500mg',
          kind: 'PRN',
          instructions: 'PRN for joint pain. Max 8/24h.',
        },
      ],
    },
  ];

  try {
    const lead = await prisma.employeePortalAccount.findFirst({
      where: { email: { equals: carerEmail, mode: 'insensitive' }, deletedAt: null },
      select: {
        id: true,
        email: true,
        employeeId: true,
        employee: { select: { personalDetail: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!lead) {
      throw new Error(`Test carer portal account not found for email=${carerEmail}`);
    }

    const support = await prisma.employeePortalAccount.findFirst({
      where: { email: { equals: supportEmail, mode: 'insensitive' }, deletedAt: null },
      select: {
        email: true,
        employeeId: true,
        employee: { select: { personalDetail: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!support) {
      throw new Error(`Support carer portal account not found for email=${supportEmail}`);
    }

    const area = await prisma.scheduleArea.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true },
    });

    const rounds = await prisma.medicationAdministrationRound.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true },
    });
    const roundByCode = new Map(rounds.map((r) => [r.code, r]));

    const routeOral = await prisma.medicationRoute.findFirst({
      where: { deletedAt: null, OR: [{ code: 'ORAL' }, { name: { equals: 'Oral', mode: 'insensitive' } }] },
      select: { id: true },
    });

    const iaTemplate = await prisma.initialAssessmentTemplate.findFirst({
      where: { deletedAt: null },
      select: { id: true },
    });

    console.log(`[seed:employee-app-qa] carer=${lead.email} employeeId=${lead.employeeId}`);
    console.log(`[seed:employee-app-qa] support=${support.email} employeeId=${support.employeeId}`);
    console.log(`[seed:employee-app-qa] today=${today} tomorrow=${tomorrow} reset=${reset}`);

    if (reset) {
      const prior = await prisma.scheduledJob.findMany({
        where: {
          deletedAt: null,
          OR: [
            { metadata: { path: [META_FLAG], equals: true } },
            { jobName: { startsWith: 'QA-EMP-' } },
          ],
        },
        select: { id: true },
      });
      if (prior.length) {
        await prisma.scheduledJob.deleteMany({ where: { id: { in: prior.map((j) => j.id) } } });
        console.log(`[seed:employee-app-qa] reset removed ${prior.length} prior QA jobs`);
      }
    } else {
      const existing = await prisma.scheduledJob.count({
        where: { deletedAt: null, metadata: { path: [META_FLAG], equals: true } },
      });
      if (existing > 0) {
        console.log(
          `[seed:employee-app-qa] ${existing} QA jobs already present — re-running upserts (use --reset to wipe jobs first)`,
        );
      }
    }

    // Ensure Medication prompt catalogue task exists (eMAR linkTab via name match).
    let medPromptCategoryId =
      (
        await prisma.taskCatalogueTask.findFirst({
          where: { name: 'Blood pressure', deletedAt: null },
          select: { categoryId: true },
        })
      )?.categoryId ?? null;
    if (!medPromptCategoryId) {
      const anyTask = await prisma.taskCatalogueTask.findFirst({
        where: { deletedAt: null, isActive: true },
        select: { categoryId: true },
      });
      medPromptCategoryId = anyTask?.categoryId ?? null;
    }
    if (medPromptCategoryId) {
      const existingPrompt = await prisma.taskCatalogueTask.findFirst({
        where: { name: 'Medication prompt', deletedAt: null },
        select: { id: true },
      });
      if (!existingPrompt) {
        await prisma.taskCatalogueTask.create({
          data: {
            categoryId: medPromptCategoryId,
            name: 'Medication prompt',
            sortOrder: 900,
            supportLevelApplicable: true,
            consentRequired: false,
            flagsJson: { feedsObservation: [], qaSeed: true } as Prisma.InputJsonValue,
            isActive: true,
          },
        });
        console.log('[seed:employee-app-qa] created catalogue task "Medication prompt"');
      }
    }

    const catalogueByName = new Map<string, string>();
    const neededNames = [...new Set(visits.flatMap((v) => v.tasks.map((t) => t.catalogueName)))];
    const catalogueRows = await prisma.taskCatalogueTask.findMany({
      where: { deletedAt: null, isActive: true, name: { in: neededNames } },
      select: { id: true, name: true },
    });
    for (const row of catalogueRows) catalogueByName.set(row.name, row.id);

    // Double-up QA (Visit B): flag hoist / pressure tasks as two-person for Support clock-out gate.
    const twoPersonCatalogueNames = ['Hoist use', 'Check pressure areas'];
    await prisma.taskCatalogueTask.updateMany({
      where: { deletedAt: null, isActive: true, name: { in: twoPersonCatalogueNames } },
      data: { requiresMultipleCarers: true },
    });

    const clientIds: Record<string, string> = {};
    for (const [key, c] of Object.entries(clients) as Array<[VisitDef['clientKey'], ClientSeed]>) {
      const su = await upsertClient(prisma, c, iaTemplate?.id ?? null);
      clientIds[key] = su.id;
      console.log(`[seed:employee-app-qa] client ${key}=${su.id} (${c.firstName} ${c.lastName})`);
    }

    const summary: Array<Record<string, string | boolean>> = [];

    for (const def of visits) {
      const dayIso = def.dayOffset === 0 ? today : tomorrow;
      const { start, end } = isoWindow(dayIso, def.startHm, def.endHm);
      const suId = clientIds[def.clientKey];
      const client = clients[def.clientKey];
      const round = roundByCode.get(def.roundCode);
      if (!round) throw new Error(`Missing medication round ${def.roundCode}`);

      const plan = await ensureVisitPlan(prisma, suId, def);
      const slot = await ensureSlot(prisma, plan.id, def, dayIso);

      await syncTasks(prisma, suId, def.roundCode, def.tasks, catalogueByName);
      await syncMeds(prisma, suId, def, round.id, routeOral?.id ?? null);

      const batch = await ensureBatch(prisma, dayIso);
      const jobName = `QA-EMP-${def.letter} ${def.visitName} — ${client.firstName} ${client.lastName}`;

      // Idempotent: one job per letter+day for this seed version.
      let job = await prisma.scheduledJob.findFirst({
        where: {
          deletedAt: null,
          metadata: {
            path: ['qaVisitLetter'],
            equals: def.letter,
          },
          AND: [
            { metadata: { path: [META_FLAG], equals: true } },
            { metadata: { path: ['qaSeedDay'], equals: dayIso } },
          ],
        },
        include: { visits: { where: { deletedAt: null }, take: 1 } },
      });

      const addressLine = [client.addressLine1, client.town, client.postcode].filter(Boolean).join(', ');
      const meta: Prisma.InputJsonValue = {
        [META_FLAG]: true,
        qaSeedVersion: SEED_VERSION,
        qaVisitLetter: def.letter,
        qaSeedDay: dayIso,
        purpose: def.purpose,
        onHomeToday: def.onHomeToday,
        intendedGeofenceRadiusMeters: 10000,
        employeeApp: {
          lastHandover: {
            message:
              def.letter === 'A'
                ? 'Maggie slept well; used frame to bathroom overnight. Please confirm hearing aids in.'
                : def.letter === 'B'
                  ? 'Hoist sling checked yesterday — green tag OK. Skin intact on sacrum.'
                  : def.letter === 'C'
                    ? 'BM 7.1 at lunch; ate well. Watch afternoon readings.'
                    : 'Tomorrow AM: check key safe batteries if slow to open.',
            requiresAck: true,
            badgeLabel: 'Handover',
            acknowledged: false,
          },
        },
      };

      if (!job) {
        job = await prisma.scheduledJob.create({
          data: {
            scheduleBatchId: batch.id,
            scheduleAreaId: area?.id ?? null,
            serviceUserId: suId,
            jobName,
            description: def.purpose,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            estimatedDurationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
            requiredCarers: def.requiredCarers,
            priority: def.priority ?? ScheduledJobPriority.NORMAL,
            status: ScheduledJobStatus.ALLOCATED,
            postcode: client.postcode,
            address: addressLine,
            latitude: client.lat,
            longitude: client.lng,
            notes: `QA seed ${SEED_VERSION} visit ${def.letter}`,
            metadata: meta,
            isActive: true,
            visits: {
              create: {
                serviceUserId: suId,
                visitName: def.visitName,
                scheduledStartDateTime: start,
                scheduledEndDateTime: end,
                status: ScheduledVisitStatus.PLANNED,
                requiredCarers: def.requiredCarers,
                medicationRequired: def.medicationRequired,
                checklistRequired: true,
                notesRequired: def.letter === 'A',
                visitPlanSlotId: slot.id,
                isActive: true,
              },
            },
          },
          include: { visits: { where: { deletedAt: null }, take: 1 } },
        });
      } else {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            jobName,
            description: def.purpose,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            estimatedDurationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
            requiredCarers: def.requiredCarers,
            priority: def.priority ?? ScheduledJobPriority.NORMAL,
            status: ScheduledJobStatus.ALLOCATED,
            postcode: client.postcode,
            address: addressLine,
            latitude: client.lat,
            longitude: client.lng,
            metadata: meta,
            isActive: true,
          },
        });
        const visit = job.visits[0];
        if (visit) {
          await prisma.scheduledVisit.update({
            where: { id: visit.id },
            data: {
              visitName: def.visitName,
              scheduledStartDateTime: start,
              scheduledEndDateTime: end,
              status: ScheduledVisitStatus.PLANNED,
              actualStartDateTime: null,
              actualEndDateTime: null,
              requiredCarers: def.requiredCarers,
              medicationRequired: def.medicationRequired,
              visitPlanSlotId: slot.id,
              isActive: true,
            },
          });
        }
        job = await prisma.scheduledJob.findUniqueOrThrow({
          where: { id: job.id },
          include: { visits: { where: { deletedAt: null }, take: 1 } },
        });
      }

      const visit = job.visits[0];
      if (!visit) throw new Error(`Visit missing for job ${job.id}`);

      // Clear any prior attendance / task completions so QA can clock in fresh.
      await prisma.visitAttendanceEvent.deleteMany({ where: { scheduledJobId: job.id } });
      await prisma.scheduledVisitTaskCompletion.deleteMany({ where: { scheduledJobId: job.id } });
      await prisma.jobAllocation.deleteMany({ where: { scheduledJobId: job.id } });

      await prisma.jobAllocation.create({
        data: {
          scheduledJobId: job.id,
          scheduledVisitId: visit.id,
          employeeId: lead.employeeId,
          status: AllocationStatus.CONFIRMED,
          requiresConfirmation: false,
          isLeadCarer: true,
          scheduledStartDateTime: start,
          scheduledEndDateTime: end,
          durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
          isActive: true,
        },
      });

      if (def.requiredCarers >= 2) {
        await prisma.jobAllocation.create({
          data: {
            scheduledJobId: job.id,
            scheduledVisitId: visit.id,
            employeeId: support.employeeId,
            status: AllocationStatus.CONFIRMED,
            requiresConfirmation: false,
            isLeadCarer: false,
            scheduledStartDateTime: start,
            scheduledEndDateTime: end,
            durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
            isActive: true,
          },
        });
      }

      summary.push({
        visit: def.letter,
        jobId: job.id,
        visitId: visit.id,
        clientId: suId,
        clientName: `${client.firstName} ${client.lastName}`,
        date: dayIso,
        windowIso: `${start.toISOString()} → ${end.toISOString()}`,
        purpose: def.purpose,
        onHome: def.onHomeToday,
        scheduleDates: def.scheduleDates.join(', '),
      });
    }

    console.log('\n=== QA VISIT SUMMARY ===');
    console.table(summary);
    console.log('\nGaps / notes printed after verification in agent response.');
    console.log(
      JSON.stringify(
        {
          carerEmail: lead.email,
          employeeId: lead.employeeId,
          portalAccountId: lead.id,
          today,
          tomorrow,
          visits: summary,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function upsertClient(
  prisma: PrismaClient,
  c: ClientSeed,
  iaTemplateId: string | null,
) {
  let su = await prisma.serviceUser.findFirst({
    where: { serviceUserNumber: c.number, deletedAt: null },
  });
  if (!su) {
    su = await prisma.serviceUser.create({
      data: {
        serviceUserNumber: c.number,
        firstName: c.firstName,
        lastName: c.lastName,
        preferredName: c.preferredName ?? null,
        dateOfBirth: new Date(`${c.dob}T00:00:00.000Z`),
        nhsNumber: c.nhsNumber,
        isActive: true,
        notes: `QA employee-app seed ${SEED_VERSION}`,
      },
    });
  } else {
    su = await prisma.serviceUser.update({
      where: { id: su.id },
      data: {
        firstName: c.firstName,
        lastName: c.lastName,
        preferredName: c.preferredName ?? null,
        dateOfBirth: new Date(`${c.dob}T00:00:00.000Z`),
        nhsNumber: c.nhsNumber,
        isActive: true,
      },
    });
  }

  const existingAddr = await prisma.serviceUserAddress.findUnique({ where: { serviceUserId: su.id } });
  const addrData = {
    addressLine1: c.addressLine1,
    town: c.town,
    country: 'United Kingdom',
    postcode: c.postcode,
    latitude: c.lat,
    longitude: c.lng,
    accessInstructions: c.accessInstructions,
    keySafeNumber: c.keySafe,
    isActive: true,
    deletedAt: null,
  };
  if (existingAddr) {
    await prisma.serviceUserAddress.update({ where: { id: existingAddr.id }, data: addrData });
  } else {
    await prisma.serviceUserAddress.create({ data: { serviceUserId: su.id, ...addrData } });
  }

  for (const allergyName of c.allergies) {
    const existing = await prisma.serviceUserAllergy.findFirst({
      where: { serviceUserId: su.id, allergyName, deletedAt: null },
    });
    if (!existing) {
      await prisma.serviceUserAllergy.create({
        data: {
          serviceUserId: su.id,
          allergyName,
          comment: 'QA seed documented allergy',
          isActive: true,
        },
      });
    }
    const medAllergy = await prisma.medicationAllergy.findFirst({
      where: { serviceUserId: su.id, allergyName, deletedAt: null },
    });
    if (!medAllergy) {
      await prisma.medicationAllergy.create({
        data: {
          serviceUserId: su.id,
          allergyName,
          severity: 'High',
          reaction: 'Documented allergy — check eMAR warnings',
          notes: 'QA seed',
          isActive: true,
        },
      });
    }
  }

  const ia = await prisma.serviceUserInitialAssessment.findUnique({ where: { serviceUserId: su.id } });
  const iaData = {
    previousMedicalHistory: c.medicalHistory,
    careInstructions: c.careInstructions,
    accessInstruction: c.accessInstructions,
    accessRisks: c.riskTypes.join(', '),
    isActive: true,
    deletedAt: null,
  };
  if (ia) {
    await prisma.serviceUserInitialAssessment.update({ where: { id: ia.id }, data: iaData });
  } else {
    await prisma.serviceUserInitialAssessment.create({
      data: { serviceUserId: su.id, numberOfCarers: 1, ...iaData },
    });
  }

  if (c.flashMessage) {
    await prisma.serviceUserFlashMessage.updateMany({
      where: { serviceUserId: su.id, isCurrent: true, deletedAt: null },
      data: {
        isCurrent: false,
        status: FlashMessageStatus.CLEARED,
        clearedAt: new Date(),
      },
    });
    await prisma.serviceUserFlashMessage.create({
      data: {
        serviceUserId: su.id,
        message: c.flashMessage,
        displayUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: FlashMessageStatus.ACTIVE,
        isCurrent: true,
        isActive: true,
      },
    });
  }

  if (iaTemplateId && c.riskTypes.length) {
    let submission = await prisma.initialAssessmentSubmission.findFirst({
      where: {
        serviceUserId: su.id,
        deletedAt: null,
        metadata: { path: [META_FLAG], equals: true },
      },
      select: { id: true },
    });
    if (!submission) {
      submission = await prisma.initialAssessmentSubmission.create({
        data: {
          serviceUserId: su.id,
          templateId: iaTemplateId,
          status: InitialAssessmentStatus.SUBMITTED,
          completedAt: new Date(),
          submittedAt: new Date(),
          overallNotes: 'QA employee-app seed submission for risk flags',
          metadata: { [META_FLAG]: true, qaSeedVersion: SEED_VERSION } as Prisma.InputJsonValue,
          isActive: true,
        },
        select: { id: true },
      });
    }

    for (const riskType of c.riskTypes) {
      const existingRisk = await prisma.initialAssessmentRiskRecord.findFirst({
        where: {
          serviceUserId: su.id,
          submissionId: submission.id,
          riskType,
          status: InitialAssessmentRiskStatus.OPEN,
        },
      });
      if (!existingRisk) {
        await prisma.initialAssessmentRiskRecord.create({
          data: {
            submissionId: submission.id,
            serviceUserId: su.id,
            riskType,
            description: `QA seed open risk: ${riskType}`,
            likelihood: InitialAssessmentRiskLevel.MEDIUM,
            severity: InitialAssessmentRiskLevel.HIGH,
            riskLevel: InitialAssessmentRiskLevel.HIGH,
            controlMeasures: 'Follow care plan and visit workspace flags.',
            status: InitialAssessmentRiskStatus.OPEN,
            autoGenerated: true,
          },
        });
      }
    }
  }

  return su;
}

async function ensureVisitPlan(prisma: PrismaClient, serviceUserId: string, def: VisitDef) {
  let plan = await prisma.serviceUserVisitPlan.findFirst({
    where: { serviceUserId, status: VisitPlanStatus.ACTIVE, deletedAt: null },
  });
  if (!plan) {
    plan = await prisma.serviceUserVisitPlan.create({
      data: {
        serviceUserId,
        status: VisitPlanStatus.ACTIVE,
        effectiveFrom: new Date(),
        numberOfCarers: def.requiredCarers,
        notes: `QA employee-app seed ${SEED_VERSION}`,
        approvedAt: new Date(),
        isActive: true,
      },
    });
  } else if (def.requiredCarers > plan.numberOfCarers) {
    plan = await prisma.serviceUserVisitPlan.update({
      where: { id: plan.id },
      data: { numberOfCarers: def.requiredCarers },
    });
  }
  return plan;
}

async function ensureSlot(
  prisma: PrismaClient,
  visitPlanId: string,
  def: VisitDef,
  dayIso: string,
) {
  const dow = weekdayInt(dayIso);
  const data = {
    daysOfWeek: [dow],
    plannedStartTime: def.startHm,
    plannedEndTime: def.endHm,
    requiredCarers: def.requiredCarers,
    isEnabled: true,
    medicationRoundCode: def.roundCode,
    notes: `QA seed slot ${def.letter}`,
    sortOrder: def.letter.charCodeAt(0),
    scheduleFrequency: VisitPlanScheduleFrequency.WEEKLY,
    timeCritical: Boolean(def.timeCriticalSlot),
    timeToleranceMinutes: 15,
    slotKind: VisitPlanSlotKind.STANDARD,
    durationMinutes: undefined as number | undefined,
    isActive: true,
  };
  data.durationMinutes =
    (new Date(`${dayIso}T${def.endHm}:00.000Z`).getTime() -
      new Date(`${dayIso}T${def.startHm}:00.000Z`).getTime()) /
    60_000;

  return prisma.visitPlanSlot.upsert({
    where: { visitPlanId_slotCode: { visitPlanId, slotCode: def.slotCode } },
    update: data,
    create: {
      visitPlanId,
      slotCode: def.slotCode,
      ...data,
    },
  });
}

async function syncTasks(
  prisma: PrismaClient,
  serviceUserId: string,
  roundCode: string,
  tasks: TaskSeed[],
  catalogueByName: Map<string, string>,
) {
  let sort = 0;
  for (const t of tasks) {
    const taskId = catalogueByName.get(t.catalogueName);
    if (!taskId) {
      console.warn(`[seed:employee-app-qa] missing catalogue task "${t.catalogueName}" — skipped`);
      continue;
    }
    const existing = await prisma.serviceUserVisitTaskAssignment.findFirst({
      where: {
        serviceUserId,
        medicationRoundCode: roundCode,
        taskCatalogueTaskId: taskId,
      },
    });
    const payload = {
      sortOrder: sort++,
      carerInstructions: t.instructions,
      priority: t.priority === 'optional' ? 'optional' : 'required',
      isActive: true,
      deletedAt: null,
    };
    if (existing) {
      await prisma.serviceUserVisitTaskAssignment.update({
        where: { id: existing.id },
        data: payload,
      });
    } else {
      await prisma.serviceUserVisitTaskAssignment.create({
        data: {
          serviceUserId,
          medicationRoundCode: roundCode,
          taskCatalogueTaskId: taskId,
          ...payload,
        },
      });
    }
  }
}

async function syncMeds(
  prisma: PrismaClient,
  serviceUserId: string,
  def: VisitDef,
  roundId: string,
  routeId: string | null,
) {
  // Soft-delete prior QA meds for this client+letter tag via notes marker, then recreate clean set.
  const marker = `QA-EMP-${def.letter}`;
  const prior = await prisma.serviceUserMedication.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      notes: { contains: marker },
    },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.medicationSchedule.updateMany({
      where: { serviceUserMedicationId: { in: prior.map((m) => m.id) } },
      data: { deletedAt: new Date(), isActive: false },
    });
    await prisma.serviceUserMedication.updateMany({
      where: { id: { in: prior.map((m) => m.id) } },
      data: { deletedAt: new Date(), isActive: false, status: MedicationRecordStatus.ENDED },
    });
  }

  for (const med of def.meds) {
    let packId: string | null = null;
    if (med.timeCritical) {
      const pack = await prisma.medicationPack.create({
        data: {
          serviceUserId,
          name: `${marker} pack — ${med.name}`,
          description: 'QA time-critical adminRules',
          status: MedicationPackStatus.ACTIVE,
          adminRules: { timeCritical: true, covert: false } as Prisma.InputJsonValue,
          isActive: true,
        },
      });
      packId = pack.id;
    }

    const created = await prisma.serviceUserMedication.create({
      data: {
        serviceUserId,
        medicationPackId: packId,
        medicationName: med.name,
        dose: med.dose,
        strength: med.strength,
        routeId,
        instructions: med.instructions ?? null,
        notes: `${marker} ${SEED_VERSION}`,
        medicationKind: med.kind === 'PRN' ? MedicationKind.PRN : MedicationKind.REGULAR,
        status: MedicationRecordStatus.ACTIVE,
        isControlledMedication: Boolean(med.isControlled),
        isActive: true,
        startDate: new Date(),
      },
    });

    if (med.kind === 'REGULAR') {
      await prisma.medicationSchedule.create({
        data: {
          serviceUserMedicationId: created.id,
          roundId,
          dueTime: med.dueTime ?? def.startHm,
          dose: med.dose,
          instructions: med.instructions ?? null,
          isActive: true,
        },
      });
    }
  }
}

async function ensureBatch(prisma: PrismaClient, dayIso: string) {
  const scheduleDate = new Date(`${dayIso}T00:00:00.000Z`);
  let batch = await prisma.scheduleBatch.findFirst({
    where: { scheduleDate, deletedAt: null, isActive: true },
  });
  if (!batch) {
    batch = await prisma.scheduleBatch.create({
      data: {
        scheduleDate,
        name: `QA Emp App ${dayIso}`,
        status: ScheduleStatus.BUILT,
        buildSource: 'MANUAL',
        metadata: { [META_FLAG]: true, qaSeedVersion: SEED_VERSION } as Prisma.InputJsonValue,
        isActive: true,
      },
    });
  }
  return batch;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
