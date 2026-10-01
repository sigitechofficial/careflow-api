/** Shared SINGLE_SELECT / MULTI_SELECT option sets for enterprise template (BE1.10). */

export type OptionSet = { options: { value: string; label: string }[] };

export const NO_CONCERN_OPTION = { value: 'no_concern', label: 'No concern / need identified' };

/** §17 Bed Rails — whether rails are required and currently in place. */
export const BED_RAILS_REQUIRED_IN_PLACE_OPTIONS: OptionSet = {
  options: [
    { value: 'not_required', label: 'Not required' },
    { value: 'required_in_place', label: 'Required and in place' },
    { value: 'required_not_yet_in_place', label: 'Required but not yet in place' },
  ],
};

/** §3.12 Car parking — likelihood without control measures (1–3 matrix score). */
export const CAR_PARKING_LIKELIHOOD_OPTIONS: OptionSet = {
  options: [
    { value: 'rare', label: 'Rare — very unlikely to occur' },
    { value: 'unlikely', label: 'Unlikely — could occur but not expected' },
    { value: 'possible', label: 'Possible — could occur' },
    { value: 'likely', label: 'Likely — will probably occur' },
    { value: 'almost_certain', label: 'Almost certain — expected to occur' },
  ],
};

/** §3.12 Car parking — harm severity (1–3 matrix score). */
export const CAR_PARKING_SEVERITY_OPTIONS: OptionSet = {
  options: [
    { value: 'negligible', label: 'Negligible — no injury' },
    { value: 'minor', label: 'Minor — first aid only' },
    { value: 'moderate', label: 'Moderate — medical attention required' },
    {
      value: 'major',
      label: 'Major — may cause temporary disability or a fracture',
    },
    { value: 'catastrophic', label: 'Catastrophic — permanent disability or death' },
  ],
};

export const PREFERRED_VISIT_TIMES_OPTIONS: OptionSet = {
  options: [
    { value: 'early_morning', label: 'Early morning (06:00-09:00)' },
    { value: 'morning', label: 'Morning (09:00-12:00)' },
    { value: 'lunch_time', label: 'Lunch time (12:00-14:00)' },
    { value: 'afternoon', label: 'Afternoon (14:00-17:00)' },
    { value: 'early_evening', label: 'Early evening (17:00-20:00)' },
    { value: 'night', label: 'Night (20:00+)' },
    { value: 'flexible', label: 'Flexible' },
  ],
};

/** Paper §4a — general physical wellbeing (feels well / unwell). */
export const GENERAL_PHYSICAL_WELLBEING_OPTIONS: OptionSet = {
  options: [
    { value: 'well_all', label: 'Feels well all of the time' },
    { value: 'well_most', label: 'Feels well most of the time' },
    { value: 'well_some', label: 'Feels well some of the time' },
    { value: 'unwell_some', label: 'Feels unwell some of the time' },
    { value: 'unwell_most', label: 'Feels unwell most of the time' },
    { value: 'unwell_all', label: 'Feels unwell all of the time' },
  ],
};

export const BREATHING_CONCERN_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'mild_exertion', label: 'Mild on exertion' },
    { value: 'moderate_exertion', label: 'Moderate on exertion' },
    { value: 'severe_exertion', label: 'Severe on exertion' },
    { value: 'mild_rest', label: 'Mild at rest' },
    { value: 'moderate_rest', label: 'Moderate at rest' },
    { value: 'severe_rest', label: 'Severe at rest' },
    { value: 'oxygen_dependent', label: 'Oxygen dependent' },
    { value: 'gp_specialist_review', label: 'GP / Specialist Nurse review requested' },
  ],
};

export const PAIN_DISTRESS_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'mild_movement', label: 'Mild on movement' },
    { value: 'moderate_movement', label: 'Moderate on movement' },
    { value: 'severe_movement', label: 'Severe on movement' },
    { value: 'mild_rest', label: 'Mild at rest' },
    { value: 'moderate_rest', label: 'Moderate at rest' },
    { value: 'severe_rest', label: 'Severe at rest' },
    { value: 'unable_to_self_report', label: 'Unable to say / signs of pain or distress (use Abbey)' },
    { value: 'pain_assessment_completed', label: 'Pain assessment completed' },
    { value: 'gp_review_requested', label: 'GP review requested' },
  ],
};

export const SWALLOWING_CONCERN_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'cough_liquids', label: 'Coughing episodes when swallowing liquids' },
    { value: 'cough_solids', label: 'Coughing episodes when swallowing solids' },
    { value: 'choking', label: 'Choking episodes' },
    { value: 'choking_all', label: 'Choking — all occasions' },
    { value: 'choking_intermittent', label: 'Choking — intermittent' },
    { value: 'salt_required', label: 'Referral to SALT required' },
    { value: 'salt_made', label: 'Referral to SALT made' },
    { value: 'gp_review', label: 'GP review requested' },
  ],
};

export const FOOD_TEXTURE_OPTIONS: OptionSet = {
  options: [
    { value: 'normal', label: 'Normal' },
    { value: 'soft', label: 'Soft' },
    { value: 'minced', label: 'Minced' },
    { value: 'pureed', label: 'Pureed' },
    { value: 'unknown', label: 'Unknown' },
  ],
};

export const FLUID_THICKNESS_OPTIONS: OptionSet = {
  options: [
    { value: 'normal', label: 'Normal' },
    { value: 'thickened', label: 'Thickened' },
    { value: 'unknown', label: 'Unknown' },
  ],
};

export const APPETITE_STATUS_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'very_good', label: 'Very good appetite' },
    { value: 'good', label: 'Good appetite' },
    { value: 'poor', label: 'Poor appetite' },
  ],
};

/** Paper appetite grid — appetite, supplements, dietitian and GP flags in one multi-select. */
export const APPETITE_CONCERN_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'very_good', label: 'Very good appetite' },
    { value: 'good', label: 'Good appetite' },
    { value: 'poor', label: 'Poor appetite' },
    { value: 'supplements_taken', label: 'Nutritional supplements taken' },
    { value: 'supplements_required', label: 'Nutritional supplements required' },
    { value: 'dietitian_referral', label: 'Referral made to dietitian' },
    { value: 'gp_review', label: 'GP review requested' },
  ],
};

export const PULSE_RHYTHM_OPTIONS: OptionSet = {
  options: [
    { value: 'regular', label: 'Regular' },
    { value: 'irregular', label: 'Irregular' },
    { value: 'unknown', label: 'Not recorded / unknown' },
  ],
};

export const NUTRITION_STATUS_OPTIONS: OptionSet = {
  options: [
    { value: 'nourished', label: 'Nourished' },
    { value: 'average', label: 'Average' },
    { value: 'malnourished', label: 'Malnourished' },
    { value: 'severely_malnourished', label: 'Severely malnourished' },
    { value: 'obese', label: 'Obese' },
  ],
};

export const ASSISTANCE_LEVEL_OPTIONS: OptionSet = {
  options: [
    { value: 'independent', label: 'Independent' },
    { value: 'prompting', label: 'Prompting' },
    { value: 'assistance', label: 'Assistance' },
    { value: 'full_support', label: 'Full support' },
  ],
};

export const ORAL_HEALTH_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'concern', label: 'Concern / need identified' },
    { value: 'tooth_decay', label: 'Tooth decay present' },
    { value: 'mouth_ulcers', label: 'Suffers with mouth ulcers' },
    { value: 'own_teeth', label: 'Own teeth' },
    { value: 'dentures_full', label: 'Wears dentures, full set' },
    { value: 'dentures_partial', label: 'Wears dentures, partial' },
    { value: 'onward_referral', label: 'Onward referral required' },
  ],
};

export const BLADDER_CONTINENCE_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'concern', label: 'Concern / need identified' },
    { value: 'incontinence', label: 'Incontinence' },
    { value: 'stress', label: 'Stress incontinence' },
    { value: 'nocturnal', label: 'Nocturnal incontinence' },
    { value: 'products', label: 'Wears continence products' },
    { value: 'catheter', label: 'Has a catheter in situ' },
    { value: 'urostomy', label: 'Urostomy' },
    { value: 'continence_referral', label: 'Requires referral to Continence Service' },
  ],
};

export const BOWEL_CONTINENCE_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'concern', label: 'Concern / need identified' },
    { value: 'incontinence', label: 'Incontinence' },
    { value: 'stress', label: 'Stress incontinence' },
    { value: 'nocturnal', label: 'Nocturnal incontinence' },
    { value: 'products', label: 'Wears continence products' },
    { value: 'stoma', label: 'Has a stoma' },
    { value: 'continence_referral', label: 'Requires referral to Continence Service' },
    { value: 'gp_review', label: 'GP review requested' },
  ],
};

export const SPEECH_IMPAIRMENT_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'concern', label: 'Concern / need identified' },
    { value: 'difficulty_speaking', label: 'Difficulty in speaking' },
    { value: 'unable_to_speak', label: 'Unable to speak' },
    { value: 'under_salt', label: 'Under care of SALT service' },
    { value: 'salt_required', label: 'Referral to SALT required' },
    { value: 'salt_made', label: 'Referral to SALT made' },
    { value: 'gp_required', label: 'GP review required' },
    { value: 'gp_requested', label: 'GP review requested' },
  ],
};

export const HEARING_IMPAIRMENT_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'mild', label: 'Mild' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'severe', label: 'Severe' },
    { value: 'very_severe', label: 'Very severe' },
    { value: 'not_known', label: 'Not known' },
    { value: 'onward_referral', label: 'Onward referral required' },
  ],
};

export const SIGHT_IMPAIRMENT_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: 'mild', label: 'Mild' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'severe', label: 'Severe' },
    { value: 'very_severe', label: 'Very severe' },
    { value: 'onward_referral', label: 'Onward referral required' },
  ],
};

export const MEDICATION_AWARENESS_OPTIONS: OptionSet = {
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
    { value: 'unknown', label: 'Unknown' },
  ],
};

/**
 * One vocabulary: Independent / Prompt / Assist / Administer / Provided by others. Codes are unchanged
 * (care plan rules and compose read level_0 … level_2b); `provided_by_others` = carers give none.
 */
export const MEDICATION_SUPPORT_LEVEL_OPTIONS: OptionSet = {
  options: [
    { value: 'level_0', label: 'Independent — manages own medicines' },
    { value: 'level_1a', label: 'Prompt — carers remind; the person takes them' },
    { value: 'level_1b', label: 'Assist — carers help open packaging; the person takes them' },
    { value: 'level_2a', label: 'Assist — carers help the person take them (person in control)' },
    { value: 'level_2b', label: 'Administer — carers give the medicines (trained staff)' },
    { value: 'provided_by_others', label: 'Provided by others — family / nurse give all medicines; carers do not' },
  ],
};

export const MEDICATION_ORDERING_BY_OPTIONS: OptionSet = {
  options: [
    { value: 'person', label: 'The person' },
    { value: 'family', label: 'Family / friend' },
    { value: 'care_provider', label: 'Our office' },
    { value: 'pharmacy', label: 'Pharmacy (managed repeats)' },
    { value: 'other', label: 'Other' },
  ],
};

export const MEDICATION_COLLECTION_BY_OPTIONS: OptionSet = {
  options: [
    { value: 'person', label: 'The person' },
    { value: 'family', label: 'Family / friend' },
    { value: 'care_provider', label: 'Care staff' },
    { value: 'pharmacy_delivery', label: 'Pharmacy delivers' },
    { value: 'other', label: 'Other' },
  ],
};

export const MEDICATION_STORAGE_OPTIONS: OptionSet = {
  options: [
    { value: 'usual_place', label: 'Kept in the usual place — no special storage' },
    { value: 'restricted', label: 'Locked or kept out of reach (risk of taking wrongly)' },
    { value: 'fridge', label: 'Some need a fridge' },
    { value: 'controlled_drugs', label: 'Controlled drugs stored separately' },
    { value: 'other', label: 'Other' },
  ],
};

export const MEDICATION_ADMINISTERED_BY_OPTIONS: OptionSet = {
  options: [
    { value: 'self', label: 'Service user' },
    { value: 'family', label: 'Family / informal carer' },
    { value: 'care_staff', label: 'Care staff' },
    { value: 'nurse', label: 'Nurse' },
    { value: 'mixed', label: 'Mixed' },
  ],
};

export const MEDICATION_DISPENSING_METHOD_OPTIONS: OptionSet = {
  options: [
    { value: 'original_packs', label: 'Original packs' },
    { value: 'blister_pack', label: 'Blister pack / MDS' },
    { value: 'dosette', label: 'Dosette box' },
    { value: 'other', label: 'Other' },
  ],
};

export const DIABETES_TYPE_OPTIONS: OptionSet = {
  options: [
    { value: 'type_1', label: 'Type 1' },
    { value: 'type_2', label: 'Type 2' },
    { value: 'other', label: 'Other' },
    { value: 'unknown', label: 'Unknown' },
  ],
};

export const CHOKING_OCCURS_WITH_OPTIONS: OptionSet = {
  options: [
    { value: 'liquids', label: 'Liquids' },
    { value: 'solids', label: 'Solids' },
    { value: 'medicines', label: 'Medicines' },
    { value: 'mixed', label: 'More than one of these' },
  ],
};

export const CHOKING_FREQUENCY_OPTIONS: OptionSet = {
  options: [
    { value: 'rare', label: 'Rarely' },
    { value: 'occasional', label: 'Occasionally' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'daily', label: 'Daily or most days' },
  ],
};

export const INFECTION_PRECAUTION_OPTIONS: OptionSet = {
  options: [
    { value: 'standard', label: 'Standard precautions' },
    { value: 'contact', label: 'Contact precautions' },
    { value: 'droplet', label: 'Droplet precautions' },
    { value: 'enhanced_hygiene', label: 'Enhanced hygiene' },
  ],
};

export const PPE_REQUIRED_OPTIONS: OptionSet = {
  options: [
    { value: 'gloves', label: 'Gloves' },
    { value: 'apron', label: 'Apron' },
    { value: 'mask', label: 'Mask' },
    { value: 'eye_protection', label: 'Eye protection' },
  ],
};

export const EMOTIONAL_WELLBEING_OPTIONS: OptionSet = {
  options: [
    { value: 'content_all', label: 'Feels content all of the time' },
    { value: 'content_most', label: 'Feels content most of the time' },
    { value: 'content_some', label: 'Feels content some of the time' },
    { value: 'sad_some', label: 'Feels sad some of the time' },
    { value: 'sad_most', label: 'Feels sad most of the time' },
    { value: 'sad_all', label: 'Feels sad all of the time' },
  ],
};

export const SLEEPING_PATTERN_OPTIONS: OptionSet = {
  options: [
    NO_CONCERN_OPTION,
    { value: '2_4_hours', label: 'Sleeps 2 to 4 hours a night' },
    { value: '4_6_hours', label: 'Sleeps 4 to 6 hours a night' },
    { value: '6_8_hours', label: 'Sleeps 6 to 8 hours a night' },
    { value: 'not_sleeping', label: 'Not sleeping' },
    { value: 'sleeps_well_prescribed', label: 'Sleeps well with prescribed medication' },
    { value: 'sleeps_well_otc', label: 'Sleeps well with over-the-counter medication' },
    { value: 'gp_referral_required', label: 'Referral to GP required (sleep / medication)' },
    { value: 'gp_referral_made', label: 'Referral to GP made (sleep / medication)' },
  ],
};

export const WOUND_TYPE_OPTIONS: OptionSet = {
  options: [
    { value: 'pressure_ulcer', label: 'Pressure ulcer' },
    { value: 'skin_tear', label: 'Skin tear' },
    { value: 'surgical', label: 'Surgical wound' },
    { value: 'moisture_lesion', label: 'Moisture lesion' },
    { value: 'other', label: 'Other' },
  ],
};

export const HOIST_TYPE_OPTIONS: OptionSet = {
  options: [
    { value: 'oxford_medi', label: 'Oxford / Medi or similar' },
    { value: 'ceiling_track', label: 'Ceiling track hoist' },
    { value: 'standing', label: 'Standing hoist' },
  ],
};

export const PERSONAL_CARE_LOCATION_OPTIONS: OptionSet = {
  options: [
    { value: 'bed', label: 'Bed' },
    { value: 'commode', label: 'Commode' },
    { value: 'bathroom', label: 'Bathroom' },
    { value: 'other', label: 'Other' },
  ],
};

export const SAFEGUARDING_TYPE_OPTIONS: OptionSet = {
  options: [
    { value: 'physical', label: 'Physical abuse' },
    { value: 'financial', label: 'Financial abuse' },
    { value: 'neglect', label: 'Neglect' },
    { value: 'emotional', label: 'Emotional / psychological' },
    { value: 'sexual', label: 'Sexual abuse' },
    { value: 'self_neglect', label: 'Self-neglect' },
    { value: 'domestic', label: 'Domestic abuse' },
    { value: 'organisational', label: 'Organisational abuse' },
    { value: 'discriminatory', label: 'Discriminatory abuse' },
    { value: 'modern_slavery', label: 'Modern slavery' },
    { value: 'restrictive_practice', label: 'Restrictive practice' },
    { value: 'other', label: 'Other' },
  ],
};

export const YES_NO_UNKNOWN_OPTIONS: OptionSet = {
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
    { value: 'unknown', label: 'Unknown' },
  ],
};

export const ASSESSMENT_REASON_OPTIONS: OptionSet = {
  options: [
    { value: 'initial', label: 'Initial assessment' },
    { value: 'routine_review', label: 'Routine review' },
    { value: 'significant_change', label: 'Significant change' },
    { value: 'post_hospital', label: 'Post hospital discharge' },
    { value: 'incident_review', label: 'Incident review' },
    { value: 'safeguarding_review', label: 'Safeguarding review' },
    { value: 'family_request', label: 'Family request' },
    { value: 'local_authority', label: 'Local authority request' },
    { value: 'other', label: 'Other' },
  ],
};

export const LPOA_SCOPE_OPTIONS: OptionSet = {
  options: [
    { value: 'none', label: 'Not appointed' },
    { value: 'health', label: 'Health' },
    { value: 'finance', label: 'Finance' },
    { value: 'both', label: 'Health and finance' },
  ],
};

export const ACCOMMODATION_TYPE_OPTIONS: OptionSet = {
  options: [
    { value: 'private_house', label: 'Privately owned house' },
    { value: 'private_bungalow', label: 'Privately owned bungalow' },
    { value: 'private_flat', label: 'Privately owned flat' },
    { value: 'housing_authority', label: 'Local/Private housing authority' },
    { value: 'assisted_living', label: 'Assisted living housing' },
    { value: 'residential_home', label: 'Residential home' },
    { value: 'other', label: 'Other, please state' },
  ],
};

export const REVIEW_FREQUENCY_OPTIONS: OptionSet = {
  options: [
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'six_monthly', label: 'Six monthly' },
    { value: 'annual', label: 'Annual' },
    { value: 'custom', label: 'Custom' },
    { value: 'on_change', label: 'On significant change only' },
  ],
};

/** §4.10 — MUAC nutritional risk band (BAPEN-style tape colours). */
export const MUAC_NUTRITIONAL_RISK_OPTIONS: OptionSet = {
  options: [
    { value: 'green', label: 'Green — low risk (MUAC ≥23.5 cm)' },
    { value: 'amber', label: 'Amber — medium risk (MUAC 23.0–23.4 cm)' },
    { value: 'red', label: 'Red — high risk (MUAC <23.0 cm)' },
  ],
};
