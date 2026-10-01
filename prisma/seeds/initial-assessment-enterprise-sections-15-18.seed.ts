import { InitialAssessmentQuestionType } from '@prisma/client';
import {
  BED_RAILS_REQUIRED_IN_PLACE_OPTIONS,
  INFECTION_PRECAUTION_OPTIONS,
  PPE_REQUIRED_OPTIONS,
} from './initial-assessment-enterprise-options';
import { iaMeta, whenFieldNo, whenFieldYes, whenYes } from './initial-assessment-enterprise-metadata';
import type { EnterpriseQuestionSeed } from './initial-assessment-enterprise-sections-5-10.seed';

const Y = InitialAssessmentQuestionType.YES_NO;
const T = InitialAssessmentQuestionType.TEXT;
const A = InitialAssessmentQuestionType.TEXTAREA;
const D = InitialAssessmentQuestionType.DATE;
const S = InitialAssessmentQuestionType.SINGLE_SELECT;
const M = InitialAssessmentQuestionType.MULTI_SELECT;

/** §15 Infection and Clinical Precautions — dedicated catalogue section. */
export const SECTION_15_QUESTIONS: EnterpriseQuestionSeed[] = [
  {
    questionText: 'Are infection control precautions required?',
    questionType: Y,
    isRequired: true,
    sortOrder: 1,
    metadata: iaMeta('15.1', { fieldKey: 'infectionPrecautionsRequired' }),
  },
  {
    questionText: 'Precautions staff need to follow',
    questionType: M,
    sortOrder: 2,
    options: INFECTION_PRECAUTION_OPTIONS,
    metadata: iaMeta('15.1', { fieldKey: 'infectionPrecautionsNeeded', ...whenFieldYes('infectionPrecautionsRequired') }),
  },
  {
    questionText: 'PPE required',
    questionType: M,
    sortOrder: 3,
    options: PPE_REQUIRED_OPTIONS,
    metadata: iaMeta('15.2', { fieldKey: 'ppeRequired', ...whenFieldYes('infectionPrecautionsRequired') }),
  },
  {
    questionText: 'Staff precautions and hygiene instructions',
    questionType: A,
    sortOrder: 4,
    metadata: iaMeta('15.2', { fieldKey: 'infectionStaffInstructions', ...whenFieldYes('infectionPrecautionsRequired') }),
  },
  {
    questionText: 'Escalation or reporting instructions',
    questionType: A,
    sortOrder: 5,
    metadata: iaMeta('15.3', { fieldKey: 'infectionEscalationInstructions', ...whenFieldYes('infectionPrecautionsRequired') }),
  },
];

/**
 * §16 Personal Emergency Evacuation Plan — person-specific evacuation (holistic tab 19).
 * Property escape stays on §18 Fire Safety.
 */
export const SECTION_16_QUESTIONS: EnterpriseQuestionSeed[] = [
  {
    questionText: 'Can the person self-evacuate in an emergency?',
    questionType: Y,
    isRequired: true,
    sortOrder: 1,
    metadata: iaMeta('16.1', { fieldKey: 'canSelfEvacuate' }),
  },
  {
    questionText: 'Assistance required to evacuate',
    questionType: A,
    isRequired: true,
    sortOrder: 2,
    metadata: iaMeta('16.2', { fieldKey: 'peepAssistanceRequired', ...whenFieldNo('canSelfEvacuate') }),
  },
  {
    questionText: 'Equipment required to evacuate',
    questionType: A,
    isRequired: true,
    sortOrder: 3,
    metadata: iaMeta('16.2', { fieldKey: 'peepEquipmentRequired', ...whenFieldNo('canSelfEvacuate') }),
  },
  {
    questionText: 'Evacuation procedure',
    questionType: A,
    isRequired: true,
    sortOrder: 4,
    metadata: iaMeta('16.3', { fieldKey: 'peepEvacuationProcedure', ...whenFieldNo('canSelfEvacuate') }),
  },
  {
    questionText: 'Alarm and warning considerations',
    questionType: A,
    isRequired: true,
    sortOrder: 5,
    metadata: iaMeta('16.4', { fieldKey: 'peepAlarmWarningConsiderations', ...whenFieldNo('canSelfEvacuate') }),
  },
  {
    questionText: 'Refuge or waiting location',
    questionType: T,
    isRequired: true,
    sortOrder: 6,
    metadata: iaMeta('16.5', { fieldKey: 'peepRefugeLocation', ...whenFieldNo('canSelfEvacuate') }),
  },
  {
    questionText: 'Has this PEEP been discussed with the person?',
    questionType: Y,
    isRequired: true,
    sortOrder: 7,
    metadata: iaMeta('16.6', { fieldKey: 'peepDiscussedWithPerson', ...whenFieldNo('canSelfEvacuate') }),
  },
  {
    questionText: 'PEEP review date',
    questionType: D,
    isRequired: true,
    sortOrder: 8,
    metadata: iaMeta('16.7', { fieldKey: 'peepReviewDate', ...whenFieldNo('canSelfEvacuate') }),
  },
];

/**
 * §17 Bed Rails — initial IA screen (holistic tab 20).
 * The Care Pathway Bed Rail Assessment remains the annual specialist form.
 */
export const SECTION_17_QUESTIONS: EnterpriseQuestionSeed[] = [
  {
    questionText: 'Are bed rails in use or being considered?',
    questionType: Y,
    isRequired: true,
    sortOrder: 1,
    metadata: iaMeta('17.1', { fieldKey: 'bedRailsInUseOrConsidered' }),
  },
  {
    questionText: 'Are bed rails required and in place?',
    questionType: S,
    isRequired: true,
    sortOrder: 2,
    options: BED_RAILS_REQUIRED_IN_PLACE_OPTIONS,
    metadata: iaMeta('17.2', { fieldKey: 'bedRailsRequiredInPlace', ...whenFieldYes('bedRailsInUseOrConsidered') }),
  },
  {
    questionText: 'Reason bed rails are in use or being considered',
    questionType: A,
    isRequired: true,
    sortOrder: 3,
    metadata: iaMeta('17.3', { fieldKey: 'bedRailsReason', ...whenFieldYes('bedRailsInUseOrConsidered') }),
  },
  {
    questionText: 'Alternatives to bed rails considered',
    questionType: A,
    isRequired: true,
    sortOrder: 4,
    metadata: iaMeta('17.4', { fieldKey: 'bedRailsAlternativesConsidered', ...whenFieldYes('bedRailsInUseOrConsidered') }),
  },
  {
    questionText: 'Entrapment risk identified?',
    questionType: Y,
    isRequired: true,
    riskFlag: true,
    sortOrder: 5,
    metadata: iaMeta('17.5', { fieldKey: 'bedRailsEntrapmentRisk', ...whenFieldYes('bedRailsInUseOrConsidered') }),
  },
  {
    questionText: 'Entrapment risk details',
    questionType: A,
    isRequired: true,
    sortOrder: 6,
    metadata: iaMeta('17.5', { fieldKey: 'bedRailsEntrapmentDetails', ...whenFieldYes('bedRailsEntrapmentRisk') }),
  },
  {
    questionText: 'Consent and capacity considerations (discussion notes)',
    questionType: A,
    isRequired: true,
    sortOrder: 7,
    helpText: 'Record the discussion only. This is not a legal capacity finding.',
    metadata: iaMeta('17.6', { fieldKey: 'bedRailsConsentCapacityNotes', ...whenFieldYes('bedRailsInUseOrConsidered') }),
  },
  {
    questionText: 'Bed rails review date',
    questionType: D,
    isRequired: true,
    sortOrder: 8,
    metadata: iaMeta('17.7', { fieldKey: 'bedRailsReviewDate', ...whenFieldYes('bedRailsInUseOrConsidered') }),
  },
  {
    questionText: 'Bed rails additional notes',
    questionType: A,
    sortOrder: 9,
    metadata: iaMeta('17.8', { fieldKey: 'bedRailsNotes', completenessExempt: true }),
  },
];

/**
 * §18 Fire Safety — property hazards and arrangements.
 * Existing fire questions are rehomed here with the same UUIDs; do not duplicate them.
 */
export const SECTION_18_QUESTIONS: EnterpriseQuestionSeed[] = [
  {
    questionText: 'Any fire safety risks identified?',
    questionType: Y,
    isRequired: true,
    riskFlag: true,
    sortOrder: 1,
    metadata: iaMeta('18.1', { fieldKey: 'fireSafetyRisksIdentified' }),
  },
  {
    questionText: 'Any fire safety risks identified? (Please state)',
    questionType: A,
    sortOrder: 2,
    metadata: iaMeta('18.1', { fieldKey: 'fireSafetyRisksDetails', ...whenYes('Any fire safety risks identified?') }),
  },
  {
    questionText: 'Local fire and rescue service informed (home fire safety visit)?',
    questionType: Y,
    isRequired: true,
    sortOrder: 3,
    metadata: iaMeta('18.2', { fieldKey: 'londonFireBrigadeInformed' }),
  },
  {
    questionText: 'Local fire and rescue service — details',
    questionType: A,
    sortOrder: 4,
    metadata: iaMeta('18.2', { fieldKey: 'londonFireBrigadeDetails', ...whenFieldYes('londonFireBrigadeInformed') }),
  },
  {
    questionText: 'Smoke alarm fitted and working?',
    questionType: Y,
    isRequired: true,
    sortOrder: 5,
    metadata: iaMeta('18.3', { fieldKey: 'smokeAlarmFittedWorking' }),
  },
  {
    questionText: 'Referral required for smoke, CO or fire alarm?',
    questionType: Y,
    carePlanTrigger: true,
    sortOrder: 6,
    metadata: iaMeta('18.3', { fieldKey: 'smokeCoFireAlarmReferral' }),
  },
  {
    questionText: 'Smoking in property?',
    questionType: Y,
    sortOrder: 7,
    metadata: iaMeta('18.4', { fieldKey: 'smokingInProperty' }),
  },
  {
    questionText: 'Cooking left unattended risk?',
    questionType: Y,
    sortOrder: 8,
    metadata: iaMeta('18.5', { fieldKey: 'cookingLeftUnattendedRisk' }),
  },
  {
    questionText: 'Cooking-related fire risk details',
    questionType: A,
    sortOrder: 9,
    metadata: iaMeta('18.5', { fieldKey: 'cookingFireRiskDetails', ...whenFieldYes('cookingLeftUnattendedRisk') }),
  },
  {
    questionText: 'Primary escape route from the property',
    questionType: A,
    isRequired: true,
    sortOrder: 10,
    helpText: 'Describe the property escape route. Personal evacuation support is recorded separately in PEEP.',
    metadata: iaMeta('18.6', { fieldKey: 'primaryEscapeRoute' }),
  },
  {
    questionText: 'Emergency fire arrangements',
    questionType: A,
    sortOrder: 11,
    helpText: 'Alarm access, meeting point, and other property fire arrangements — not personal evacuation.',
    metadata: iaMeta('18.6', { fieldKey: 'fireEmergencyArrangements' }),
  },
];
