/**
 * Default, database-seeded incident categories and subtypes (catalog v2, 14 categories).
 * Keys are STABLE — code and analytics depend on them (e.g. MEDICATION, NEAR_MISS, subtype FALL).
 * Labels may change. Existing databases are updated by the migration
 * `20261002141000_incident_catalog_v2`, which also deactivates INCIDENT and BEHAVIOUR/ABSCONDING.
 */
export type IncidentCategorySeed = {
  key: string;
  label: string;
  description?: string;
  subtypes: { key: string; label: string }[];
};

export const DEFAULT_INCIDENT_CATEGORIES: IncidentCategorySeed[] = [
  {
    key: 'ACCIDENT',
    label: 'Accident',
    subtypes: [
      { key: 'SLIP', label: 'Slip' },
      { key: 'TRIP', label: 'Trip' },
      { key: 'FALL', label: 'Fall' },
      { key: 'COLLISION', label: 'Collision' },
      { key: 'BURN_SCALD', label: 'Burn / Scald' },
      { key: 'CUT_ABRASION', label: 'Cut / Abrasion' },
      { key: 'MANUAL_HANDLING', label: 'Manual Handling' },
      { key: 'CHOKING', label: 'Choking' },
      { key: 'EQUIPMENT_RELATED', label: 'Equipment Related' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'NEAR_MISS',
    label: 'Near Miss',
    subtypes: [
      { key: 'MEDICATION_NEAR_MISS', label: 'Medication Near Miss' },
      { key: 'FALL_PREVENTED', label: 'Fall Prevented' },
      { key: 'EQUIPMENT_NEAR_MISS', label: 'Equipment Near Miss' },
      { key: 'ENVIRONMENTAL_NEAR_MISS', label: 'Environmental Near Miss' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'SAFEGUARDING',
    label: 'Safeguarding Concern',
    subtypes: [
      { key: 'PHYSICAL_ABUSE', label: 'Physical Abuse' },
      { key: 'DOMESTIC_ABUSE', label: 'Domestic Abuse' },
      { key: 'SEXUAL_ABUSE', label: 'Sexual Abuse' },
      { key: 'EMOTIONAL_ABUSE', label: 'Psychological / Emotional Abuse' },
      { key: 'FINANCIAL_ABUSE', label: 'Financial / Material Abuse' },
      { key: 'MODERN_SLAVERY', label: 'Modern Slavery' },
      { key: 'DISCRIMINATORY_ABUSE', label: 'Discriminatory Abuse' },
      { key: 'ORGANISATIONAL_ABUSE', label: 'Organisational Abuse' },
      { key: 'NEGLECT', label: 'Neglect / Acts of Omission' },
      { key: 'SELF_NEGLECT', label: 'Self-neglect' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'MEDICATION',
    label: 'Medication Incident',
    subtypes: [
      { key: 'MISSED_DOSE', label: 'Missed Dose' },
      { key: 'WRONG_DOSE', label: 'Wrong Dose' },
      { key: 'WRONG_MEDICATION', label: 'Wrong Medication' },
      { key: 'WRONG_PERSON', label: 'Wrong Person' },
      { key: 'WRONG_TIME', label: 'Wrong Time' },
      { key: 'WRONG_ROUTE', label: 'Wrong Route' },
      { key: 'REFUSED', label: 'Refused Medication' },
      { key: 'UNAVAILABLE', label: 'Medication Unavailable' },
      { key: 'STOCK_DISCREPANCY', label: 'Stock / Count Discrepancy' },
      { key: 'EXPIRED_MEDICATION', label: 'Expired Medication' },
      { key: 'MAR_ISSUE', label: 'MAR Issue' },
      { key: 'CONTROLLED_DRUG_ISSUE', label: 'Controlled Drug Issue' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'BEHAVIOUR',
    label: 'Behaviour / Distress Incident',
    subtypes: [
      { key: 'VERBAL_AGGRESSION', label: 'Verbal Aggression' },
      { key: 'PHYSICAL_AGGRESSION', label: 'Physical Aggression' },
      { key: 'SELF_INJURY', label: 'Self Injury' },
      { key: 'PROPERTY_DAMAGE', label: 'Property Damage' },
      { key: 'CHALLENGING', label: 'Distressed / Challenging Behaviour' },
      { key: 'RESTRICTIVE_INTERVENTION', label: 'Restrictive Intervention' },
      { key: 'THREATENING_BEHAVIOUR', label: 'Threatening Behaviour' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'SKIN_WOUND',
    label: 'Skin Integrity / Wound',
    subtypes: [
      { key: 'PRESSURE_ULCER', label: 'Pressure Ulcer' },
      { key: 'SKIN_TEAR', label: 'Skin Tear' },
      { key: 'WOUND', label: 'Wound' },
      { key: 'BRUISING', label: 'Bruising' },
      { key: 'UNEXPLAINED_BRUISING', label: 'Unexplained Bruising / Injury' },
      { key: 'MOISTURE_DAMAGE', label: 'Moisture Damage' },
      { key: 'RASH_SKIN_INFECTION', label: 'Rash / Skin Infection' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'HEALTH_SAFETY',
    label: 'Health & Safety / Environment',
    subtypes: [
      { key: 'ENVIRONMENT', label: 'Environmental Hazard' },
      { key: 'EQUIPMENT', label: 'Equipment Failure' },
      { key: 'FIRE', label: 'Fire / Evacuation' },
      { key: 'KEY_SAFE_SECURITY', label: 'Key Safe / Security Issue' },
      { key: 'UTILITY_FAILURE', label: 'Utility Failure' },
      { key: 'NEEDLESTICK_SHARPS', label: 'Needle-stick / Sharps' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'CARE_DELIVERY',
    label: 'Care Delivery / Visit Incident',
    subtypes: [
      { key: 'MISSED_VISIT', label: 'Missed Visit' },
      { key: 'LATE_VISIT', label: 'Late Visit' },
      { key: 'SHORT_VISIT', label: 'Short Visit' },
      { key: 'CARER_NO_SHOW', label: 'Carer No-show' },
      { key: 'UNABLE_TO_ACCESS', label: 'Unable to Access' },
      { key: 'VISIT_NOT_COMPLETED', label: 'Visit Not Completed' },
      { key: 'ESSENTIAL_TASK_MISSED', label: 'Essential Care Task Missed' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'HEALTH_DETERIORATION',
    label: 'Health Deterioration / Medical Emergency',
    subtypes: [
      { key: 'SUDDEN_DETERIORATION', label: 'Sudden Deterioration' },
      { key: 'COLLAPSE_UNRESPONSIVE', label: 'Collapse / Unresponsive' },
      { key: 'BREATHING_DIFFICULTY', label: 'Breathing Difficulty' },
      { key: 'CHEST_PAIN', label: 'Chest Pain' },
      { key: 'SEIZURE', label: 'Seizure' },
      { key: 'SUSPECTED_STROKE', label: 'Suspected Stroke' },
      { key: 'DIABETIC_EMERGENCY', label: 'Diabetic Emergency' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'DEATH',
    label: 'Death',
    subtypes: [
      { key: 'EXPECTED_DEATH', label: 'Expected Death' },
      { key: 'UNEXPECTED_DEATH', label: 'Unexpected Death' },
    ],
  },
  {
    key: 'INFECTION',
    label: 'Infection',
    subtypes: [
      { key: 'SUSPECTED_INFECTION', label: 'Suspected Infection' },
      { key: 'CONFIRMED_INFECTION', label: 'Confirmed Infection' },
      { key: 'OUTBREAK', label: 'Outbreak' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'VIOLENCE_TO_STAFF',
    label: 'Violence / Abuse to Staff',
    subtypes: [
      { key: 'VERBAL_ABUSE', label: 'Verbal Abuse' },
      { key: 'PHYSICAL_ASSAULT', label: 'Physical Assault' },
      { key: 'THREATS', label: 'Threats' },
      { key: 'HARASSMENT', label: 'Harassment' },
      { key: 'SEXUAL_HARASSMENT', label: 'Sexual Harassment / Assault' },
      { key: 'ANIMAL_ATTACK', label: 'Animal Attack' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'DATA_BREACH',
    label: 'Data / Confidentiality Breach',
    subtypes: [
      { key: 'LOST_DEVICE_PAPERWORK', label: 'Lost Device / Paperwork' },
      { key: 'SENT_TO_WRONG_PERSON', label: 'Sent to Wrong Person' },
      { key: 'UNAUTHORISED_ACCESS', label: 'Unauthorised Access' },
      { key: 'INCORRECT_DISCLOSURE', label: 'Incorrect Disclosure' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'OTHER',
    label: 'General / Other Incident',
    subtypes: [
      { key: 'PROPERTY_LOSS_DAMAGE', label: 'Property Loss / Damage' },
      { key: 'MONEY_MISSING', label: 'Money Missing' },
      { key: 'MISSING_PERSON', label: 'Missing Person / Absconded' },
      { key: 'VEHICLE_ROAD', label: 'Vehicle / Road Incident' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
];
