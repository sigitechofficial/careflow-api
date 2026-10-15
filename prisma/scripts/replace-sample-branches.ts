/**
 * One-off: replace the seeded SAMPLE branches (Croydon 1–5, Merton, Haringey, Bexley, Greenwich,
 * Croydon Transport …) with the client's REAL organisation + 5 CQC-registered branches.
 *
 * Removes (hard delete — sample postcodes are unique org-wide and would block real ones):
 *   - scheduling.ServiceUserAreaPostcode + ServiceUserArea under sample branches
 *   - scheduling.ScheduleArea sample branches (by seeded code / sample Location)
 *   - lookups.Location sample labels ("Croydon - Croydon 1", "Greenwich council - Greenwich", …)
 *   - lookups.Zone generic demo city zones not used by a real branch + legacy label zones
 * Then converges identity.CompanyProfile, OrganisationGeneralSettings.timezone and the 5 real
 * branches to the client spec (seedAllforCareOrganisation with overwrite).
 *
 * Refuses to apply if ANY row (people, visits, schedules, access scopes, billing cards, policies,
 * learning, incidents …) still references a sample branch / area / zone. Everything runs in one
 * transaction.
 *
 * Usage (DATABASE_URL must point at the target database):
 *   npx ts-node --transpile-only prisma/scripts/replace-sample-branches.ts            # dry run (default)
 *   npx ts-node --transpile-only prisma/scripts/replace-sample-branches.ts --apply    # make the change
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  LEGACY_SAMPLE_ZONE_NAMES,
  SAMPLE_CITY_ZONES,
  SAMPLE_LOCATION_NAMES,
  SAMPLE_SCHEDULE_AREA_CODES,
} from '../seeds/schedule-areas.seed';
import { seedCompanyProfile } from '../seeds/company-profile.seed';
import { seedOrganisationGeneralSettings } from '../seeds/organisation-general-settings.seed';
import {
  seedAllforCareOrganisation,
  type AllforCareSeedChange,
} from '../seeds/allforcare-branches.seed';
import {
  ALLFOR_CARE_BRANCHES,
  ALLFOR_CARE_ZONES,
} from '../seed-data/allforcare-organisation';

type Db = PrismaClient | Prisma.TransactionClient;

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

type SampleSet = {
  locations: Array<{ id: string; name: string }>;
  scheduleAreas: Array<{ id: string; code: string; name: string }>;
  serviceUserAreas: Array<{ id: string; name: string; scheduleAreaId: string }>;
  postcodeCount: number;
  zones: Array<{ id: string; name: string; deleted: boolean }>;
};

type Blocker = { label: string; count: number };

function describeTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '(DATABASE_URL not parseable)';
  }
}

async function findSampleSet(db: Db): Promise<SampleSet> {
  const realCqcIds = ALLFOR_CARE_BRANCHES.map((b) => b.cqcLocationId);
  const locations = await db.location.findMany({
    where: { name: { in: [...SAMPLE_LOCATION_NAMES] } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const locationIds = locations.map((l) => l.id);
  const scheduleAreas = await db.scheduleArea.findMany({
    where: {
      OR: [
        { code: { in: [...SAMPLE_SCHEDULE_AREA_CODES] } },
        ...(locationIds.length ? [{ locationId: { in: locationIds } }] : []),
      ],
      AND: [
        {
          OR: [
            { cqcLocationId: null },
            { cqcLocationId: { notIn: realCqcIds } },
          ],
        },
      ],
    },
    select: { id: true, code: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  const areaIds = scheduleAreas.map((a) => a.id);
  const serviceUserAreas = areaIds.length
    ? await db.serviceUserArea.findMany({
        where: { scheduleAreaId: { in: areaIds } },
        select: { id: true, name: true, scheduleAreaId: true },
        orderBy: { name: 'asc' },
      })
    : [];
  const postcodeCount = serviceUserAreas.length
    ? await db.serviceUserAreaPostcode.count({
        where: { serviceUserAreaId: { in: serviceUserAreas.map((a) => a.id) } },
      })
    : 0;

  const keepZones = new Set(ALLFOR_CARE_ZONES.map((z) => z.name));
  const zoneNames = [
    ...LEGACY_SAMPLE_ZONE_NAMES,
    ...SAMPLE_CITY_ZONES.map((z) => z.name).filter((n) => !keepZones.has(n)),
  ];
  const zones = (
    await db.zone.findMany({
      where: { name: { in: zoneNames } },
      select: { id: true, name: true, deletedAt: true },
      orderBy: { name: 'asc' },
    })
  ).map((z) => ({ id: z.id, name: z.name, deleted: z.deletedAt !== null }));

  return { locations, scheduleAreas, serviceUserAreas, postcodeCount, zones };
}

/** Every row that would be orphaned, cascaded or silently unlinked by removing the sample set. */
async function findBlockers(db: Db, s: SampleSet): Promise<Blocker[]> {
  const loc = s.locations.map((l) => l.id);
  const area = s.scheduleAreas.map((a) => a.id);
  const sua = s.serviceUserAreas.map((a) => a.id);
  const zone = s.zones.map((z) => z.id);
  const inLoc = { in: loc };
  const checks: Array<[string, () => Promise<number>]> = [
    [
      'ServiceUser.locationId',
      () => db.serviceUser.count({ where: { locationId: inLoc } }),
    ],
    [
      'ServiceUser.serviceUserAreaId',
      () => db.serviceUser.count({ where: { serviceUserAreaId: { in: sua } } }),
    ],
    [
      'ServiceUserAssignment.locationId',
      () => db.serviceUserAssignment.count({ where: { locationId: inLoc } }),
    ],
    [
      'EmployeeEmployment.locationId',
      () => db.employeeEmployment.count({ where: { locationId: inLoc } }),
    ],
    [
      'EmployeeEmployment.baseLocationId',
      () => db.employeeEmployment.count({ where: { baseLocationId: inLoc } }),
    ],
    [
      'EmployeeEmploymentFloorLocation',
      () =>
        db.employeeEmploymentFloorLocation.count({
          where: { locationId: inLoc },
        }),
    ],
    [
      'EmployeeEmploymentServiceUserArea',
      () =>
        db.employeeEmploymentServiceUserArea.count({
          where: { serviceUserAreaId: { in: sua } },
        }),
    ],
    [
      'UserLocation (office-user branch scope)',
      () => db.userLocation.count({ where: { locationId: inLoc } }),
    ],
    [
      'Vacancy.locationId',
      () => db.vacancy.count({ where: { locationId: inLoc } }),
    ],
    [
      'ComplianceRequirement.locationId',
      () => db.complianceRequirement.count({ where: { locationId: inLoc } }),
    ],
    [
      'ComplianceRequirement.zoneId',
      () => db.complianceRequirement.count({ where: { zoneId: { in: zone } } }),
    ],
    [
      'PolicyApplicability.locationId',
      () => db.policyApplicability.count({ where: { locationId: inLoc } }),
    ],
    [
      'PolicyAudience.locationId',
      () => db.policyAudience.count({ where: { locationId: inLoc } }),
    ],
    [
      'Incident.locationId',
      () => db.incident.count({ where: { locationId: inLoc } }),
    ],
    [
      'LearningAssignment.locationId',
      () => db.learningAssignment.count({ where: { locationId: inLoc } }),
    ],
    [
      'LearningAssignmentRule.locationId',
      () => db.learningAssignmentRule.count({ where: { locationId: inLoc } }),
    ],
    [
      'LearningPathway.targetLocationId',
      () => db.learningPathway.count({ where: { targetLocationId: inLoc } }),
    ],
    [
      'PayCard.assignmentTargetId',
      () => db.payCard.count({ where: { assignmentTargetId: inLoc } }),
    ],
    [
      'ChargeCard.assignmentTargetId',
      () => db.chargeCard.count({ where: { assignmentTargetId: inLoc } }),
    ],
    [
      'ScheduleAreaStatus (schedule builds)',
      () =>
        db.scheduleAreaStatus.count({
          where: { scheduleAreaId: { in: area } },
        }),
    ],
    [
      'ScheduleRun.scheduleAreaId',
      () => db.scheduleRun.count({ where: { scheduleAreaId: { in: area } } }),
    ],
    [
      'ScheduledJob.scheduleAreaId (visits)',
      () => db.scheduledJob.count({ where: { scheduleAreaId: { in: area } } }),
    ],
    [
      'ScheduleArea.zoneId (non-sample branch in a zone being removed)',
      () =>
        db.scheduleArea.count({
          where: { zoneId: { in: zone }, id: { notIn: area } },
        }),
    ],
    [
      'OrganisationGeneralSettings.domLateVisitZoneAlerts → sample branch',
      async () => {
        const rows = await db.organisationGeneralSettings.findMany({
          select: { domLateVisitZoneAlerts: true },
        });
        const ids = new Set(area);
        let n = 0;
        for (const row of rows) {
          const alerts = Array.isArray(row.domLateVisitZoneAlerts)
            ? row.domLateVisitZoneAlerts
            : [];
          for (const a of alerts) {
            const id =
              a && typeof a === 'object' && !Array.isArray(a)
                ? (a as Record<string, unknown>).scheduleAreaId
                : null;
            if (typeof id === 'string' && ids.has(id)) n += 1;
          }
        }
        return n;
      },
    ],
  ];
  const out: Blocker[] = [];
  for (const [label, fn] of checks) out.push({ label, count: await fn() });
  return out;
}

async function otherBranches(db: Db, s: SampleSet) {
  const realCqcIds = ALLFOR_CARE_BRANCHES.map((b) => b.cqcLocationId);
  const sampleIds = s.scheduleAreas.map((a) => a.id);
  const areas = await db.scheduleArea.findMany({
    where: {
      id: { notIn: sampleIds },
      OR: [{ cqcLocationId: null }, { cqcLocationId: { notIn: realCqcIds } }],
    },
    select: { code: true, name: true, deletedAt: true },
  });
  const sampleLocIds = s.locations.map((l) => l.id);
  const realNames = ALLFOR_CARE_BRANCHES.map((b) => b.name);
  const locations = await db.location.findMany({
    where: { id: { notIn: sampleLocIds }, name: { notIn: realNames } },
    select: { name: true, deletedAt: true },
  });
  return { areas, locations };
}

async function globalCounts(db: Db) {
  const [users, employees, serviceUsers, scheduledJobs] = await Promise.all([
    db.user.count(),
    db.employee.count(),
    db.serviceUser.count(),
    db.scheduledJob.count(),
  ]);
  return { users, employees, serviceUsers, scheduledJobs };
}

function printChanges(changes: AllforCareSeedChange[]) {
  for (const c of changes) {
    const fields = c.fields.length ? ` [${c.fields.join(', ')}]` : '';
    const note = c.note ? ` — ${c.note}` : '';
    console.log(
      `  ${c.action.toUpperCase().padEnd(9)} ${c.entity} ${c.key}${note}${fields}`,
    );
  }
}

async function removeSampleSet(tx: Prisma.TransactionClient, s: SampleSet) {
  const suaIds = s.serviceUserAreas.map((a) => a.id);
  const areaIds = s.scheduleAreas.map((a) => a.id);
  const locIds = s.locations.map((l) => l.id);
  const zoneIds = s.zones.map((z) => z.id);
  const postcodes = await tx.serviceUserAreaPostcode.deleteMany({
    where: { serviceUserAreaId: { in: suaIds } },
  });
  const suas = await tx.serviceUserArea.deleteMany({
    where: { id: { in: suaIds } },
  });
  const areas = await tx.scheduleArea.deleteMany({
    where: { id: { in: areaIds } },
  });
  const locs = await tx.location.deleteMany({ where: { id: { in: locIds } } });
  const zones = await tx.zone.deleteMany({ where: { id: { in: zoneIds } } });
  return {
    postcodes: postcodes.count,
    serviceUserAreas: suas.count,
    scheduleAreas: areas.count,
    locations: locs.count,
    zones: zones.count,
  };
}

async function main() {
  console.log(
    `=== replace-sample-branches (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`,
  );
  console.log(`Target database: ${describeTarget()}`);
  console.log('Global counts:', await globalCounts(prisma));

  const sample = await findSampleSet(prisma);
  console.log('\n-- Sample data that will be DELETED --');
  console.log(
    `  lookups.Location (${sample.locations.length}): ${sample.locations.map((l) => l.name).join(' | ') || '-'}`,
  );
  console.log(
    `  scheduling.ScheduleArea (${sample.scheduleAreas.length}): ${sample.scheduleAreas.map((a) => `${a.name} [${a.code}]`).join(' | ') || '-'}`,
  );
  console.log(
    `  scheduling.ServiceUserArea (${sample.serviceUserAreas.length}): ${sample.serviceUserAreas.map((a) => a.name).join(' | ') || '-'}`,
  );
  console.log(`  scheduling.ServiceUserAreaPostcode: ${sample.postcodeCount}`);
  console.log(
    `  lookups.Zone (${sample.zones.length}): ${sample.zones.map((z) => `${z.name}${z.deleted ? ' (soft-deleted)' : ''}`).join(' | ') || '-'}`,
  );

  const others = await otherBranches(prisma, sample);
  console.log('\n-- Left untouched (not sample, not the real branches) --');
  console.log(
    `  ScheduleArea: ${others.areas.map((a) => `${a.name} [${a.code}]${a.deletedAt ? ' (deleted)' : ''}`).join(' | ') || '-'}`,
  );
  console.log(
    `  Location: ${others.locations.map((l) => `${l.name}${l.deletedAt ? ' (deleted)' : ''}`).join(' | ') || '-'}`,
  );

  const blockers = await findBlockers(prisma, sample);
  const blocking = blockers.filter((b) => b.count > 0);
  console.log('\n-- Dependency check (must all be 0) --');
  for (const b of blockers)
    console.log(`  ${b.count > 0 ? 'BLOCK' : 'ok   '} ${b.label}: ${b.count}`);

  console.log('\n-- Real organisation / branches (converge to client spec) --');
  const plan = await seedAllforCareOrganisation(prisma, {
    overwrite: true,
    alignTimezone: true,
    dryRun: true,
  });
  printChanges(plan);

  if (blocking.length) {
    console.error(
      `\nREFUSING: ${blocking.length} dependency check(s) failed — real data references sample branches. Reassign it first.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!APPLY) {
    console.log(
      '\nDry run only — nothing changed. Re-run with --apply to make these changes.',
    );
    return;
  }

  // Singletons normally exist already; create them (create-only upserts) if this DB never had them.
  if (!(await prisma.companyProfile.count())) await seedCompanyProfile(prisma);
  if (!(await prisma.organisationGeneralSettings.count()))
    await seedOrganisationGeneralSettings(prisma);

  const result = await prisma.$transaction(
    async (tx) => {
      const fresh = await findSampleSet(tx);
      const lateBlockers = (await findBlockers(tx, fresh)).filter(
        (b) => b.count > 0,
      );
      if (lateBlockers.length) {
        throw new Error(
          `Dependencies appeared since the check: ${lateBlockers.map((b) => b.label).join(', ')}`,
        );
      }
      const deleted = await removeSampleSet(tx, fresh);
      const changes = await seedAllforCareOrganisation(tx, {
        overwrite: true,
        alignTimezone: true,
      });
      return { deleted, changes };
    },
    {
      timeout: 120_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  console.log('\n-- Applied --');
  console.log('  Deleted:', result.deleted);
  printChanges(result.changes);
  const after = await findSampleSet(prisma);
  console.log(
    `  Remaining sample rows: locations=${after.locations.length} scheduleAreas=${after.scheduleAreas.length} serviceUserAreas=${after.serviceUserAreas.length} postcodes=${after.postcodeCount} zones=${after.zones.length}`,
  );
  console.log(
    `  Real branches: ${await prisma.scheduleArea.count({ where: { cqcLocationId: { in: ALLFOR_CARE_BRANCHES.map((b) => b.cqcLocationId) } } })}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
