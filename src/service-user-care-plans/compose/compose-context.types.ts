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

export type CarePlanComposeContext = {
  serviceUserId: string;
  serviceUserName: string;
  personalisation: CarePlanPersonalisationContext;
  ia: {
    submissionId: string;
    submittedAt: string | null;
    answers: SubmissionAnswerForRules[];
  } | null;
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
};

export type ComposeFieldResult = {
  fieldKey: string;
  label: string;
  value: string | boolean | null;
  source: 'ia' | 'about_me' | 'profile' | 'contacts' | 'allergies' | 'emar' | 'medication_pack' | 'static';
  sourceLabel: string;
};

export type ComposePlanResult = {
  values: Record<string, string | boolean>;
  fieldSources: Record<string, ComposeFieldResult['source']>;
  gaps: ComposeGap[];
  evidence: ComposeEvidenceItem[];
  composedFrom: Record<string, unknown>;
};
