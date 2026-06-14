import type {
  CarePlanComposeContext,
  CarePlanFormFieldRef,
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

export type MedicationFieldMapping = {
  fieldLabel: string;
  required?: boolean;
  resolve: (ctx: CarePlanComposeContext) => ComposeFieldResult | null;
};

function fieldByLabel(fields: CarePlanFormFieldRef[], label: string): CarePlanFormFieldRef | undefined {
  const needle = normalizeFieldLabel(label);
  return fields.find((f) => normalizeFieldLabel(f.label) === needle);
}

function mergeEvidence(existing: ComposeEvidenceItem[], item: ComposeEvidenceItem): ComposeEvidenceItem[] {
  if (existing.some((e) => e.id === item.id)) return existing;
  return [...existing, item];
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

  for (const mapping of mappings) {
    const field = fieldByLabel(fields, mapping.fieldLabel);
    if (!field) continue;

    const resolved = mapping.resolve(ctx);
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
    composedFrom: {
      iaSubmissionId: ctx.ia?.submissionId ?? null,
      iaSubmittedAt: ctx.ia?.submittedAt ?? null,
      emarActiveCount: ctx.emar.activeCount,
      medicationPackId: ctx.pack?.packId ?? null,
      composedAt: new Date().toISOString(),
    },
  };
}

function buildHighRiskMedicationSummary(ctx: CarePlanComposeContext): string | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const flags: Array<[string, string]> = [
    ['insulinAdministrationRequired', 'Insulin administration required'],
    ['insulinSupervisionRequired', 'Insulin supervision required'],
    ['bloodGlucoseMonitoringRequired', 'Blood glucose monitoring required'],
  ];
  for (const [fieldKey, label] of flags) {
    if (resolveIaBooleanYes(findIaAnswer(ctx.ia.answers, { fieldKey }))) {
      lines.push(label);
    }
  }
  const controlled = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '9.3', questionTextContains: 'controlled drugs' }),
  );
  if (controlled?.toLowerCase() === 'yes') lines.push('Controlled drugs in use');
  const covert = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '9.3', questionTextContains: 'covert medication' }),
  );
  if (covert?.toLowerCase() === 'yes') lines.push('Covert medication required');
  return lines.length > 0 ? lines.join('\n') : null;
}

function buildCarerAdministrationSummary(ctx: CarePlanComposeContext): string | null {
  if (!ctx.ia) return null;
  const lines: string[] = [];
  const supportLevel = mapMedicationSupportLevelToCarePlan(
    resolveIaRawValue(findIaAnswer(ctx.ia.answers, { fieldKey: 'medicationSupportLevel' })),
  );
  if (supportLevel) lines.push(`Support level: ${supportLevel}`);
  const packaging = resolveIaBooleanYes(
    findIaAnswer(ctx.ia.answers, { fieldKey: 'packagingHelpRequired' }),
  );
  if (packaging) lines.push('Help removing medicines from packaging');
  const prompting = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '9.2', questionTextContains: 'prompting or reminding' }),
  );
  if (prompting?.toLowerCase() === 'yes') lines.push('Prompting or reminding required');
  const assistance = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '9.2', questionTextContains: 'assistance administering' }),
  );
  if (assistance?.toLowerCase() === 'yes') {
    const by = resolveIaDisplayValue(
      findIaAnswer(ctx.ia.answers, { specRef: '9.2', questionTextContains: 'medication administered by' }),
    );
    lines.push(by ? `Assistance administering — ${by}` : 'Assistance administering medication');
  }
  const notes = resolveIaDisplayValue(
    findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'medication safety notes' }),
  );
  if (notes) lines.push(`Safety notes: ${notes}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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
      return [{ label: 'Complete IA §13.9 GP and pharmacy', route: ia13 }];
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
      const answer = findIaAnswer(ctx.ia.answers, { fieldKey: 'medicationSupportLevel' });
      const mapped = mapMedicationSupportLevelToCarePlan(resolveIaRawValue(answer));
      if (!mapped) return null;
      return {
        fieldKey: '',
        label: 'Medication support level',
        value: mapped,
        source: 'ia',
        sourceLabel: 'IA §9.2',
      };
    },
  },
  {
    fieldLabel: 'Known allergies',
    required: true,
    resolve: (ctx) => {
      const allergyLines = [...ctx.allergies];
      if (ctx.ia) {
        const iaDetails = resolveIaDisplayValue(
          findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'allergy details' }),
        );
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
        sourceLabel: ctx.allergies.length > 0 ? 'Allergies tab' : 'IA §9.5',
      };
    },
  },
  {
    fieldLabel: 'Active medication list',
    resolve: (ctx) => {
      const parts = [ctx.emar.medListText, ctx.emar.prnText ? `PRN:\n${ctx.emar.prnText}` : ''].filter(Boolean);
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
    resolve: (ctx) => {
      const text = buildHighRiskMedicationSummary(ctx);
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'High-risk medicines',
        value: text,
        source: 'ia',
        sourceLabel: 'IA §9.3',
      };
    },
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
    resolve: () => ({
      fieldKey: '',
      label: 'Next medication review date',
      value: isoDateOnly(addDays(new Date(), 365)),
      source: 'static',
      sourceLabel: 'Annual review schedule',
    }),
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
        const prnProtocol = resolveIaDisplayValue(
          findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'prn protocol' }),
        );
        if (prnPresent) parts.push(`PRN present: ${prnPresent}`);
        if (prnProtocol) parts.push(`PRN protocol: ${prnProtocol}`);
      }
      const text = parts.filter(Boolean).join('\n');
      if (!text) return null;
      return {
        fieldKey: '',
        label: 'PRN medicines and when used',
        value: text,
        source: ctx.emar.prnText ? 'emar' : 'ia',
        sourceLabel: ctx.emar.prnText ? 'eMAR PRN list' : 'IA §9.5',
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
        const packaging = resolveIaBooleanYes(
          findIaAnswer(ctx.ia.answers, { fieldKey: 'packagingHelpRequired' }),
        );
        if (packaging) {
          return {
            fieldKey: '',
            label: 'Storage and blister packs',
            value: 'Help removing medicines from packaging required (IA §9.2)',
            source: 'ia',
            sourceLabel: 'IA §9.2',
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
      const notes = resolveIaDisplayValue(
        findIaAnswer(ctx.ia.answers, { specRef: '9.5', questionTextContains: 'medication safety notes' }),
      );
      if (!notes) return null;
      return {
        fieldKey: '',
        label: 'Refusal or missed dose – action',
        value: notes,
        source: 'ia',
        sourceLabel: 'IA §9.5',
      };
    },
  },
  {
    fieldLabel: 'Pharmacy and GP contact',
    resolve: (ctx) => {
      const parts = [ctx.gpPharmacyLine, ctx.pack?.pharmacyLine, ctx.pack?.gpLine].filter(Boolean);
      const unique = [...new Set(parts)];
      if (unique.length === 0) return null;
      return {
        fieldKey: '',
        label: 'Pharmacy and GP contact',
        value: unique.join('\n'),
        source: ctx.gpPharmacyLine ? 'ia' : 'medication_pack',
        sourceLabel: ctx.gpPharmacyLine ? 'IA §13.9' : 'Medication pack',
      };
    },
  },
];
