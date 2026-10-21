/**
 * Real organisation (CompanyProfile singleton) + CQC-registered branches (ScheduleArea + Location)
 * for Allfor Care Services Limited. Reference data: runs in every environment, including the
 * Azure production seed path, on every deploy.
 *
 * Idempotent. Branches are keyed by cqcLocationId (fallback: our own ScheduleArea.code).
 * Default mode only CREATES missing rows and FILLS blank fields, so edits made later in the
 * admin site are never reverted by a deploy. `overwrite: true` (used once by
 * prisma/scripts/replace-sample-branches.ts) converges existing rows to the spec. A null spec
 * value means "unknown" and never clears an existing value.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ALLFOR_CARE_BRANCHES,
  ALLFOR_CARE_ORGANISATION,
  ALLFOR_CARE_ZONES,
  formatBranchAddress,
  type AllforCareBranchSeed,
} from '../seed-data/allforcare-organisation';

type Db = PrismaClient | Prisma.TransactionClient;

const COMPANY_PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const GENERAL_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';
/** Schema default of OrganisationGeneralSettings.timezone (dev team default, not the client's). */
const DEV_DEFAULT_TIMEZONE = 'Asia/Karachi';

export type AllforCareSeedOptions = {
  /** Replace values that differ from the spec (one-off convergence). Default: fill blanks only. */
  overwrite?: boolean;
  /** Set OrganisationGeneralSettings.timezone to Europe/London while it is still Asia/Karachi. */
  alignTimezone?: boolean;
  /** Plan only — no writes. */
  dryRun?: boolean;
};

export type AllforCareSeedChange = {
  entity:
    | 'CompanyProfile'
    | 'OrganisationGeneralSettings'
    | 'Zone'
    | 'Location'
    | 'ScheduleArea';
  key: string;
  action: 'create' | 'update' | 'unchanged' | 'skipped';
  fields: string[];
  note?: string;
};

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function comparable(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function toDate(ymd: string | null): Date | null {
  return ymd ? new Date(`${ymd}T00:00:00.000Z`) : null;
}

/** Fields to write: blanks are filled; differing values are replaced only when overwriting. */
function diffFields(
  existing: Record<string, unknown>,
  desired: Record<string, unknown>,
  overwrite: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (isBlank(value)) continue; // unknown in the spec: never clear what is there
    const current = existing[key];
    if (comparable(current) === comparable(value)) continue;
    if (overwrite || isBlank(current)) out[key] = value;
  }
  return out;
}

function branchData(b: AllforCareBranchSeed) {
  return {
    name: b.name,
    officialCqcName: b.officialCqcName,
    address: formatBranchAddress(b),
    addressLine1: b.addressLine1,
    addressLine2: b.addressLine2,
    town: b.town,
    county: b.county,
    postcode: b.postcode,
    country: b.country,
    countryCode: b.countryCode,
    localAuthority: b.localAuthority,
    phone: b.phone,
    email: b.email,
    website: b.website,
    serviceTypes: b.serviceTypes,
    regulatedActivities: b.regulatedActivities,
    registeredManagers: b.registeredManagers,
    nominatedIndividual: b.nominatedIndividual,
    cqcRegistrationDate: toDate(b.cqcRegistrationDate),
    cqcRating: b.cqcRating,
    cqcRatingStatus: b.cqcRatingStatus,
    status: b.status,
    timezone: b.timezone,
    currency: b.currency,
    locale: b.locale,
  };
}

async function ensureZone(
  db: Db,
  name: string,
  dryRun: boolean,
  changes: AllforCareSeedChange[],
): Promise<string | null> {
  const def = ALLFOR_CARE_ZONES.find((z) => z.name === name);
  const existing = await db.zone.findUnique({ where: { name } });
  if (existing) return existing.id;
  changes.push({
    entity: 'Zone',
    key: name,
    action: 'create',
    fields: ['name', 'country', 'city'],
  });
  if (dryRun) return null;
  const created = await db.zone.create({
    data: {
      name,
      country: def?.country ?? null,
      city: def?.city ?? null,
      isActive: true,
    },
  });
  return created.id;
}

async function ensureLocation(
  db: Db,
  name: string,
  overwrite: boolean,
  dryRun: boolean,
  changes: AllforCareSeedChange[],
): Promise<string | null> {
  const existing = await db.location.findUnique({ where: { name } });
  if (existing) {
    const inactive = !existing.isActive || existing.deletedAt !== null;
    if (overwrite && inactive) {
      changes.push({
        entity: 'Location',
        key: name,
        action: 'update',
        fields: ['isActive', 'deletedAt'],
      });
      if (!dryRun) {
        await db.location.update({
          where: { id: existing.id },
          data: { isActive: true, deletedAt: null },
        });
      }
    }
    return existing.id;
  }
  changes.push({
    entity: 'Location',
    key: name,
    action: 'create',
    fields: ['name'],
  });
  if (dryRun) return null;
  const created = await db.location.create({ data: { name, isActive: true } });
  return created.id;
}

async function seedOrganisation(
  db: Db,
  opts: Required<AllforCareSeedOptions>,
  changes: AllforCareSeedChange[],
) {
  const org = ALLFOR_CARE_ORGANISATION;
  const row = await db.companyProfile.findUnique({
    where: { id: COMPANY_PROFILE_ID },
  });
  if (!row) {
    // seedCompanyProfile() creates the singleton first in prisma/seed.ts; the replace script does too.
    changes.push({
      entity: 'CompanyProfile',
      key: COMPANY_PROFILE_ID,
      action: 'skipped',
      fields: [],
      note: 'singleton missing — run seedCompanyProfile first',
    });
    return;
  }
  const desired: Record<string, unknown> = {
    companyName: org.companyName,
    displayName: org.displayName,
    legalName: org.legalName,
    companyNumber: org.companyNumber,
    cqcProviderId: org.cqcProviderId,
    companyStatus: org.companyStatus,
    companyType: org.companyType,
    incorporationDate: toDate(org.incorporationDate),
    sicCodes: [...org.sicCodes],
    registeredAddressLine1: org.registeredAddressLine1,
    registeredAddressLine2: org.registeredAddressLine2,
    registeredTown: org.registeredTown,
    registeredCounty: org.registeredCounty,
    registeredPostcode: org.registeredPostcode,
    registeredCountry: org.registeredCountry,
    countryCode: org.countryCode,
    currency: org.currency,
    locale: org.locale,
    companyWebsite: org.companyWebsite,
  };
  const data = diffFields(
    row as unknown as Record<string, unknown>,
    desired,
    opts.overwrite,
  );
  const fields = Object.keys(data);
  changes.push({
    entity: 'CompanyProfile',
    key: COMPANY_PROFILE_ID,
    action: fields.length ? 'update' : 'unchanged',
    fields,
  });
  if (fields.length && !opts.dryRun) {
    await db.companyProfile.update({
      where: { id: COMPANY_PROFILE_ID },
      data: data as Prisma.CompanyProfileUpdateInput,
    });
  }

  const settings = await db.organisationGeneralSettings.findUnique({
    where: { id: GENERAL_SETTINGS_ID },
    select: { timezone: true },
  });
  const wantTz = org.timezone;
  const alignTz =
    settings &&
    settings.timezone !== wantTz &&
    (opts.overwrite ||
      (opts.alignTimezone && settings.timezone === DEV_DEFAULT_TIMEZONE));
  changes.push({
    entity: 'OrganisationGeneralSettings',
    key: 'timezone',
    action: alignTz ? 'update' : settings ? 'unchanged' : 'skipped',
    fields: alignTz ? ['timezone'] : [],
    note: settings
      ? `${settings.timezone}${alignTz ? ` -> ${wantTz}` : ''}`
      : 'settings row missing',
  });
  if (alignTz && !opts.dryRun) {
    await db.organisationGeneralSettings.update({
      where: { id: GENERAL_SETTINGS_ID },
      data: { timezone: wantTz },
    });
  }
}

async function seedBranch(
  db: Db,
  b: AllforCareBranchSeed,
  opts: Required<AllforCareSeedOptions>,
  changes: AllforCareSeedChange[],
) {
  const existing =
    (await db.scheduleArea.findUnique({
      where: { cqcLocationId: b.cqcLocationId },
    })) ??
    (await db.scheduleArea.findFirst({
      where: { code: b.code, cqcLocationId: null },
    }));

  // Never resurrect a branch someone deleted in the admin site, except when converging on purpose.
  if (existing && existing.deletedAt && !opts.overwrite) {
    changes.push({
      entity: 'ScheduleArea',
      key: b.cqcLocationId,
      action: 'skipped',
      fields: [],
      note: 'soft-deleted',
    });
    return;
  }

  const zoneId =
    existing?.zoneId && !opts.overwrite
      ? existing.zoneId
      : await ensureZone(db, b.zoneName, opts.dryRun, changes);
  const locationId =
    existing?.locationId && !opts.overwrite
      ? existing.locationId
      : await ensureLocation(db, b.name, opts.overwrite, opts.dryRun, changes);

  const visitRefOwner = await db.scheduleArea.findFirst({
    where: {
      visitRefCode: b.visitRefCode,
      ...(existing ? { id: { not: existing.id } } : {}),
    },
    select: { code: true },
  });
  const visitRefCode = visitRefOwner ? null : b.visitRefCode;
  const visitRefNote = visitRefOwner
    ? `visitRefCode ${b.visitRefCode} already used by ${visitRefOwner.code}; left unset`
    : undefined;

  const desired: Record<string, unknown> = {
    ...branchData(b),
    cqcLocationId: b.cqcLocationId,
    visitRefCode,
    zoneId,
    locationId,
    parentZoneName: b.zoneName,
    sortOrder: b.sortOrder,
  };

  if (!existing) {
    changes.push({
      entity: 'ScheduleArea',
      key: b.cqcLocationId,
      action: 'create',
      fields: Object.keys(desired).filter((k) => !isBlank(desired[k])),
      note: [b.name, visitRefNote].filter(Boolean).join('; '),
    });
    if (opts.dryRun) return;
    await db.scheduleArea.create({
      data: {
        ...(desired as Omit<Prisma.ScheduleAreaUncheckedCreateInput, 'code'>),
        code: b.code,
        isActive: true,
      },
    });
    return;
  }

  const data = diffFields(
    existing as unknown as Record<string, unknown>,
    desired,
    opts.overwrite,
  );
  if (opts.overwrite && (!existing.isActive || existing.deletedAt)) {
    data.isActive = true;
    data.deletedAt = null;
  }
  const fields = Object.keys(data);
  changes.push({
    entity: 'ScheduleArea',
    key: b.cqcLocationId,
    action: fields.length ? 'update' : 'unchanged',
    fields,
    note: [b.name, visitRefNote].filter(Boolean).join('; '),
  });
  if (fields.length && !opts.dryRun) {
    await db.scheduleArea.update({
      where: { id: existing.id },
      data: data as Prisma.ScheduleAreaUncheckedUpdateInput,
    });
  }
}

export async function seedAllforCareOrganisation(
  db: Db,
  options: AllforCareSeedOptions = {},
): Promise<AllforCareSeedChange[]> {
  const opts: Required<AllforCareSeedOptions> = {
    overwrite: options.overwrite ?? false,
    alignTimezone: options.alignTimezone ?? false,
    dryRun: options.dryRun ?? false,
  };
  const changes: AllforCareSeedChange[] = [];
  await seedOrganisation(db, opts, changes);
  for (const branch of ALLFOR_CARE_BRANCHES) {
    await seedBranch(db, branch, opts, changes);
  }
  return changes;
}

export function summariseAllforCareChanges(
  changes: AllforCareSeedChange[],
): string {
  const counts = new Map<string, number>();
  for (const c of changes) {
    const key = `${c.entity}:${c.action}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(' ');
}
