import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type {
  CarePlanComposeIaSnapshot,
  CarePlanFieldSuggestion,
  CarePlanFormFieldRef,
  CarePlanPreviousAssessment,
  CarePlanSuggestionSourceQuestion,
  ComposeEvidenceItem,
  ComposeGap,
  ComposePlanResult,
} from './compose-context.types';
import {
  resolveIaBooleanValue,
  resolveIaDateIso,
  resolveIaDisplayValue,
  resolveIaNumberValue,
} from './ia-answer-resolver.util';
import { iaRoute, normalizeFieldLabel } from './compose-routes.util';

export const FALLS_FORM_NAME = 'Falls';

type IaAnswerQuery = {
  fieldKey?: string;
  specRef?: string;
  questionTextContains: string;
};

function isEnterpriseAnswer(answer: SubmissionAnswerForRules): boolean {
  return Boolean(answer.specRef && /^\d/.test(answer.specRef));
}

/** Prefer fieldKey, then specRef + text, then enterprise text. Never fall back to legacy catalogue checkboxes. */
export function findEnterpriseIaAnswer(
  answers: SubmissionAnswerForRules[],
  query: IaAnswerQuery,
): SubmissionAnswerForRules | undefined {
  if (query.fieldKey) {
    const byKey = answers.find((a) => a.fieldKey === query.fieldKey);
    if (byKey) return byKey;
  }

  const needle = query.questionTextContains.toLowerCase().trim();
  const textMatches = answers.filter((a) => a.questionText.toLowerCase().includes(needle));
  if (query.specRef) {
    const byRef = textMatches.find((a) => a.specRef === query.specRef);
    if (byRef) return byRef;
  }
  return textMatches.find(isEnterpriseAnswer);
}

export function resolveCarePlanField(
  fields: CarePlanFormFieldRef[],
  sectionTitle: string,
  label: string,
  fieldType: string,
): CarePlanFormFieldRef | undefined {
  const sectionNeedle = normalizeFieldLabel(sectionTitle);
  const labelNeedle = normalizeFieldLabel(label);
  return fields.find(
    (field) =>
      normalizeFieldLabel(field.sectionTitle ?? '') === sectionNeedle &&
      normalizeFieldLabel(field.label) === labelNeedle &&
      field.fieldType === fieldType,
  );
}

function fnv1a(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function formatDateNarrative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function sourceFromAnswer(
  answer: SubmissionAnswerForRules,
  sourceValue: string,
): CarePlanSuggestionSourceQuestion {
  return {
    questionId: answer.questionId,
    questionFieldKey: answer.fieldKey,
    specRef: answer.specRef,
    sourceSection: `§${answer.sectionNumber} ${answer.sectionTitle}`,
    sourceLabel: answer.questionText,
    sourceValue,
  };
}

function sourceFromFallsSnapshot(
  field: 'numberOfFalls' | 'mostRecentFallDate' | 'injuryCaused' | 'fallsLast12Months',
  sourceValue: string,
): CarePlanSuggestionSourceQuestion {
  const labels: Record<typeof field, string> = {
    numberOfFalls: 'Number of falls (last 12 months)',
    mostRecentFallDate: 'Most recent fall date',
    injuryCaused: 'Injury caused by fall',
    fallsLast12Months: 'Falls in last 12 months',
  };
  return {
    questionId: `falls-snapshot:${field}`,
    sourceSection: 'Initial Assessment',
    sourceLabel: labels[field],
    sourceValue,
  };
}

function snapshotNumberOfFalls(ia: CarePlanComposeIaSnapshot): number | null {
  const value = ia.fallsSnapshot?.numberOfFalls;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function snapshotBoolean(
  ia: CarePlanComposeIaSnapshot,
  key: 'fallsLast12Months' | 'injuryCaused',
): boolean | null {
  const value = ia.fallsSnapshot?.[key];
  return typeof value === 'boolean' ? value : null;
}

function snapshotMostRecentFallDate(ia: CarePlanComposeIaSnapshot): string | null {
  const value = ia.fallsSnapshot?.mostRecentFallDate;
  return typeof value === 'string' && value.trim() ? value : null;
}

function suggestionId(
  targetLabel: string,
  submissionId: string,
  suggestedValue: string | boolean | null,
  questionIds: string[],
): string {
  return `falls:${fnv1a(
    `${normalizeFieldLabel(targetLabel)}|${submissionId}|${String(suggestedValue)}|${questionIds.join(',')}`,
  )}`;
}

function flattenSource(sources: CarePlanSuggestionSourceQuestion[]) {
  const first = sources[0];
  if (!first) return {};
  return {
    questionId: first.questionId,
    questionFieldKey: first.questionFieldKey,
    specRef: first.specRef,
    sourceSection: first.sourceSection,
    sourceLabel: first.sourceLabel,
    sourceValue: first.sourceValue,
  };
}

function buildSuggestion(params: {
  field: CarePlanFormFieldRef;
  ia: CarePlanComposeIaSnapshot;
  kind: CarePlanFieldSuggestion['kind'];
  suggestedValue: string | boolean | null;
  displayText: string;
  sources: CarePlanSuggestionSourceQuestion[];
  transform: CarePlanFieldSuggestion['transform'];
}): CarePlanFieldSuggestion {
  const { field, ia, kind, suggestedValue, displayText, sources, transform } = params;
  return {
    id: suggestionId(
      field.label,
      ia.submissionId,
      suggestedValue,
      sources.map((s) => s.questionId),
    ),
    kind,
    targetFieldKey: field.key,
    targetLabel: field.label,
    targetFieldType: field.fieldType,
    suggestedValue,
    displayText,
    sourceType: 'INITIAL_ASSESSMENT',
    submissionId: ia.submissionId,
    sourceDate: ia.submittedAt,
    sourceQuestions: sources,
    transform,
    ...flattenSource(sources),
  };
}

function yesNoLabel(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export function buildFallsFieldSuggestions(
  ia: CarePlanComposeIaSnapshot,
  fields: CarePlanFormFieldRef[],
): CarePlanFieldSuggestion[] {
  const suggestions: CarePlanFieldSuggestion[] = [];
  const answers = ia.answers;

  const countField = resolveCarePlanField(fields, 'Falls history', 'Falls in last 12 months', 'NUMBER');
  if (countField) {
    const countAnswer = findEnterpriseIaAnswer(answers, {
      specRef: '12.7',
      questionTextContains: 'number of falls',
    });
    const fallsYnAnswer = findEnterpriseIaAnswer(answers, {
      fieldKey: 'fallsLast12Months',
      specRef: '12.7',
      questionTextContains: 'falls in last 12 months',
    });
    const countFromAnswer = resolveIaNumberValue(countAnswer);
    const count = countFromAnswer ?? snapshotNumberOfFalls(ia);
    const fallsYnFromAnswer = resolveIaBooleanValue(fallsYnAnswer);
    const fallsYn = fallsYnFromAnswer ?? snapshotBoolean(ia, 'fallsLast12Months');
    if (count != null) {
      const value = String(count);
      const fromAnswer = countFromAnswer != null && countAnswer;
      suggestions.push(
        buildSuggestion({
          field: countField,
          ia,
          kind: 'value',
          suggestedValue: value,
          displayText: value,
          sources: [
            fromAnswer
              ? sourceFromAnswer(countAnswer, value)
              : sourceFromFallsSnapshot('numberOfFalls', value),
          ],
          transform: 'typed',
        }),
      );
    } else if (fallsYn === false) {
      const fromAnswer = fallsYnFromAnswer === false && fallsYnAnswer;
      suggestions.push(
        buildSuggestion({
          field: countField,
          ia,
          kind: 'value',
          suggestedValue: '0',
          displayText: '0',
          sources: [
            fromAnswer
              ? sourceFromAnswer(fallsYnAnswer, 'No')
              : sourceFromFallsSnapshot('fallsLast12Months', 'No'),
          ],
          transform: 'typed',
        }),
      );
    } else if (fallsYn === true) {
      const fromAnswer = fallsYnFromAnswer === true && fallsYnAnswer;
      suggestions.push(
        buildSuggestion({
          field: countField,
          ia,
          kind: 'context',
          suggestedValue: null,
          displayText:
            'Initial Assessment confirms falls in the last 12 months, but the number of falls was not recorded.',
          sources: [
            fromAnswer
              ? sourceFromAnswer(fallsYnAnswer, 'Yes')
              : sourceFromFallsSnapshot('fallsLast12Months', 'Yes'),
          ],
          transform: 'context',
        }),
      );
    }
  }

  const circumstancesField = resolveCarePlanField(
    fields,
    'Falls history',
    'Last fall date and circumstances',
    'TEXTAREA',
  );
  if (circumstancesField) {
    const dateAnswer = findEnterpriseIaAnswer(answers, {
      specRef: '12.7',
      questionTextContains: 'most recent fall date',
    });
    const injuryAnswer = findEnterpriseIaAnswer(answers, {
      specRef: '12.7',
      questionTextContains: 'injury caused by fall',
    });
    const dateFromAnswer = resolveIaDateIso(dateAnswer);
    const dateIso = dateFromAnswer ?? snapshotMostRecentFallDate(ia);
    const injuryFromAnswer = resolveIaBooleanValue(injuryAnswer);
    const injury = injuryFromAnswer ?? snapshotBoolean(ia, 'injuryCaused');
    const parts: string[] = [];
    const sources: CarePlanSuggestionSourceQuestion[] = [];
    if (dateIso) {
      const label = formatDateNarrative(dateIso);
      parts.push(`Most recent fall: ${label}.`);
      sources.push(
        dateFromAnswer && dateAnswer
          ? sourceFromAnswer(dateAnswer, label)
          : sourceFromFallsSnapshot('mostRecentFallDate', label),
      );
    }
    if (injury != null) {
      parts.push(`Injury reported: ${yesNoLabel(injury)}.`);
      sources.push(
        injuryFromAnswer != null && injuryAnswer
          ? sourceFromAnswer(injuryAnswer, yesNoLabel(injury))
          : sourceFromFallsSnapshot('injuryCaused', yesNoLabel(injury)),
      );
    }
    if (parts.length > 0) {
      const text = parts.join(' ').trim();
      suggestions.push(
        buildSuggestion({
          field: circumstancesField,
          ia,
          kind: 'value',
          suggestedValue: text,
          displayText: text,
          sources,
          transform: 'narrative',
        }),
      );
    }
  }

  const injuryField = resolveCarePlanField(fields, 'Falls history', 'Injury from previous falls', 'YES_NO');
  if (injuryField) {
    const injuryAnswer = findEnterpriseIaAnswer(answers, {
      specRef: '12.7',
      questionTextContains: 'injury caused by fall',
    });
    const injuryFromAnswer = resolveIaBooleanValue(injuryAnswer);
    const injury = injuryFromAnswer ?? snapshotBoolean(ia, 'injuryCaused');
    if (injury != null) {
      suggestions.push(
        buildSuggestion({
          field: injuryField,
          ia,
          kind: 'value',
          suggestedValue: injury,
          displayText: yesNoLabel(injury),
          sources: [
            injuryFromAnswer != null && injuryAnswer
              ? sourceFromAnswer(injuryAnswer, yesNoLabel(injury))
              : sourceFromFallsSnapshot('injuryCaused', yesNoLabel(injury)),
          ],
          transform: 'typed',
        }),
      );
    }
  }

  const aidsField =
    resolveCarePlanField(fields, 'Prevention plan', 'Mobility aids in use', 'TEXT') ??
    resolveCarePlanField(fields, 'Prevention plan', 'Mobility aids in use', 'TEXTAREA');
  if (aidsField) {
    const hoist = findEnterpriseIaAnswer(answers, {
      fieldKey: 'usesHoistOrSling',
      specRef: '12.5a',
      questionTextContains: 'uses hoist or sling',
    });
    const clinical = findEnterpriseIaAnswer(answers, {
      fieldKey: 'clinicalEquipmentInUse',
      specRef: '12.8',
      questionTextContains: 'hoist / profiling bed / air mattress',
    });
    const details = findEnterpriseIaAnswer(answers, {
      specRef: '12.10',
      questionTextContains: 'further equipment details',
    });
    const parts: string[] = [];
    const sources: CarePlanSuggestionSourceQuestion[] = [];
    if (resolveIaBooleanValue(hoist) === true && hoist) {
      parts.push('Hoist or sling in use.');
      sources.push(sourceFromAnswer(hoist, 'Yes'));
    }
    const equipmentSummary = ia.equipmentSelectionSummary?.trim();
    if (equipmentSummary) {
      parts.push(equipmentSummary.endsWith('.') ? equipmentSummary : `${equipmentSummary}.`);
      sources.push({
        questionId: 'equipment-selection:worksheet',
        sourceSection: 'IA Equipment Selection',
        sourceLabel: 'Equipment selection',
        sourceValue: equipmentSummary,
      });
    } else if (resolveIaBooleanValue(clinical) === true && clinical) {
      // Legacy §12.8 Yes/No — kept for historical submissions until soft-deleted.
      parts.push('Hoist / profiling bed / air mattress in use.');
      sources.push(sourceFromAnswer(clinical, 'Yes'));
    }
    const detailText = details?.textValue?.trim();
    if (detailText && details) {
      parts.push(detailText);
      sources.push(sourceFromAnswer(details, detailText));
    }
    if (parts.length > 0) {
      const text = parts.join(' ').trim();
      suggestions.push(
        buildSuggestion({
          field: aidsField,
          ia,
          kind: 'value',
          suggestedValue: text,
          displayText: text,
          sources,
          transform: 'join',
        }),
      );
    } else {
      const workingOrder = findEnterpriseIaAnswer(answers, {
        specRef: '12.8',
        questionTextContains: 'mobilising aids in good working order',
      });
      const working = resolveIaBooleanValue(workingOrder);
      if (working != null && workingOrder) {
        suggestions.push(
          buildSuggestion({
            field: aidsField,
            ia,
            kind: 'context',
            suggestedValue: null,
            displayText: `Mobilising aids in good working order: ${yesNoLabel(working)}. No specific aid recorded.`,
            sources: [sourceFromAnswer(workingOrder, yesNoLabel(working))],
            transform: 'context',
          }),
        );
      }
    }
  }

  const hazardsField = resolveCarePlanField(
    fields,
    'Prevention plan',
    'Environmental hazards identified',
    'TEXTAREA',
  );
  if (hazardsField) {
    const trip = findEnterpriseIaAnswer(answers, {
      specRef: '3.7',
      questionTextContains: 'trip hazards identified',
    });
    const notes = findEnterpriseIaAnswer(answers, {
      specRef: '3.10',
      questionTextContains: 'environment / access hazard notes',
    });
    const parts: string[] = [];
    const sources: CarePlanSuggestionSourceQuestion[] = [];
    const tripValue = resolveIaBooleanValue(trip);
    if (tripValue != null && trip) {
      parts.push(`Trip hazards identified: ${yesNoLabel(tripValue)}.`);
      sources.push(sourceFromAnswer(trip, yesNoLabel(tripValue)));
    }
    const noteText = notes?.textValue?.trim();
    if (noteText && notes) {
      parts.push(noteText);
      sources.push(sourceFromAnswer(notes, noteText));
    }
    if (parts.length > 0) {
      const text = parts.join(' ').trim();
      suggestions.push(
        buildSuggestion({
          field: hazardsField,
          ia,
          kind: 'value',
          suggestedValue: text,
          displayText: text,
          sources,
          transform: 'narrative',
        }),
      );
    }
  }

  const transferField = resolveCarePlanField(
    fields,
    'Prevention plan',
    'Transfers – instructions',
    'TEXTAREA',
  );
  if (transferField) {
    const comments = findEnterpriseIaAnswer(answers, {
      specRef: '12.5c',
      questionTextContains: 'transfer comments',
    });
    const commentText = comments?.textValue?.trim();
    if (commentText && comments) {
      suggestions.push(
        buildSuggestion({
          field: transferField,
          ia,
          kind: 'value',
          suggestedValue: commentText,
          displayText: commentText,
          sources: [sourceFromAnswer(comments, commentText)],
          transform: 'direct',
        }),
      );
    } else {
      const support = findEnterpriseIaAnswer(answers, {
        fieldKey: 'transferSupportRequired',
        specRef: '12.5c',
        questionTextContains: 'transfer support required',
      });
      const independent = findEnterpriseIaAnswer(answers, {
        specRef: '12.5c',
        questionTextContains: 'independent with all transfers',
      });
      const sources: CarePlanSuggestionSourceQuestion[] = [];
      const facts: string[] = [];
      const supportValue = resolveIaBooleanValue(support);
      if (supportValue != null && support) {
        facts.push(`Transfer support required: ${yesNoLabel(supportValue)}.`);
        sources.push(sourceFromAnswer(support, yesNoLabel(supportValue)));
      }
      const independentValue = resolveIaBooleanValue(independent);
      if (independentValue != null && independent) {
        facts.push(`Independent with all transfers: ${yesNoLabel(independentValue)}.`);
        sources.push(sourceFromAnswer(independent, yesNoLabel(independentValue)));
      }
      if (facts.length > 0) {
        suggestions.push(
          buildSuggestion({
            field: transferField,
            ia,
            kind: 'context',
            suggestedValue: null,
            displayText: `${facts.join(' ')} No transfer instructions recorded.`,
            sources,
            transform: 'context',
          }),
        );
      }
    }
  }

  return suggestions;
}

function fallsEvidence(
  ia: CarePlanComposeIaSnapshot | null,
  serviceUserId: string,
  suggestions: CarePlanFieldSuggestion[],
): ComposeEvidenceItem[] {
  if (!ia) return [];
  const items: ComposeEvidenceItem[] = [
    {
      id: `ia-submission-${ia.submissionId}`,
      source: 'ia',
      label: ia.status === 'SUBMITTED' ? 'Initial Assessment · Awaiting manager review' : 'Initial Assessment',
      value: ia.submittedAt
        ? `Submitted ${ia.submittedAt.slice(0, 10)}`
        : 'Submitted assessment on file',
      route: iaRoute(serviceUserId, 12),
    },
  ];

  if (ia.fallsSnapshot?.caseFindingReasons?.length) {
    items.push({
      id: `ia-falls-case-finding-${ia.submissionId}`,
      source: 'ia',
      label: 'Falls case-finding',
      value: ia.fallsSnapshot.caseFindingReasons.join(', '),
      route: iaRoute(serviceUserId, 12),
    });
  } else if (ia.fallsSnapshot?.riskLevel) {
    // Older submissions only: a stored score is shown as history, never as a prediction.
    const score =
      ia.fallsSnapshot.riskScore != null ? ` (score ${ia.fallsSnapshot.riskScore})` : '';
    items.push({
      id: `ia-falls-risk-${ia.submissionId}`,
      source: 'ia',
      label: 'Falls risk (legacy score)',
      value: `${ia.fallsSnapshot.riskLevel}${score}`,
      route: iaRoute(serviceUserId, 12),
    });
  }

  if (ia.fallsScreeningSummary) {
    items.push({
      id: `ia-falls-screening-${ia.submissionId}`,
      source: 'ia',
      label: 'Falls screening',
      value: ia.fallsScreeningSummary,
      route: iaRoute(serviceUserId, 12),
    });
  }

  for (const suggestion of suggestions.filter((s) => s.kind === 'context')) {
    items.push({
      id: `ia-context-${suggestion.id}`,
      source: 'ia',
      label: suggestion.targetLabel,
      value: suggestion.displayText,
      route: iaRoute(serviceUserId, 12),
    });
  }

  return items;
}

function fallsGaps(fields: CarePlanFormFieldRef[], suggestions: CarePlanFieldSuggestion[]): ComposeGap[] {
  const transfer = resolveCarePlanField(
    fields,
    'Prevention plan',
    'Transfers – instructions',
    'TEXTAREA',
  );
  if (!transfer?.required) return [];
  const hasValue = suggestions.some(
    (s) => s.targetFieldKey === transfer.key && s.kind === 'value' && s.suggestedValue != null,
  );
  if (hasValue) return [];
  return [
    {
      fieldKey: transfer.key,
      label: transfer.label,
      severity: 'warning',
      fixes: [],
    },
  ];
}

export function composeFallsCarePlanSuggestions(
  ia: CarePlanComposeIaSnapshot | null,
  previous: CarePlanComposeIaSnapshot[],
  fields: CarePlanFormFieldRef[],
  serviceUserId: string,
): ComposePlanResult {
  const suggestions = ia ? buildFallsFieldSuggestions(ia, fields) : [];
  const previousAssessments: CarePlanPreviousAssessment[] = previous
    .filter((row): row is CarePlanComposeIaSnapshot & { status: NonNullable<CarePlanComposeIaSnapshot['status']> } =>
      Boolean(row.status),
    )
    .map((row) => ({
      submissionId: row.submissionId,
      submittedAt: row.submittedAt,
      status: row.status,
      suggestions: buildFallsFieldSuggestions(row, fields).filter((s) => s.kind === 'value'),
    }));

  return {
    values: {},
    fieldSources: {},
    gaps: fallsGaps(fields, suggestions),
    evidence: fallsEvidence(ia, serviceUserId, suggestions),
    suggestionMode: 'explicit',
    suggestions,
    previousAssessments,
    iaStatus: ia?.status ?? null,
    composedFrom: {
      formName: FALLS_FORM_NAME,
      mapping: 'falls-suggestions',
      iaSubmissionId: ia?.submissionId ?? null,
      iaStatus: ia?.status ?? null,
      composedAt: new Date().toISOString(),
    },
  };
}

export function displayValueForAnswer(answer: SubmissionAnswerForRules): string {
  const bool = resolveIaBooleanValue(answer);
  if (bool != null) return yesNoLabel(bool);
  const num = resolveIaNumberValue(answer);
  if (num != null) return String(num);
  const dateIso = resolveIaDateIso(answer);
  if (dateIso) return formatDateNarrative(dateIso);
  return resolveIaDisplayValue(answer) ?? '';
}
