import type {
  CarePlanComposeContext,
  CarePlanFieldSuggestion,
  CarePlanFormFieldRef,
  CarePlanSuggestionSourceQuestion,
  ComposeEvidenceItem,
  ComposeFieldResult,
  ComposeGap,
  ComposePlanResult,
} from './compose-context.types';
import {
  findIaAnswer,
  mapMedicationSupportLevelToCarePlan,
  resolveIaDisplayValue,
  resolveIaRawValue,
  resolveIaBooleanYes,
} from './ia-answer-resolver.util';
import { iaRoute, medRoute, normalizeFieldLabel, profileRoute } from './compose-routes.util';
import { resolveComposeNextReviewDate } from './compose-next-review-date.util';

export type MedicationFieldMapping = {
  fieldLabel: string;
  required?: boolean;
  resolve: (ctx: CarePlanComposeContext) => ComposeFieldResult | null;
};

function fieldByLabel(fields: CarePlanFormFieldRef[], label: string): CarePlanFormFieldRef | undefined {
  const needle = normalizeFieldLabel(label);
  return fields.find((f) => normalizeFieldLabel(f.label) === needle);
}

function fieldByLabelOrKey(
  fields: CarePlanFormFieldRef[],
  label: string,
  businessKey?: string,
): CarePlanFormFieldRef | undefined {
  if (businessKey) {
    const byKey = fields.find((f) => f.fieldKey === businessKey);
    if (byKey) return byKey;
  }
  return fieldByLabel(fields, label);
}

function findMedicationSupportLevelAnswer(
  answers: Parameters<typeof findIaAnswer>[0],
): ReturnType<typeof findIaAnswer> {
  return (
    findIaAnswer(answers, { fieldKey: 'medicationSupportLevel' }) ??
    findIaAnswer(answers, { specRef: '9.2', questionTextContains: 'medication support level' }) ??
    findIaAnswer(answers, { questionTextContains: 'medication support level' })
  );
}

function mergeEvidence(existing: ComposeEvidenceItem[], item: ComposeEvidenceItem): ComposeEvidenceItem[] {
  if (existing.some((e) => e.id === item.id)) return existing;
  return [...existing, item];
}

const MEDICATION_SUPPORT_LEVEL_LABEL = 'Medication support level';
const MEDICATION_SUPPORT_LEVEL_KEY = 'medication_support_level';

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function medicationSupportSuggestion(
  field: CarePlanFormFieldRef,
  ctx: CarePlanComposeContext,
  mapped: string,
  answer: ReturnType<typeof findIaAnswer>,
): CarePlanFieldSuggestion {
  const ia = ctx.ia!;
  const sources: CarePlanSuggestionSourceQuestion[] = answer
    ? [
        {
          questionId: answer.questionId,
          questionFieldKey: answer.fieldKey ?? 'medicationSupportLevel',
          specRef: answer.specRef ?? '9.2',
          sourceSection: 'Medication Support',
          sourceLabel: answer.questionText,
          sourceValue: mapped,
        },
      ]
    : [];
  return {
    id: `medication:${fnv1a(`${field.key}|${ia.submissionId}|${mapped}`)}`,
    kind: 'value',
    targetFieldKey: field.key,
    targetLabel: field.label,
    targetFieldType: field.fieldType,
    suggestedValue: mapped,
    displayText: mapped,
    sourceType: 'INITIAL_ASSESSMENT',
    submissionId: ia.submissionId,
    sourceDate: ia.submittedAt,
    sourceQuestions: sources,
    transform: 'typed',
    questionId: sources[0]?.questionId,
    questionFieldKey: sources[0]?.questionFieldKey,
    specRef: sources[0]?.specRef,
    sourceSection: sources[0]?.sourceSection,
    sourceLabel: sources[0]?.sourceLabel,
    sourceValue: sources[0]?.sourceValue,
  };
}

export function composeMedicationCarePlan(
  ctx: CarePlanComposeContext,
  fields: CarePlanFormFieldRef[],
  mappings: MedicationFieldMapping[],
  serviceUserId: string,
): ComposePlanResult {
  const values: Record<string, string | boolean> = {};
  const fieldSources: Record<string, ComposeFieldResult['source']> = {};
  const gaps: ComposeGap[] = [];
  let evidence: ComposeEvidenceItem[] = [];

  if (ctx.ia) {
    evidence = mergeEvidence(evidence, {
      id: 'ia-submission',
      source: 'ia',
      label: 'Initial Assessment',
      value: ctx.ia.submittedAt
        ? `Submitted ${ctx.ia.submittedAt.slice(0, 10)}`
        : ctx.ia.status === 'IN_PROGRESS'
          ? 'In-progress assessment on file'
          : 'Submitted assessment on file',
      route: iaRoute(serviceUserId),
    });
  }

  if (ctx.emar.activeCount > 0) {
    evidence = mergeEvidence(evidence, {
      id: 'emar-active',
      source: 'emar',
      label: 'eMAR',
      value: `${ctx.emar.activeCount} active medication(s)`,
      route: medRoute(serviceUserId),
    });
  }

  if (ctx.pack) {
    evidence = mergeEvidence(evidence, {
      id: 'med-pack',
      source: 'medication_pack',
      label: 'Medication pack',
      value: ctx.pack.name,
      route: medRoute(serviceUserId),
    });
  }

  if (ctx.allergies.length > 0) {
    evidence = mergeEvidence(evidence, {
      id: 'allergies',
      source: 'allergies',
      label: 'Allergies',
      value: ctx.allergies.join('; '),
      route: profileRoute(serviceUserId),
    });
  }

  const suggestions: CarePlanFieldSuggestion[] = [];

  for (const mapping of mappings) {
    const field =
      mapping.fieldLabel === MEDICATION_SUPPORT_LEVEL_LABEL
        ? fieldByLabelOrKey(fields, mapping.fieldLabel, MEDICATION_SUPPORT_LEVEL_KEY)
        : fieldByLabel(fields, mapping.fieldLabel);
    if (!field) continue;

    const resolved = mapping.resolve(ctx);
    if (mapping.fieldLabel === MEDICATION_SUPPORT_LEVEL_LABEL) {
      if (resolved?.value != null && resolved.value !== '' && ctx.ia) {
        const answer = findMedicationSupportLevelAnswer(ctx.ia.answers);
        suggestions.push(medicationSupportSuggestion(field, ctx, String(resolved.value), answer));
      }
      continue;
    }

    if (resolved?.value != null && resolved.value !== '') {
      values[field.key] = resolved.value;
      fieldSources[field.key] = resolved.source;
    } else if (mapping.required ?? field.required) {
      gaps.push({
        fieldKey: field.key,
        label: field.label,
        severity: mapping.fieldLabel === 'Known allergies' ? 'blocking' : 'warning',
        fixes: buildFixesForField(mapping.fieldLabel, serviceUserId),
      });
    }
  }

  const emarRequired = ctx.ia
    ? resolveIaBooleanYes(findIaAnswer(ctx.ia.answers, { fieldKey: 'emarRequired' }))
    : false;
  if (emarRequired && ctx.emar.activeCount === 0) {
    gaps.push({
      fieldKey: 'emar',
      label: 'Active medications (eMAR)',
      severity: 'blocking',
      fixes: [
        {
          label: 'Add medications in eMAR',
          route: medRoute(serviceUserId),
        },
      ],
    });
  }

  return {
    values,
    fieldSources,
    gaps,
    evidence,
    suggestionMode: 'hybrid',
    suggestions,
    composedFrom: {
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      iaSubmittedAt: ctx.ia?.submittedAt ?? null,
      emarActiveCount: ctx.emar.activeCount,
      medicationPackId: ctx.pack?.packId ?? null,
      composedAt: new Date().toISOString(),
    },
  };
}

function buildCarerAdministrationSummary(ctx: CarePlanComposeContext): string | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const levelRaw =
    resolveIaRawValue(findMedicationSupportLevelAnswer(ctx.ia.answers)) ??
    ctx.ia.medicationSnapshot?.supportLevel ??
    null;
  const level = levelRaw?.trim().toLowerCase() ?? '';

  if (level === 'level_0') lines.push('Independent self-administration');
  if (level === 'level_1a') lines.push('Prompting or reminding required');
  if (
    level === 'level_1b' ||
    ctx.ia.medicationSnapshot?.packagingHelpRequired === true
  ) {
    lines.push('Help removing medicines from packaging');
  }
  if (level === 'level_2a' || level === 'level_2b') {
    const by = resolveIaDisplayValue(
      findIaAnswer(ctx.ia.answers, { specRef: '9.2', questionTextContains: 'medication administered by' }),
    );
    // Exact wording per level — 2a is assistance (person in control), 2b is administration.
    const base =
      level === 'level_2a'
        ? 'Assisting the person to take their medicines (person stays in control)'
        : 'Administering medicines (trained staff, record on MAR)';
    lines.push(by ? `${base} — ${by}` : base);
  }
  if (level === 'provided_by_others') {
    lines.push('Medicines provided by others (family / nurse) — carers do not administer');
  }
  const notes =
    resolveIaDisplayValue(
      findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'medication safety notes' }),
    ) ?? ctx.ia.medicationSnapshot?.safetyNotes ?? null;
  if (notes) lines.push(`Safety notes: ${notes}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildFixesForField(label: string, serviceUserId: string): ComposeGap['fixes'] {
  const ia = iaRoute(serviceUserId);
  const ia9 = iaRoute(serviceUserId, 9);
  const ia13 = iaRoute(serviceUserId, 13);
  const med = medRoute(serviceUserId);
  const profile = profileRoute(serviceUserId);
  switch (normalizeFieldLabel(label)) {
    case normalizeFieldLabel('Medication support level'):
      return [{ label: 'Complete IA §9 medication support', route: ia9 }];
    case normalizeFieldLabel('Known allergies'):
      return [
        { label: 'Record allergies on profile', route: profile },
        { label: 'Complete IA §9 allergy details', route: ia9 },
      ];
    case normalizeFieldLabel('Pharmacy and GP contact'):
      return [
        { label: 'Complete GP contact on IA Personal Details', route: iaRoute(serviceUserId, 1) },
        { label: 'Complete IA §13.9 pharmacy', route: ia13 },
      ];
    case normalizeFieldLabel('Storage and blister packs'):
      return [{ label: 'Set up medication pack', route: med }];
    default:
      return [{ label: 'Review Initial Assessment', route: ia }];
  }
}

export const MEDICATION_CARE_PLAN_FIELD_MAPPINGS: MedicationFieldMapping[] = [
  {
    fieldLabel: 'Medication support level',
    required: true,
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const answer = findMedicationSupportLevelAnswer(ctx.ia.answers);
      const mapped = mapMedicationSupportLevelToCarePlan(
        resolveIaRawValue(answer) ?? ctx.ia.medicationSnapshot?.supportLevel ?? null,
      );
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Medication support level',
        value: mapped,
        source: 'ia',
        sourceLabel: answer ? 'IA §9.2' : 'IA medication snapshot',
      };
    },
  },
  {
    fieldLabel: 'Known allergies',
    required: true,
    resolve: (ctx) => {
      const allergyLines = [...ctx.allergies];
      if (ctx.ia) {
        const iaDetails =
          resolveIaDisplayValue(
            findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'allergy details' }),
          ) ??
          resolveIaDisplayValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'allergiesSummary' })) ??
          ctx.ia.medicationSnapshot?.allergyDetails ??
          null;
        if (iaDetails && !allergyLines.some((l) => l.includes(iaDetails))) {
          allergyLines.push(iaDetails);
        }
      }
      if (allergyLines.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Known allergies',
        value: allergyLines.join('\n'),
        source: ctx.allergies.length > 0 ? 'allergies' : 'ia',
        sourceLabel: ctx.allergies.length > 0 ? 'Allergies tab' : 'IA allergies',
      };
    },
  },
  {
    fieldLabel: 'Active medication list',
    resolve: (ctx) => {
      const parts = [ctx.emar.medListText, ctx.emar.prnText ? `PRN:\n${ctx.emar.prnText}` : ''].filter(Boolean);
      if (parts.length === 0 && ctx.ia?.medicationSnapshot?.currentMedicationDetails) {
        return {
          fieldKey: '',
          label: 'Active medication list',
          value: ctx.ia.medicationSnapshot.currentMedicationDetails,
          source: 'ia',
          sourceLabel: 'IA medication snapshot',
        };
      }
      if (parts.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Active medication list',
        value: parts.join('\n\n'),
        source: 'emar',
        sourceLabel: 'eMAR',
      };
    },
  },
  {
    fieldLabel: 'High-risk medicines',
    resolve: () => null,
  },
  {
    fieldLabel: 'Carer administration responsibilities',
    required: true,
    resolve: (ctx) => {
      const text = buildCarerAdministrationSummary(ctx);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'Carer administration responsibilities',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §9',
      };
    },
  },
  {
    fieldLabel: 'Last medication list verified',
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const verified = resolveIaDisplayValue(
        findIaAnswer(ctx.ia.answers, { specRef: '9.4', questionTextContains: 'medication list verified' }),
      );
      if (verified?.toLowerCase() !== 'yes') return null;
      const date = resolveIaDisplayValue(
        findIaAnswer(ctx.ia.answers, { specRef: '9.4', questionTextContains: 'date medication list verified' }),
      );
      return {
        fieldKey: '',
        label: 'Last medication list verified',
        value: date ?? isoDateOnly(new Date()),
        source: 'ia',
        sourceLabel: 'IA §9.4',
      };
    },
  },
  {
    fieldLabel: 'Next medication review date',
    resolve: (ctx) => resolveComposeNextReviewDate(ctx, 'Next medication review date'),
  },
  {
    fieldLabel: 'PRN medicines and when used',
    resolve: (ctx) => {
      const parts: string[] = [];
      if (ctx.emar.prnText) parts.push(ctx.emar.prnText);
      if (ctx.ia) {
        const prnPresent = resolveIaDisplayValue(
          findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'prn medication present' }),
        );
        const prnProtocol =
          resolveIaDisplayValue(
            findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'prn protocol' }),
          ) ?? ctx.ia.medicationSnapshot?.prnProtocol ?? null;
        if (prnPresent) parts.push(`PRN present: ${prnPresent}`);
        if (prnProtocol) parts.push(prnPresent ? `PRN protocol: ${prnProtocol}` : prnProtocol);
      }
      const text = parts.filter(Boolean).join('\n');
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'PRN medicines and when used',
        value: text,
        source: ctx.emar.prnText ? 'emar' : 'ia',
        sourceLabel: ctx.emar.prnText ? 'eMAR PRN list' : 'IA PRN',
      };
    },
  },
  {
    fieldLabel: 'Storage and blister packs',
    resolve: (ctx) => {
      if (ctx.pack?.storageLine) {
        return {
          fieldKey: '',
          label: 'Storage and blister packs',
          value: ctx.pack.storageLine,
          source: 'medication_pack',
          sourceLabel: 'Medication pack',
        };
      }
      if (ctx.ia) {
        if (ctx.ia.medicationSnapshot?.storageNotes?.trim()) {
          return {
            fieldKey: '',
            label: 'Storage and blister packs',
            value: ctx.ia.medicationSnapshot.storageNotes.trim(),
            source: 'ia',
            sourceLabel: 'IA medication snapshot',
          };
        }
        const levelRaw =
          resolveIaRawValue(findMedicationSupportLevelAnswer(ctx.ia.answers)) ??
          ctx.ia.medicationSnapshot?.supportLevel ??
          null;
        const level = levelRaw?.trim().toLowerCase() ?? '';
        const packaging =
          level === 'level_1b' || ctx.ia.medicationSnapshot?.packagingHelpRequired === true;
        if (packaging) {
          return {
            fieldKey: '',
            label: 'Storage and blister packs',
            value: 'Help removing medicines from packaging required (IA §9.2)',
            source: 'ia',
            sourceLabel: 'IA medication support level',
          };
        }
      }
      return null;
    },
  },
  {
    fieldLabel: 'Refusal or missed dose – action',
    required: true,
    resolve: (ctx) => {
      if (!ctx.ia) return null;
      const notes =
        resolveIaDisplayValue(
          findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'medication safety notes' }),
        ) ?? ctx.ia.medicationSnapshot?.safetyNotes ?? null;
      if (!notes) return null;
      return {
        fieldKey: '',
        label: 'Refusal or missed dose – action',
        value: notes,
        source: 'ia',
        sourceLabel: 'IA medication safety',
      };
    },
  },
  {
    fieldLabel: 'Pharmacy and GP contact',
    resolve: (ctx) => {
      const parts = [ctx.gpPharmacyLine, ctx.pack?.pharmacyLine, ctx.hasGpContact ? null : ctx.pack?.gpLine].filter(Boolean);
      const unique = [...new Set(parts)];
      if (unique.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Pharmacy and GP contact',
        value: unique.join('\n'),
        source: ctx.gpPharmacyLine ? 'ia' : 'medication_pack',
        sourceLabel: ctx.gpPharmacyLine ? 'IA GP contact / §13.9 pharmacy' : 'Medication pack',
      };
    },
  },
];
