import type { PrismaClient } from '@prisma/client';

export type BodyMapRecordTypeLookupRow = {
  code: string;
  label: string;
  subTypes: string[];
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
    },
  });

  const roots = rows.filter((r) => !r.parentId);
  const recordTypes: BodyMapRecordTypeLookupRow[] = roots.map((root) => ({
    code: root.code,
    label: root.name,
    subTypes: rows
      .filter((c) => c.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((c) => c.name),
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
  return {
    recordTypes: [
      {
        code: 'INJURY',
        label: 'Injury or Mark',
        subTypes: ['Bruise', 'Cut', 'Scratch', 'Burn', 'Bite mark', 'Unexplained mark', 'Swelling'],
      },
      {
        code: 'WOUND',
        label: 'Wound',
        subTypes: ['Skin tear', 'Open wound', 'Surgical wound', 'Infected wound', 'Dressing required'],
      },
      {
        code: 'PRESSURE',
        label: 'Pressure Area',
        subTypes: [
          'Redness',
          'Non-blanching redness',
          'Suspected pressure damage',
          'Heel concern',
          'Sacral concern',
        ],
      },
      {
        code: 'MEDICATION',
        label: 'Medication Site',
        subTypes: ['Cream application', 'Patch site', 'Injection site', 'Spray site'],
      },
      { code: 'PAIN', label: 'Pain', subTypes: ['Acute', 'Chronic', 'Intermittent'] },
      {
        code: 'SKIN',
        label: 'Skin Condition',
        subTypes: ['Rash', 'Dry skin', 'Moisture lesion', 'Infection concern'],
      },
      {
        code: 'DEVICE',
        label: 'Medical Device Mark',
        subTypes: ['Catheter mark', 'Wheelchair pressure', 'Hoist sling mark'],
      },
      {
        code: 'SAFEGUARDING',
        label: 'Safeguarding Concern',
        subTypes: ['Unexplained injury', 'Pattern of marks', 'Other concern'],
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
