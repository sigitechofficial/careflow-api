/**
 * Seed ServiceUserArea (+ postcodes) under every ScheduleArea branch.
 * Postcodes are real UK districts matched to each zone/branch.
 * Idempotent: upsert by (scheduleAreaId, code); replaces postcode list when re-run.
 */
import type { PrismaClient } from '@prisma/client';

type AreaDef = {
  name: string;
  code: string;
  description?: string;
  postcodes: string[];
};

/** Branch ScheduleArea.code → monitoring areas with UK postcodes. */
const AREAS_BY_BRANCH_CODE: Record<string, AreaDef[]> = {
  CROYDON_1: [
    {
      name: 'Central Croydon',
      code: 'CENTRAL',
      description: 'Town centre / East Croydon (CR0)',
      postcodes: ['CR0 1AA', 'CR0 1XP', 'CR0 2RF', 'CR0 1ET'],
    },
    {
      name: 'West Croydon',
      code: 'WEST',
      description: 'West Croydon / Broad Green (CR0)',
      postcodes: ['CR0 3AA', 'CR0 3RF', 'CR0 4YY', 'CR0 3TD'],
    },
  ],
  CROYDON_2: [
    {
      name: 'South Croydon',
      code: 'SOUTH',
      description: 'South Croydon (CR2)',
      postcodes: ['CR2 6XH', 'CR2 0AA', 'CR2 7AA', 'CR2 8YY'],
    },
    {
      name: 'Sanderstead',
      code: 'SANDERSTEAD',
      description: 'Sanderstead / Selsdon fringe (CR2)',
      postcodes: ['CR2 9AA', 'CR2 9JH', 'CR2 8AA'],
    },
  ],
  CROYDON_3: [
    {
      name: 'Thornton Heath',
      code: 'THORNTON',
      description: 'Thornton Heath (CR7)',
      postcodes: ['CR7 8AA', 'CR7 6AA', 'CR7 7RF', 'CR7 8XY'],
    },
    {
      name: 'Norbury fringe',
      code: 'NORBURY',
      description: 'Norbury border of Thornton Heath (CR7 / SW16 edge)',
      postcodes: ['CR7 8LE', 'CR7 7AA'],
    },
  ],
  CROYDON_4: [
    {
      name: 'Purley',
      code: 'PURLEY',
      description: 'Purley town (CR8)',
      postcodes: ['CR8 2AA', 'CR8 1AA', 'CR8 3RF', 'CR8 2YY'],
    },
    {
      name: 'Coulsdon',
      code: 'COULSDON',
      description: 'Coulsdon (CR5)',
      postcodes: ['CR5 2AA', 'CR5 1RF', 'CR5 3AA'],
    },
  ],
  CROYDON_5: [
    {
      name: 'South Norwood',
      code: 'S_NORWOOD',
      description: 'South Norwood (SE25)',
      postcodes: ['SE25 4AA', 'SE25 5RF', 'SE25 6AA', 'SE25 4XY'],
    },
    {
      name: 'Crystal Palace fringe',
      code: 'CRYSTAL',
      description: 'Crystal Palace / Upper Norwood (SE19)',
      postcodes: ['SE19 1AA', 'SE19 2RF', 'SE19 3AA'],
    },
  ],
  CROYDON_TRANSPORT: [
    {
      name: 'Transport depot',
      code: 'DEPOT',
      description: 'Croydon transport hub coverage (CR0)',
      postcodes: ['CR0 4AB', 'CR0 4RF', 'CR0 5AA'],
    },
  ],
  MERTON: [
    {
      name: 'Morden',
      code: 'MORDEN',
      description: 'Morden (SM4)',
      postcodes: ['SM4 5AA', 'SM4 4RF', 'SM4 6AA', 'SM4 5XY'],
    },
    {
      name: 'Mitcham',
      code: 'MITCHAM',
      description: 'Mitcham (CR4)',
      postcodes: ['CR4 4AA', 'CR4 3RF', 'CR4 2AA'],
    },
    {
      name: 'Wimbledon',
      code: 'WIMBLEDON',
      description: 'Wimbledon (SW19)',
      postcodes: ['SW19 1AA', 'SW19 2RF', 'SW19 8AA'],
    },
  ],
  HARINGEY: [
    {
      name: 'Tottenham',
      code: 'TOTTENHAM',
      description: 'Tottenham (N17)',
      postcodes: ['N17 0AA', 'N17 6RF', 'N17 9AA', 'N17 8XY'],
    },
    {
      name: 'Wood Green',
      code: 'WOOD_GREEN',
      description: 'Wood Green (N22)',
      postcodes: ['N22 6AA', 'N22 5RF', 'N22 8AA'],
    },
    {
      name: 'Hornsey',
      code: 'HORNSEY',
      description: 'Hornsey / Crouch End fringe (N8)',
      postcodes: ['N8 7AA', 'N8 9RF', 'N8 0AA'],
    },
  ],
  BEXLEY: [
    {
      name: 'Bexleyheath',
      code: 'BEXLEYHEATH',
      description: 'Bexleyheath (DA6 / DA7)',
      postcodes: ['DA6 7AA', 'DA7 4RF', 'DA7 5AA', 'DA6 8XY'],
    },
    {
      name: 'Sidcup',
      code: 'SIDCUP',
      description: 'Sidcup (DA14 / DA15)',
      postcodes: ['DA14 4AA', 'DA15 7RF', 'DA14 6AA'],
    },
    {
      name: 'Erith',
      code: 'ERITH',
      description: 'Erith / Belvedere (DA8)',
      postcodes: ['DA8 1AA', 'DA8 3RF', 'DA8 2AA'],
    },
  ],
  GREENWICH: [
    {
      name: 'Greenwich town',
      code: 'TOWN',
      description: 'Greenwich / Cutty Sark (SE10)',
      postcodes: ['SE10 9AA', 'SE10 8RF', 'SE10 0AA', 'SE10 9XY'],
    },
    {
      name: 'Woolwich',
      code: 'WOOLWICH',
      description: 'Woolwich (SE18)',
      postcodes: ['SE18 6AA', 'SE18 4RF', 'SE18 7AA'],
    },
    {
      name: 'Charlton',
      code: 'CHARLTON',
      description: 'Charlton (SE7)',
      postcodes: ['SE7 7AA', 'SE7 8RF', 'SE7 9AA'],
    },
  ],
};

/** Fallback when a branch has no explicit map — keyed by zone / branch name tokens. */
const FALLBACK_BY_ZONE_TOKEN: Array<{ match: RegExp; areas: AreaDef[] }> = [
  {
    match: /croydon|transport/i,
    areas: [
      {
        name: 'General Croydon',
        code: 'GENERAL',
        description: 'General Croydon CR0 coverage',
        postcodes: ['CR0 6AA', 'CR0 7RF', 'CR0 8AA'],
      },
    ],
  },
  {
    match: /merton|wimbledon|mitcham|morden/i,
    areas: [
      {
        name: 'General Merton',
        code: 'GENERAL',
        description: 'General Merton SM1 coverage',
        postcodes: ['SM1 1AA', 'SM1 2RF', 'SM1 3AA'],
      },
    ],
  },
  {
    match: /haringey|tottenham|hornsey/i,
    areas: [
      {
        name: 'General Haringey',
        code: 'GENERAL',
        description: 'General Haringey N15 coverage',
        postcodes: ['N15 3AA', 'N15 4RF', 'N15 5AA'],
      },
    ],
  },
  {
    match: /bexley|bromley/i,
    areas: [
      {
        name: 'General Bexley',
        code: 'GENERAL',
        description: 'General Bexley DA5 coverage',
        postcodes: ['DA5 1AA', 'DA5 2RF', 'DA5 3AA'],
      },
    ],
  },
  {
    match: /greenwich|woolwich/i,
    areas: [
      {
        name: 'General Greenwich',
        code: 'GENERAL',
        description: 'General Greenwich SE10 coverage',
        postcodes: ['SE10 1AA', 'SE10 2RF', 'SE10 3AA'],
      },
    ],
  },
];

function normalizePostcodeKey(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

function formatPostcodeDisplay(raw: string): string {
  const key = normalizePostcodeKey(raw);
  if (key.length > 3) {
    return `${key.slice(0, key.length - 3)} ${key.slice(key.length - 3)}`;
  }
  return key;
}

function parsePostcodes(raw: string[]): Array<{ postcode: string; normalizedPostcode: string }> {
  const seen = new Set<string>();
  const out: Array<{ postcode: string; normalizedPostcode: string }> = [];
  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const normalizedPostcode = normalizePostcodeKey(trimmed);
    if (!normalizedPostcode || seen.has(normalizedPostcode)) continue;
    seen.add(normalizedPostcode);
    out.push({ postcode: formatPostcodeDisplay(trimmed), normalizedPostcode });
  }
  return out;
}

function resolveAreasForBranch(branch: {
  code: string;
  name: string;
  parentZoneName: string | null;
  locationName: string | null;
}): AreaDef[] {
  const mapped = AREAS_BY_BRANCH_CODE[branch.code];
  if (mapped?.length) return mapped;

  const haystack = [branch.parentZoneName, branch.name, branch.locationName]
    .filter(Boolean)
    .join(' ');
  for (const entry of FALLBACK_BY_ZONE_TOKEN) {
    if (entry.match.test(haystack)) return entry.areas;
  }

  // Last resort: synthetic unique postcodes so every branch still gets an area
  const slug = branch.code.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase() || 'GEN';
  return [
    {
      name: `${branch.name} area`,
      code: 'GENERAL',
      description: `Default monitoring area for ${branch.name}`,
      postcodes: [`ZZ${slug.slice(0, 2)} 1AA`, `ZZ${slug.slice(0, 2)} 2AA`],
    },
  ];
}

export async function seedServiceUserAreas(prisma: PrismaClient): Promise<{
  branches: number;
  areas: number;
  postcodes: number;
}> {
  const branches = await prisma.scheduleArea.findMany({
    where: { deletedAt: null, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      parentZoneName: true,
      location: { select: { name: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  let areaCount = 0;
  let postcodeCount = 0;

  // Claim all postcodes we will write, skip any already owned by a different area
  const planned = new Map<
    string,
    { scheduleAreaId: string; areaCode: string; display: string }
  >();

  for (const branch of branches) {
    const defs = resolveAreasForBranch({
      code: branch.code,
      name: branch.name,
      parentZoneName: branch.parentZoneName,
      locationName: branch.location?.name ?? null,
    });
    for (const def of defs) {
      for (const pc of parsePostcodes(def.postcodes)) {
        if (planned.has(pc.normalizedPostcode)) continue;
        planned.set(pc.normalizedPostcode, {
          scheduleAreaId: branch.id,
          areaCode: def.code,
          display: pc.postcode,
        });
      }
    }
  }

  for (const branch of branches) {
    const defs = resolveAreasForBranch({
      code: branch.code,
      name: branch.name,
      parentZoneName: branch.parentZoneName,
      locationName: branch.location?.name ?? null,
    });

    let sortOrder = 0;
    for (const def of defs) {
      const postcodes = parsePostcodes(def.postcodes).filter((pc) => {
        const owner = planned.get(pc.normalizedPostcode);
        return (
          owner &&
          owner.scheduleAreaId === branch.id &&
          owner.areaCode === def.code
        );
      });

      const existing = await prisma.serviceUserArea.findFirst({
        where: {
          scheduleAreaId: branch.id,
          code: def.code,
          deletedAt: null,
        },
        select: { id: true },
      });

      // Drop postcodes already used by a different area in DB
      const usable: typeof postcodes = [];
      for (const pc of postcodes) {
        const clash = await prisma.serviceUserAreaPostcode.findFirst({
          where: {
            normalizedPostcode: pc.normalizedPostcode,
            ...(existing ? { serviceUserAreaId: { not: existing.id } } : {}),
          },
          select: { id: true },
        });
        if (!clash) usable.push(pc);
      }

      const area = existing
        ? await prisma.serviceUserArea.update({
            where: { id: existing.id },
            data: {
              name: def.name,
              description: def.description ?? null,
              sortOrder,
              isActive: true,
              deletedAt: null,
            },
          })
        : await prisma.serviceUserArea.create({
            data: {
              scheduleAreaId: branch.id,
              name: def.name,
              code: def.code,
              description: def.description ?? null,
              sortOrder,
              isActive: true,
            },
          });

      await prisma.serviceUserAreaPostcode.deleteMany({
        where: { serviceUserAreaId: area.id },
      });
      if (usable.length) {
        await prisma.serviceUserAreaPostcode.createMany({
          data: usable.map((pc) => ({
            serviceUserAreaId: area.id,
            postcode: pc.postcode,
            normalizedPostcode: pc.normalizedPostcode,
          })),
        });
      }

      areaCount += 1;
      postcodeCount += usable.length;
      sortOrder += 10;
    }
  }

  return { branches: branches.length, areas: areaCount, postcodes: postcodeCount };
}
