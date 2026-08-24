import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import type { AboutMeComposeSummary } from './about-me-compose-summary.util';

export type { AboutMeComposeSummary };

export type ComposeEvidenceItem = {
  id: string;
  source: 'ia' | 'about_me' | 'profile' | 'contacts' | 'allergies' | 'emar' | 'medication_pack';
  label: string;
  value: string;
  route?: string;
};

export type ComposeGap = {
  fieldKey: string;
  label: string;
  severity: 'blocking' | 'warning';
  fixes: Array<{ label: string; route: string }>;
};

export type EmarComposeSummary = {
  activeCount: number;
  scheduledCount: number;
  prnCount: number;
  medListText: string;
  prnText: string;
};

export type MedicationPackComposeSummary = {
  packId: string;
  name: string;
  packType: string | null;
  cycleNumber: number | null;
  pharmacyLine: string | null;
  gpLine: string | null;
  storageLine: string | null;
};

export type CarePlanComposeIaStatus = 'SUBMITTED' | 'REVIEWED';

export type CarePlanFallsSnapshotEvidence = {
  fallsLast12Months: boolean | null;
  numberOfFalls: number | null;
  mostRecentFallDate: string | null;
  injuryCaused: boolean | null;
  riskScore: number | null;
  riskLevel: string | null;
};

export type CarePlanComposeIaSnapshot = {
  submissionId: string;
  submittedAt: string | null;
  status?: CarePlanComposeIaStatus;
  answers: SubmissionAnswerForRules[];
  fallsSnapshot?: CarePlanFallsSnapshotEvidence | null;
  fallsScreeningSummary?: string | null;
};

export type CarePlanComposeContext = {
  serviceUserId: string;
  serviceUserName: string;
  personalisation: CarePlanPersonalisationContext;
  ia: CarePlanComposeIaSnapshot | null;
  previousAssessments?: CarePlanComposeIaSnapshot[];
  aboutMe: AboutMeComposeSummary | null;
  emergencyContacts: string[];
  allergies: string[];
  emar: EmarComposeSummary;
  pack: MedicationPackComposeSummary | null;
  gpPharmacyLine: string | null;
};

export type CarePlanComposeDelta = {
  fieldKey: string;
  label: string;
  publishedValue: string | boolean | null;
  composedValue: string | boolean | null;
};

export type CarePlanFormFieldRef = {
  key: string;
  sectionId: string;
  fieldId: string;
  label: string;
  fieldType: string;
  required: boolean;
  sectionTitle?: string;
};

export type ComposeFieldResult = {
  fieldKey: string;
  label: string;
  value: string | boolean | null;
  source: 'ia' | 'about_me' | 'profile' | 'contacts' | 'allergies' | 'emar' | 'medication_pack' | 'static';
  sourceLabel: string;
};

export type CarePlanSuggestionKind = 'value' | 'context';

export type CarePlanSuggestionSourceQuestion = {
  questionId: string;
  questionFieldKey?: string;
  specRef?: string;
  sourceSection: string;
  sourceLabel: string;
  sourceValue: string;
};

export type CarePlanFieldSuggestion = {
  id: string;
  kind: CarePlanSuggestionKind;
  targetFieldKey: string;
  targetLabel: string;
  targetFieldType: string;
  suggestedValue: string | boolean | null;
  displayText: string;
  sourceType: 'INITIAL_ASSESSMENT';
  submissionId: string;
  sourceDate: string | null;
  questionId?: string;
  questionFieldKey?: string;
  specRef?: string;
  sourceSection?: string;
  sourceLabel?: string;
  sourceValue?: string;
  sourceQuestions: CarePlanSuggestionSourceQuestion[];
  transform: 'direct' | 'typed' | 'narrative' | 'join' | 'context';
};

export type CarePlanPreviousAssessment = {
  submissionId: string;
  submittedAt: string | null;
  status: CarePlanComposeIaStatus;
  suggestions: CarePlanFieldSuggestion[];
};

export type ComposePlanResult = {
  values: Record<string, string | boolean>;
  fieldSources: Record<string, ComposeFieldResult['source']>;
  gaps: ComposeGap[];
  evidence: ComposeEvidenceItem[];
  composedFrom: Record<string, unknown>;
  suggestionMode?: 'explicit';
  suggestions?: CarePlanFieldSuggestion[];
  previousAssessments?: CarePlanPreviousAssessment[];
  iaStatus?: CarePlanComposeIaStatus | null;
};
