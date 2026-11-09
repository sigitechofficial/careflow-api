import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import type { CarePlanPersonalisationContext } from '../../care-plan-text/care-plan-text.util';
import type { AboutMeComposeSummary } from './about-me-compose-summary.util';
import type { AdlComposeMetadata } from './compose-adl-metadata.util';
import type { CarePlanWaterlowComposeMetadata } from './compose-waterlow-metadata.util';
import type { CarePlanPainAssessmentComposeMetadata } from './compose-pain-assessment-metadata.util';

export type { AboutMeComposeSummary };

/** explicit = suggestions only (Falls). hybrid = partial auto-prefill + suggestions (HSP). */
export type CarePlanSuggestionMode = 'explicit' | 'hybrid';

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

export type CarePlanComposeIaStatus = 'SUBMITTED' | 'REVIEWED' | 'IN_PROGRESS';

export type CarePlanFallsSnapshotEvidence = {
  fallsLast12Months: boolean | null;
  numberOfFalls: number | null;
  mostRecentFallDate: string | null;
  injuryCaused: boolean | null;
  riskScore: number | null;
  riskLevel: string | null;
  /** Falls case-finding reasons (fall, unsteadiness, fear, concern) — no predictive score. */
  caseFindingReasons?: string[];
};

/** Demo / worksheet medication snapshot when enterprise §9 detail questions were pruned. */
export type CarePlanMedicationSnapshotEvidence = {
  supportLevel: string | null;
  allergyDetails: string | null;
  currentMedicationDetails: string | null;
  prnProtocol: string | null;
  packagingHelpRequired: boolean | null;
  storageNotes: string | null;
  safetyNotes: string | null;
};

/** Demo / worksheet continence snapshot when detail questions are sparse or pruned. */
export type CarePlanContinenceSnapshotEvidence = {
  bladderStatus: string | null;
  bowelStatus: string | null;
  productsUsed: string | null;
  toiletingRoutine: string | null;
  fluidGuidance: string | null;
  skinCareAfterEpisodes: string | null;
};

/** Demo / worksheet eating & drinking snapshot. */
export type CarePlanEatingDrinkingSnapshotEvidence = {
  dietType: string | null;
  fluidTargetMl: string | null;
  foodAllergiesIntolerances: string | null;
  mealAssistanceLevel: string | null;
  chokingSaltGuidance: string | null;
  preferredFoodsDislikes: string | null;
};

/** Demo / worksheet skin integrity snapshot. */
export type CarePlanSkinIntegritySnapshotEvidence = {
  skinTypeIssues: string | null;
  emollientsCreams: string | null;
  previousPressureDamage: boolean | null;
  creamApplication: string | null;
  signsToReport: string | null;
};

/** Demo / worksheet personal safety snapshot. */
export type CarePlanPersonalSafetySnapshotEvidence = {
  homeHazards: string | null;
  fireSafety: string | null;
  loneWorkerRisk: string | null;
  safeguardingOnFile: boolean | null;
  actionsInPlace: string | null;
  emergencyContacts: string | null;
};

/** Demo / worksheet communication snapshot. */
export type CarePlanCommunicationSnapshotEvidence = {
  preferredLanguage: string | null;
  hearingImpairment: boolean | null;
  visionImpairment: boolean | null;
  communicationMethod: string | null;
  staffGuidance: string | null;
  aids: string | null;
  consentSharing: boolean | null;
};

export type CarePlanComposeIaSnapshot = {
  submissionId: string;
  submittedAt: string | null;
  status?: CarePlanComposeIaStatus;
  answers: SubmissionAnswerForRules[];
  fallsSnapshot?: CarePlanFallsSnapshotEvidence | null;
  fallsScreeningSummary?: string | null;
  /** IA Equipment Selection worksheet summary (submission.metadata.equipmentSelection). */
  equipmentSelectionSummary?: string | null;
  medicationSnapshot?: CarePlanMedicationSnapshotEvidence | null;
  continenceSnapshot?: CarePlanContinenceSnapshotEvidence | null;
  eatingDrinkingSnapshot?: CarePlanEatingDrinkingSnapshotEvidence | null;
  skinIntegritySnapshot?: CarePlanSkinIntegritySnapshotEvidence | null;
  personalSafetySnapshot?: CarePlanPersonalSafetySnapshotEvidence | null;
  communicationSnapshot?: CarePlanCommunicationSnapshotEvidence | null;
  /** Enterprise IA §12 ADL worksheet (submission.metadata.adl). */
  adlMetadata?: AdlComposeMetadata | null;
  /**
   * Enterprise IA Waterlow worksheet (submission.metadata.waterlow). Loaded additively;
   * only the Pressure Ulcer compose reads it. Other plans ignore it.
   */
  waterlowMetadata?: CarePlanWaterlowComposeMetadata | null;
  /**
   * Enterprise IA Pain Assessment Tool (submission.metadata.painAssessment). Loaded additively;
   * only the Pain Management compose reads it. Other plans ignore it.
   */
  painAssessmentMetadata?: CarePlanPainAssessmentComposeMetadata | null;
};

/**
 * Structured legal-document record (ServiceUserLegalDocument) — the maintained source of
 * truth for DNACPR status/location, better than the point-in-time IA §13.6 answer. Loaded
 * additively; only the Final Days compose reads it, every other plan ignores it.
 */
export type CarePlanLegalDocumentEvidence = {
  dnacprInPlace: boolean;
  dnacprStatusConfirmation: string;
  dnacprPhysicalLocation: string | null;
  dnacprStartDate: string | null;
};

/**
 * Read-only service-user profile facts loaded from the ServiceUser system-of-record. Used to
 * PREFILL person-centred fields (e.g. preferred name, date of birth, phone, address) without
 * duplicating the source: the value is read from the profile at compose time. Optional so
 * existing consumers/tests that don't set it are unaffected.
 */
export type CarePlanComposeProfile = {
  preferredName: string | null;
  /** ISO yyyy-mm-dd, or null. */
  dateOfBirth: string | null;
  phone: string | null;
  /** Formatted multi-line home address, or null. */
  homeAddress: string | null;
  /** Access instructions / key-safe notes from the address record, or null. */
  propertyAccessInstructions: string | null;
  /** Current carer gender preference (DOM Care: male / female / case_by_case), or null. Wins over the assessment answer. */
  staffGenderPreference?: string | null;
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
  /** True when the GP line came from Contacts (the person's GP), so the pack's printed GP is not repeated. */
  hasGpContact?: boolean;
  /** Structured legal-document record; null when the service user has none on file. */
  legalDocument?: CarePlanLegalDocumentEvidence | null;
  /** Read-only profile facts for person-centred prefill; null/undefined when unavailable. */
  profile?: CarePlanComposeProfile | null;
  /** Care Pathway review frequency in calendar months (1/2/3/6/12). */
  reviewFrequencyMonths?: number | null;
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
  /** Stable business key from CarePathwayFormField.fieldKey (e.g. hsp_lives_alone). */
  fieldKey?: string | null;
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

export type CarePlanFieldProvenance = {
  sourceType: 'INITIAL_ASSESSMENT';
  submissionId: string;
  questionId?: string;
  sourceQuestions?: CarePlanSuggestionSourceQuestion[];
  acceptedAt: string;
  acceptedById?: string | null;
  originalValue: string | boolean | null;
  sourceDate: string | null;
  userEdited?: boolean;
  /** True when value was auto-prefilled from IA (hybrid tier A) without user confirmation. */
  autoPrefilled?: boolean;
};

export type ComposePlanResult = {
  values: Record<string, string | boolean>;
  fieldSources: Record<string, ComposeFieldResult['source']>;
  gaps: ComposeGap[];
  evidence: ComposeEvidenceItem[];
  composedFrom: Record<string, unknown>;
  /** Per-field IA provenance keyed by runtime field key ({sectionId}:{fieldId}). */
  provenance?: Record<string, CarePlanFieldProvenance>;
  suggestionMode?: CarePlanSuggestionMode;
  suggestions?: CarePlanFieldSuggestion[];
  previousAssessments?: CarePlanPreviousAssessment[];
  iaStatus?: CarePlanComposeIaStatus | null;
};
