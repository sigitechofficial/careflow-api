import { CarePathwayFormFieldType as T, Prisma, PrismaClient } from '@prisma/client';
import type { CarePlanFieldSeed, CarePlanFieldShowWhenSeed } from './care-plan-forms.seed-data';

/**
 * Care 2020 area-risk follow-up block.
 *
 * Shown only when the plan's existing "Is there a risk associated with this area of care?"
 * YES_NO field is YES. Repeat / repeating groups are out of scope for this phase.
 *
 * SELECT options reuse the existing Care Plan Risk Assessment / Personal Safety convention
 * (`['Low', 'Medium', 'High']`) — do not invent a second scale.
 */

export const CARE_2020_AREA_RISK_LEVEL_OPTIONS = ['Low', 'Medium', 'High'] as const;
export const CARE_2020_AREA_RISK_LIKELIHOOD_OPTIONS = ['Low', 'Medium', 'High'] as const;

export const AREA_RISK_FOLLOW_UP_MANUAL_NOTE =
  'Care 2020 area-risk follow-up. Assessor-owned; must not be mapped from IA risk records or the Care Plan Risk Profile.';

export const AREA_RISK_FOLLOW_UP_SUFFIXES = [
  'risk_identify',
  'risk_who_might_be_harmed',
  'risk_level',
  'risk_likelihood',
  'risk_triggers',
  'risk_management',
] as const;

const FOLLOW_UP_KEY_RE = new RegExp(
  `^(.+)_(${AREA_RISK_FOLLOW_UP_SUFFIXES.join('|')})$`,
);

export function areaRiskFollowUpFieldKeys(prefix: string): string[] {
  return AREA_RISK_FOLLOW_UP_SUFFIXES.map((suffix) => `${prefix}_${suffix}`);
}

export function areaRiskGateFieldKey(prefix: string): string {
  return `${prefix}_area_risk`;
}

function showWhenGate(prefix: string): CarePlanFieldShowWhenSeed {
  return { fieldKey: areaRiskGateFieldKey(prefix), operator: 'is_true' };
}

export function areaRiskFollowUpFields(prefix: string): CarePlanFieldSeed[] {
  const showWhen = showWhenGate(prefix);
  return [
    {
      label: 'Identify the risk?',
      fieldType: T.RICH_TEXT,
      required: true,
      fieldKey: `${prefix}_risk_identify`,
      showWhen,
    },
    {
      label: 'Who might be harmed?',
      fieldType: T.TEXTAREA,
      required: true,
      fieldKey: `${prefix}_risk_who_might_be_harmed`,
      showWhen,
    },
    {
      label: 'What is the risk level?',
      fieldType: T.SELECT,
      required: true,
      fieldKey: `${prefix}_risk_level`,
      options: [...CARE_2020_AREA_RISK_LEVEL_OPTIONS],
      showWhen,
    },
    {
      label: 'How likely is it to occur?',
      fieldType: T.SELECT,
      required: true,
      fieldKey: `${prefix}_risk_likelihood`,
      options: [...CARE_2020_AREA_RISK_LIKELIHOOD_OPTIONS],
      showWhen,
    },
    {
      label: 'What are the triggers?',
      fieldType: T.RICH_TEXT,
      required: true,
      fieldKey: `${prefix}_risk_triggers`,
      showWhen,
    },
    {
      label: 'How can the risk be reduced and managed?',
      fieldType: T.RICH_TEXT,
      required: true,
      fieldKey: `${prefix}_risk_management`,
      showWhen,
    },
  ];
}

/** Compose-registry entries: `{ businessKey, mode, resolvedByEngine, sources }`. */
export function areaRiskFollowUpManualEntriesResolvedByEngine(prefix: string) {
  return areaRiskFollowUpFieldKeys(prefix).map((businessKey) => ({
    businessKey,
    mode: 'MANUAL' as const,
    resolvedByEngine: false as const,
    sources: [{ kind: 'MANUAL' as const, notes: AREA_RISK_FOLLOW_UP_MANUAL_NOTE }],
  }));
}

/** Compose-registry entries: `{ businessKey, mode, notes }`. */
export function areaRiskFollowUpManualEntriesNotesOnly(prefix: string) {
  return areaRiskFollowUpFieldKeys(prefix).map((businessKey) => ({
    businessKey,
    mode: 'MANUAL' as const,
    notes: AREA_RISK_FOLLOW_UP_MANUAL_NOTE,
  }));
}

/** Compose-registry entries: `{ businessKey, mode, source, sources }`. */
export function areaRiskFollowUpManualEntriesWithSource(prefix: string) {
  return areaRiskFollowUpFieldKeys(prefix).map((businessKey) => ({
    businessKey,
    mode: 'MANUAL' as const,
    source: 'MANUAL' as const,
    sources: [{ kind: 'MANUAL' as const, notes: AREA_RISK_FOLLOW_UP_MANUAL_NOTE }],
  }));
}

function followUpPrefixFromFieldKey(fieldKey: string): string | null {
  const match = fieldKey.match(FOLLOW_UP_KEY_RE);
  return match?.[1] ?? null;
}

function sameShowWhen(
  current: unknown,
  next: { showWhen: Array<{ sectionId: string; fieldId: string; operator: string }> },
): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

/**
 * Resolve seed-time `showWhen.fieldKey` into the UUID `conditionalLogicJson` the
 * generic Care Plan renderer already understands (`showWhen` + `is_true`).
 *
 * No-op when the version has no area-risk follow-up keys (Person Centred, Advance, etc.).
 */
export async function stampAreaRiskFollowUpConditionals(
  prisma: PrismaClient,
  formVersionId: string,
): Promise<number> {
  const fields = await prisma.carePathwayFormField.findMany({
    where: {
      section: { formVersionId, deletedAt: null },
      deletedAt: null,
    },
  });

  const byKey = new Map(
    fields.filter((field) => field.fieldKey).map((field) => [field.fieldKey as string, field]),
  );

  let stamped = 0;
  for (const field of fields) {
    if (!field.fieldKey) continue;
    const prefix = followUpPrefixFromFieldKey(field.fieldKey);
    if (!prefix) continue;

    const gate = byKey.get(areaRiskGateFieldKey(prefix));
    if (!gate) continue;

    const next = {
      showWhen: [
        {
          sectionId: gate.sectionId,
          fieldId: gate.id,
          operator: 'is_true',
        },
      ],
    };

    if (sameShowWhen(field.conditionalLogicJson, next)) continue;

    await prisma.carePathwayFormField.update({
      where: { id: field.id },
      data: { conditionalLogicJson: next as Prisma.InputJsonValue },
    });
    stamped += 1;
  }

  return stamped;
}
