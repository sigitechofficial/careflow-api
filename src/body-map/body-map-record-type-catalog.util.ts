import type { PrismaClient } from '@prisma/client';

export type BodyMapRecordTypeLookupRow = {
  code: string;
  label: string;
  markerColorHex?: string | null;
  subTypes: BodyMapRecordSubTypeLookupRow[];
};

export type BodyMapRecordSubTypeLookupRow = {
  name: string;
  code: string;
  markerColorHex?: string | null;
};

export type BodyMapRecordTypeCatalogLookups = {
  recordTypes: BodyMapRecordTypeLookupRow[];
  woundTypes: { value: string; label: string }[];
  bodyParts: string[];
  bodyViews: string[];
  riskLevels: string[];
  medicationSubTypeByMarTypeCode: Record<string, string>;
};

const BODY_PARTS = [
  'Head',
  'Neck',
  'Chest',
  'Abdomen',
  'Pelvis / groin',
  'Upper back',
  'Lower back',
  'Sacrum',
  'Left shoulder',
  'Right shoulder',
  'Left upper arm',
  'Right upper arm',
  'Left forearm',
  'Right forearm',
  'Left hand',
  'Right hand',
  'Left thigh',
  'Right thigh',
  'Left knee',
  'Right knee',
  'Left lower leg',
  'Right lower leg',
  'Left foot',
  'Right foot',
  'Left heel',
  'Right heel',
];

const MEDICATION_SUBTYPE_MAP: Record<string, string> = {
  CREAM: 'Cream application',
  OINTMENT: 'Cream application',
  LOTION: 'Cream application',
  PATCH: 'Patch site',
  INJECTION: 'Injection site',
  SPRAY: 'Spray site',
};

type CatalogRow = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  initialAssessmentWoundType: boolean;
  markerColorHex: string | null;
};

export async function buildBodyMapRecordTypeCatalogLookups(
  prisma: Pick<PrismaClient, 'bodyMapRecordTypeCatalog'>,
): Promise<BodyMapRecordTypeCatalogLookups> {
  const rows: CatalogRow[] = await prisma.bodyMapRecordTypeCatalog.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
      sortOrder: true,
      initialAssessmentWoundType: true,
      markerColorHex: true,
    },
  });

  const roots = rows.filter((r) => !r.parentId);
  const recordTypes: BodyMapRecordTypeLookupRow[] = roots.map((root) => ({
    code: root.code,
    label: root.name,
    markerColorHex: root.markerColorHex,
    subTypes: rows
      .filter((c) => c.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((c) => ({
        name: c.name,
        code: c.code,
        markerColorHex: c.markerColorHex,
      })),
  }));

  const woundTypes = rows
    .filter((r) => r.initialAssessmentWoundType)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((r) => ({ value: r.code, label: r.name }));

  return {
    recordTypes,
    woundTypes,
    bodyParts: BODY_PARTS,
    bodyViews: ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'FACE', 'HAND', 'FOOT'],
    riskLevels: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    medicationSubTypeByMarTypeCode: MEDICATION_SUBTYPE_MAP,
  };
}

/** Static fallback when catalogue table is empty (e.g. before seed). */
export function staticBodyMapRecordTypeCatalogLookups(): BodyMapRecordTypeCatalogLookups {
  const sub = (name: string, code: string, markerColorHex?: string) => ({
    name,
    code,
    markerColorHex: markerColorHex ?? null,
  });
  return {
    recordTypes: [
      {
        code: 'INJURY',
        label: 'Injury or Mark',
        markerColorHex: '#dc2626',
        subTypes: [
          sub('Bruise', 'bruise'),
          sub('Cut', 'cut'),
          sub('Scratch', 'scratch'),
          sub('Burn', 'burn'),
          sub('Bite mark', 'bite_mark'),
          sub('Unexplained mark', 'unexplained_mark'),
          sub('Swelling', 'swelling'),
        ],
      },
      {
        code: 'WOUND',
        label: 'Wound',
        markerColorHex: '#7c3aed',
        subTypes: [
          sub('Skin tear', 'skin_tear'),
          sub('Open wound', 'open_wound'),
          sub('Surgical wound', 'surgical'),
          sub('Infected wound', 'infected_wound'),
          sub('Dressing required', 'dressing_required'),
        ],
      },
      {
        code: 'PRESSURE',
        label: 'Pressure Area',
        markerColorHex: '#ea580c',
        subTypes: [
          sub('Redness', 'redness'),
          sub('Non-blanching redness', 'non_blanching_redness'),
          sub('Suspected pressure damage', 'suspected_pressure_damage'),
          sub('Heel concern', 'heel_concern'),
          sub('Sacral concern', 'sacral_concern'),
        ],
      },
      {
        code: 'MEDICATION',
        label: 'Medication Site',
        markerColorHex: '#2563eb',
        subTypes: [
          sub('Cream application', 'cream_application', '#2563eb'),
          sub('Patch site', 'patch_site', '#3b82f6'),
          sub('Injection site', 'injection_site', '#0d9488'),
          sub('Spray site', 'spray_site', '#0891b2'),
        ],
      },
      {
        code: 'PAIN',
        label: 'Pain',
        markerColorHex: '#db2777',
        subTypes: [sub('Acute', 'pain_acute'), sub('Chronic', 'pain_chronic'), sub('Intermittent', 'pain_intermittent')],
      },
      {
        code: 'SKIN',
        label: 'Skin Condition',
        markerColorHex: '#ca8a04',
        subTypes: [
          sub('Rash', 'rash'),
          sub('Dry skin', 'dry_skin'),
          sub('Moisture lesion', 'moisture_lesion'),
          sub('Infection concern', 'infection_concern'),
        ],
      },
      {
        code: 'DEVICE',
        label: 'Medical Device Mark',
        markerColorHex: '#475569',
        subTypes: [
          sub('Catheter mark', 'catheter_mark'),
          sub('Wheelchair pressure', 'wheelchair_pressure'),
          sub('Hoist sling mark', 'hoist_sling_mark'),
        ],
      },
      {
        code: 'SAFEGUARDING',
        label: 'Safeguarding Concern',
        markerColorHex: '#7f1d1d',
        subTypes: [
          sub('Unexplained injury', 'unexplained_injury'),
          sub('Pattern of marks', 'pattern_of_marks'),
          sub('Other concern', 'safeguarding_other'),
        ],
      },
    ],
    woundTypes: [
      { value: 'pressure_ulcer', label: 'Pressure ulcer' },
      { value: 'skin_tear', label: 'Skin tear' },
      { value: 'surgical', label: 'Surgical wound' },
      { value: 'moisture_lesion', label: 'Moisture lesion' },
      { value: 'wound_other', label: 'Other' },
    ],
    bodyParts: BODY_PARTS,
    bodyViews: ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'FACE', 'HAND', 'FOOT'],
    riskLevels: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    medicationSubTypeByMarTypeCode: MEDICATION_SUBTYPE_MAP,
  };
}
