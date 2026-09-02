import { SLEEPING_NIGHT_CARE_PLAN_SEED } from '../../../prisma/seeds/sleeping-night-care-plan.seed-data';
import { areaRiskFollowUpManualEntriesResolvedByEngine } from '../../../prisma/seeds/area-risk-follow-up.seed';

/**
 * Documentation-and-guard registry for the Sleeping and Night Care Plan.
 *
 * The dedicated compose engine in `sleeping-night-care-plan.compose.ts` is the single source
 * of truth. It currently auto-prefills nothing: IA §10.4 sleepingPattern is not equivalent
 * to bedtime/wake time, night waking/confusion, or naps; About Me nightSupport / IA §1.4
 * already belong to Person Centred and Dementia; "sleeping pattern concern?" must not drive
 * area risk. Bedrail requirement is owned by the dedicated Bed Rail Assessment form.
 */
export type SleepingNightFieldMappingMode = 'AUTO_PREFILL' | 'SUGGESTION' | 'MANUAL';

export type SleepingNightFieldSourceKind = 'INITIAL_ASSESSMENT' | 'MANUAL';

export type SleepingNightFieldSourceRef = {
  kind: SleepingNightFieldSourceKind;
  iaFieldKeys?: readonly string[];
  iaSpecRefs?: readonly string[];
  notes?: string;
};

export type SleepingNightFieldRegistryEntry = {
  businessKey: string;
  mode: SleepingNightFieldMappingMode;
  resolvedByEngine: boolean;
  sources: readonly SleepingNightFieldSourceRef[];
};

export const SLEEPING_NIGHT_FIELD_REGISTRY: readonly SleepingNightFieldRegistryEntry[] = [
  {
    businessKey: 'sleeping_night_usual_bedtime_wake_time',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'IA has no bedtime/wake-time clock fields. §1.4 is a combined daily-routine narrative already mapped by Person Centred.',
      },
    ],
  },
  {
    businessKey: 'sleeping_night_night_waking_confusion',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        iaFieldKeys: ['sleepingPattern'],
        iaSpecRefs: ['10.4'],
        notes:
          'IA §10.4 sleepingPattern is hours-of-sleep / medication / GP-referral options, not night-time waking or confusion. Must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'sleeping_night_daytime_naps',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'No IA question records daytime naps.' }],
  },
  {
    businessKey: 'sleeping_night_evening_routine',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        iaSpecRefs: ['1.4'],
        notes:
          'IA §1.4 / About Me nightSupport already belong to Person Centred (Evening / bedtime routine) and Dementia (Night-time support). Do not duplicate.',
      },
    ],
  },
  {
    businessKey: 'sleeping_night_call_bell_monitoring',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [{ kind: 'MANUAL', notes: 'No IA question records call bell or night monitoring.' }],
  },
  {
    businessKey: 'sleeping_night_night_drinks_snacks',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'IA sleep-medication questions are medication SoT, not night drinks or snacks.',
      },
    ],
  },
  {
    businessKey: 'sleeping_night_service_user_needs',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'Generic Care 2020 needs field; IA holds no sleeping/night-specific needs question.',
      },
    ],
  },
  {
    businessKey: 'sleeping_night_needs_person_centred',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [{ kind: 'MANUAL', notes: 'Free-text person-centred narrative for the needs question.' }],
  },
  {
    businessKey: 'sleeping_night_desired_goals_outcomes',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      {
        kind: 'MANUAL',
        notes: 'The IA holds no sleeping/night-specific goals; general support goals must not be mapped.',
      },
    ],
  },
  {
    businessKey: 'sleeping_night_support_required',
    mode: 'SUGGESTION',
    resolvedByEngine: true,
    sources: [
      { kind: 'MANUAL', notes: 'Generic Care 2020 support narrative; no sleeping/night-specific IA source.' },
    ],
  },
  {
    businessKey: 'sleeping_night_area_risk',
    mode: 'MANUAL',
    resolvedByEngine: false,
    sources: [
      {
        kind: 'MANUAL',
        notes:
          'Generic area-risk gate. Must not be driven from §10.4 "Sleeping pattern concern?" or from Bed Rail Assessment completion.',
      },
    ],
  },
  ...areaRiskFollowUpManualEntriesResolvedByEngine('sleeping_night'),
];

export type SleepingNightFieldBusinessKey =
  (typeof SLEEPING_NIGHT_FIELD_REGISTRY)[number]['businessKey'];

export const SLEEPING_NIGHT_AUTO_PREFILL_KEYS = SLEEPING_NIGHT_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'AUTO_PREFILL',
).map((entry) => entry.businessKey);

export const SLEEPING_NIGHT_SUGGESTION_KEYS = SLEEPING_NIGHT_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'SUGGESTION',
).map((entry) => entry.businessKey);

export const SLEEPING_NIGHT_MANUAL_KEYS = SLEEPING_NIGHT_FIELD_REGISTRY.filter(
  (entry) => entry.mode === 'MANUAL',
).map((entry) => entry.businessKey);

export function sleepingNightFieldRegistryEntry(
  businessKey: string,
): SleepingNightFieldRegistryEntry | undefined {
  return SLEEPING_NIGHT_FIELD_REGISTRY.find((entry) => entry.businessKey === businessKey);
}

export function assertSleepingNightRegistryMatchesTemplate(): void {
  const templateKeys = SLEEPING_NIGHT_CARE_PLAN_SEED.sections
    .flatMap((section) => section.fields)
    .map((field) => field.fieldKey)
    .sort();

  const registryKeys = SLEEPING_NIGHT_FIELD_REGISTRY.map((entry) => entry.businessKey).sort();

  if (templateKeys.length !== registryKeys.length) {
    throw new Error(
      `Sleeping and Night registry field count ${registryKeys.length} !== template ${templateKeys.length}`,
    );
  }

  for (let i = 0; i < templateKeys.length; i += 1) {
    if (templateKeys[i] !== registryKeys[i]) {
      throw new Error(
        `Sleeping and Night registry mismatch at index ${i}: template=${templateKeys[i]} registry=${registryKeys[i]}`,
      );
    }
  }
}
