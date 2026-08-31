/**
 * Default, database-seeded incident categories and subtypes.
 * These are inserted as configurable rows (not enums) so an organisation can add
 * or deactivate categories/subtypes later without code changes.
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
    key: 'INCIDENT',
    label: 'Incident',
    subtypes: [{ key: 'OTHER', label: 'Other' }],
  },
  {
    key: 'NEAR_MISS',
    label: 'Near Miss',
    subtypes: [{ key: 'OTHER', label: 'Other' }],
  },
  {
    key: 'SAFEGUARDING',
    label: 'Safeguarding Concern',
    subtypes: [
      { key: 'NEGLECT', label: 'Neglect' },
      { key: 'PHYSICAL_ABUSE', label: 'Physical Abuse' },
      { key: 'FINANCIAL_ABUSE', label: 'Financial Abuse' },
      { key: 'EMOTIONAL_ABUSE', label: 'Emotional / Psychological Abuse' },
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
      { key: 'REFUSED', label: 'Refused Medication' },
      { key: 'UNAVAILABLE', label: 'Medication Unavailable' },
      { key: 'MAR_ISSUE', label: 'MAR Issue' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'BEHAVIOUR',
    label: 'Behaviour Incident',
    subtypes: [
      { key: 'VERBAL_AGGRESSION', label: 'Verbal Aggression' },
      { key: 'PHYSICAL_AGGRESSION', label: 'Physical Aggression' },
      { key: 'SELF_INJURY', label: 'Self Injury' },
      { key: 'PROPERTY_DAMAGE', label: 'Property Damage' },
      { key: 'ABSCONDING', label: 'Absconding' },
      { key: 'CHALLENGING', label: 'Challenging Behaviour' },
      { key: 'RESTRICTIVE_INTERVENTION', label: 'Restrictive Intervention' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'SKIN_WOUND',
    label: 'Skin / Wound Incident',
    subtypes: [
      { key: 'PRESSURE_ULCER', label: 'Pressure Ulcer' },
      { key: 'SKIN_TEAR', label: 'Skin Tear' },
      { key: 'WOUND', label: 'Wound' },
      { key: 'BRUISING', label: 'Bruising' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'HEALTH_SAFETY',
    label: 'Health & Safety',
    subtypes: [
      { key: 'ENVIRONMENT', label: 'Environmental Hazard' },
      { key: 'EQUIPMENT', label: 'Equipment Failure' },
      { key: 'FIRE', label: 'Fire / Evacuation' },
      { key: 'OTHER', label: 'Other' },
    ],
  },
  {
    key: 'OTHER',
    label: 'Other',
    subtypes: [{ key: 'OTHER', label: 'Other' }],
  },
];
