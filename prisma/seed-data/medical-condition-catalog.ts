import type { MedicalConditionCategory } from '@prisma/client';

export type MedicalConditionCatalogSeedEntry = {
  code: string;
  name: string;
  category: MedicalConditionCategory;
  description?: string;
};

/**
 * Controlled medical-condition catalogue for Medical & Alerts.
 * Idempotent seed by `code`. Does not invent clinical diagnoses for service users.
 * Age-range demographics from reference screens are intentionally excluded.
 */
export const DEFAULT_MEDICAL_CONDITION_CATALOG: MedicalConditionCatalogSeedEntry[] = [
  // Existing (unchanged codes / names)
  { code: 'ANXIETY', name: 'Anxiety', category: 'MENTAL_HEALTH' },
  { code: 'ASD', name: 'Autism Spectrum Disorder', category: 'DEVELOPMENTAL' },
  { code: 'COPD', name: 'COPD', category: 'RESPIRATORY', description: 'Chronic obstructive pulmonary disease' },
  { code: 'CHD', name: 'Coronary Heart Disease', category: 'CARDIOVASCULAR' },
  { code: 'DEMENTIA', name: 'Dementia', category: 'NEUROLOGICAL' },
  { code: 'DIABETES', name: 'Diabetes', category: 'ENDOCRINE_METABOLIC' },
  { code: 'DOWN_SYNDROME', name: 'Down Syndrome', category: 'DEVELOPMENTAL' },
  { code: 'EPILEPSY', name: 'Epilepsy', category: 'NEUROLOGICAL' },
  { code: 'EATING_DISORDER', name: 'Eating Disorder', category: 'MENTAL_HEALTH' },
  { code: 'HEART_ATTACK', name: 'Heart Attack', category: 'CARDIOVASCULAR', description: 'Myocardial infarction (history or related)' },
  { code: 'HYPERTENSION', name: 'Hypertension', category: 'CARDIOVASCULAR' },
  { code: 'LEARNING_DISABILITY', name: 'Learning Disability', category: 'LEARNING_DISABILITY' },
  { code: 'MENTAL_HEALTH_NEEDS', name: 'Mental Health Needs', category: 'MENTAL_HEALTH' },
  { code: 'PALLIATIVE_CARE', name: 'Palliative Care', category: 'PALLIATIVE' },
  { code: 'SCHIZOPHRENIA', name: 'Schizophrenia', category: 'MENTAL_HEALTH' },
  { code: 'STROKE', name: 'Stroke', category: 'NEUROLOGICAL' },
  { code: 'ASTHMA', name: 'Asthma', category: 'RESPIRATORY' },
  { code: 'PARKINSONS', name: 'Parkinson’s Disease', category: 'NEUROLOGICAL' },
  { code: 'MULTIPLE_SCLEROSIS', name: 'Multiple Sclerosis', category: 'NEUROLOGICAL' },
  { code: 'HEARING_IMPAIRMENT', name: 'Hearing Impairment', category: 'OTHER' },
  { code: 'VISUAL_IMPAIRMENT', name: 'Visual Impairment', category: 'OTHER' },
  { code: 'ARTHRITIS', name: 'Arthritis', category: 'OTHER' },
  { code: 'CKD', name: 'Chronic Kidney Disease', category: 'OTHER' },
  { code: 'CANCER', name: 'Cancer', category: 'OTHER' },

  // Added from reference Medical Conditions screen (clinical / care flags only — no age ranges)
  { code: 'AGGRESSION', name: 'Aggression', category: 'MENTAL_HEALTH' },
  { code: 'ADHD', name: 'Attention Deficit Hyperactivity Disorder (ADHD)', category: 'DEVELOPMENTAL' },
  { code: 'BED_RAIL', name: 'Bed Rail', category: 'OTHER' },
  { code: 'MEDICATION_BY_CARER', name: 'Client Medication Administered by Carer', category: 'OTHER' },
  { code: 'DVT', name: 'Deep Vein Thrombosis', category: 'CARDIOVASCULAR' },
  { code: 'DETAINED_MHA', name: 'Detained Under Mental Health Act', category: 'MENTAL_HEALTH' },
  { code: 'DYSPHAGIA', name: 'Dysphagia (Swallowing Difficulties)', category: 'OTHER' },
  { code: 'END_OF_LIFE', name: 'End of Life', category: 'PALLIATIVE' },
  { code: 'HIGH_RISK_FALLS', name: 'High Risk of Falls', category: 'OTHER' },
  { code: 'LACK_CAPACITY', name: 'Lack Capacity', category: 'OTHER' },
  { code: 'HYPOTENSION', name: 'Low Blood Pressure', category: 'CARDIOVASCULAR' },
  { code: 'LUNG_DISEASE', name: 'Lung Disease/Issue', category: 'RESPIRATORY' },
  { code: 'MEDICATION', name: 'Medication', category: 'OTHER' },
  { code: 'MND', name: 'Motor Neurone Disease (MND)', category: 'NEUROLOGICAL' },
  { code: 'MOOD_DISORDER', name: 'Mood Disorder', category: 'MENTAL_HEALTH' },
  { code: 'NON_VERBAL', name: 'Non-verbal', category: 'OTHER' },
  { code: 'PHYSICAL_DISABILITIES', name: 'Physical Disabilities', category: 'OTHER' },
  { code: 'CARE_LOGS_CHECKED', name: 'Record of Care Logs Checked', category: 'OTHER' },
  { code: 'RESPIRATORY_DISEASE', name: 'Respiratory Disease', category: 'RESPIRATORY' },
  { code: 'SHORTNESS_OF_BREATH', name: 'Shortness of Breath', category: 'RESPIRATORY' },
  { code: 'SCD', name: 'Sickle Cell Disease (SCD)', category: 'OTHER' },
  { code: 'SCT', name: 'Sickle Cell Trait (SCT)', category: 'OTHER' },
  { code: 'SENSORY_IMPAIRMENT', name: 'Sensory Impairment', category: 'OTHER' },
  { code: 'SKIN_ULCERS_WOUNDS', name: 'Skin ulcers or wounds', category: 'OTHER' },
  { code: 'UTI', name: 'Urinary Tract Infection', category: 'OTHER' },
  { code: 'SUBSTANCE_MISUSE', name: 'Drugs or Alcohol Misuse', category: 'MENTAL_HEALTH' },
  { code: 'COMMUNITY_DOLS', name: 'Community DoLS', category: 'OTHER' },
  { code: 'COMMUNICATION_NEEDS', name: 'Communication Needs', category: 'OTHER' },

  // Added from Keep Private reference Medical Conditions screen (skip allergies / semantic duplicates)
  { code: 'ALZHEIMERS', name: "Alzheimer's", category: 'NEUROLOGICAL' },
  { code: 'BEHAVIOUR_CHALLENGES', name: 'Behaviour that Challenges', category: 'MENTAL_HEALTH' },
  { code: 'CHOKING_RISK', name: 'Choking Risk', category: 'OTHER' },
  { code: 'CREAM', name: 'Cream', category: 'OTHER' },
  { code: 'DOUBLE_HAND_CLIENT', name: 'Double Hand Client', category: 'OTHER' },
  { code: 'BEST_INTEREST_LACK_CAPACITY', name: 'Has Best Interest Lack Capacity', category: 'OTHER' },
  { code: 'MEAL_SUPPORT', name: 'Meal Support', category: 'OTHER' },
  { code: 'NEWLY_ASSESSED', name: 'Newly Assessed', category: 'OTHER' },
  { code: 'PERSONAL_CARE', name: 'Personal Care', category: 'OTHER' },
  { code: 'PRN_MEDICATIONS', name: 'PRN Medications', category: 'OTHER' },
  { code: 'WANDERING_RISK', name: 'Risk of Going Missing / Wander', category: 'OTHER' },
  { code: 'SMOKERS', name: 'Smokers', category: 'OTHER' },
  { code: 'PARAFFIN_BASE_CREAM', name: 'Use of Paraffin Base Cream', category: 'OTHER' },
  { code: 'ALCOHOLIC', name: 'Alcoholic', category: 'MENTAL_HEALTH' },
  { code: 'ANTICOAGULANTS', name: 'Anticoagulants', category: 'OTHER' },
  { code: 'BARCODE_PLACED', name: 'Barcode Placed', category: 'OTHER' },
  { code: 'BEST_INTEREST_COMPLETE', name: 'Best Interest Complete', category: 'OTHER' },
  { code: 'CRUSH_MEDICATION', name: 'Crush Medication', category: 'OTHER' },
  { code: 'DIALYSIS', name: 'Dialysis', category: 'OTHER' },
  { code: 'HAS_CAPACITY', name: 'Has Capacity', category: 'OTHER' },
  { code: 'HIV', name: 'HIV', category: 'OTHER' },
  { code: 'NUTRITION_HYDRATION', name: 'Nutrition and Hydration Needs', category: 'OTHER' },
  { code: 'PROMPT_ASSIST_MEDICATION', name: 'Prompt and Assist Medication', category: 'OTHER' },
  { code: 'SEIZURE', name: 'Seizure', category: 'NEUROLOGICAL' },
  { code: 'STOMA', name: 'Stoma', category: 'OTHER' },
  { code: 'BARRIER_CREAM', name: 'Barrier Cream', category: 'OTHER' },
  { code: 'CONFUSION_DELIRIUM', name: 'Confusion/Delirium', category: 'NEUROLOGICAL' },
  { code: 'DOMESTIC', name: 'Domestic', category: 'OTHER' },
  { code: 'LPA_OR_DEPUTY', name: 'Has LPA or Deputy in Place', category: 'OTHER' },
  { code: 'REPOSITIONING', name: 'Repositioning', category: 'OTHER' },
  { code: 'SELF_MEDICATE', name: 'Self-Medicate', category: 'OTHER' },
  { code: 'WEEKLY_NEW_PACKAGES', name: 'Weekly New Packages', category: 'OTHER' },
  { code: 'BODY_LOTION', name: 'Body Lotion', category: 'OTHER' },
  { code: 'DOMESTIC_SHOPPING', name: 'Domestic and Shopping', category: 'OTHER' },
  { code: 'ESCORT', name: 'Escort', category: 'OTHER' },
  { code: 'INITIAL_CONTACT_10_START', name: 'Initial Contact Within 10 of Start', category: 'OTHER' },
  { code: 'LOW_BODY_WEIGHT', name: 'Low Body Weight', category: 'OTHER' },
  { code: 'NEW_CARE_PLAN_FORMAT', name: 'New Care Plan Format Completed', category: 'OTHER' },
  { code: 'POOR_EATING_DRINKING', name: 'Poor Eating and Drinking', category: 'OTHER' },
  { code: 'USED_HOIST', name: 'Used Hoist', category: 'OTHER' },
];

/**
 * Catalogue entries that are not medical conditions and are recorded elsewhere: office flags, legal and
 * capacity records, the medication support level, communication needs (Privacy), falls risk (risk assessments)
 * and number of carers (DOM Care). They stay in the table so people who already have them keep them, but are
 * hidden from the list so they are not picked for new records. Mirrors migration 20261228094000.
 */
export const RETIRED_MEDICAL_CONDITION_CODES: ReadonlySet<string> = new Set([
  'BARCODE_PLACED',
  'NEWLY_ASSESSED',
  'WEEKLY_NEW_PACKAGES',
  'CARE_LOGS_CHECKED',
  'INITIAL_CONTACT_10_START',
  'NEW_CARE_PLAN_FORMAT',
  'BEST_INTEREST_COMPLETE',
  'LPA_OR_DEPUTY',
  'HAS_CAPACITY',
  'LACK_CAPACITY',
  'BEST_INTEREST_LACK_CAPACITY',
  'SELF_MEDICATE',
  'PROMPT_ASSIST_MEDICATION',
  'MEDICATION_BY_CARER',
  'COMMUNICATION_NEEDS',
  'HIGH_RISK_FALLS',
  'DOUBLE_HAND_CLIENT',
]);
