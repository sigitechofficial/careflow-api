/**
 * Persona-specific enterprise IA overlay for Care Plan compose demos.
 *
 * Only five people: Margaret (SU-1042), Doris (P01), James (P02), Fatima (P04), Betty (P10).
 * Does not drive the generic IA autofill generator. Overlay answers are upserted by
 * fieldKey / questionText onto an existing submission when present.
 */

export const CARE_PLAN_IA_DEMO_OVERLAY_META_FLAG = 'carePlanIaDemoOverlay';
export const CARE_PLAN_IA_DEMO_OVERLAY_VERSION = 2;

export type IaDemoOverlayAnswerKind =
  | 'text'
  | 'yesNo'
  | 'select'
  | 'multi'
  | 'date'
  | 'number'
  | 'json'
  | 'clear';

export type IaDemoOverlayAnswer = {
  kind: IaDemoOverlayAnswerKind;
  /** Preferred match — Initial Assessment question metadata.fieldKey */
  fieldKey?: string;
  /** Fallback exact questionText match when the template has no fieldKey */
  questionText?: string;
  value: string | boolean | string[] | number | Record<string, unknown> | null;
};

export type IaDemoOverlayPersona = {
  serviceUserNumber: string;
  displayName: string;
  answers: IaDemoOverlayAnswer[];
  /** About Me JSON keys to merge (first-person person-centred narrative). */
  aboutMe: Record<string, string>;
  /** Replaces About Me weekly routine grid when provided. */
  aboutMeRoutine?: Record<string, Record<string, string>>;
  /** Holistic worksheet metadata (Waterlow, MUST, ADL). Merged over existing keys. */
  worksheet?: Record<string, unknown>;
};

export function text(questionText: string, value: string, fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'text', questionText, fieldKey, value };
}

export function yesNo(questionText: string, value: boolean, fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'yesNo', questionText, fieldKey, value };
}

export function select(questionText: string, value: string, fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'select', questionText, fieldKey, value };
}

export function multi(questionText: string, value: string[], fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'multi', questionText, fieldKey, value };
}

export function dateAnswer(questionText: string, isoDate: string, fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'date', questionText, fieldKey, value: isoDate };
}

export function numberAnswer(questionText: string, value: number, fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'number', questionText, fieldKey, value };
}

export function jsonAnswer(
  questionText: string,
  value: Record<string, unknown>,
  fieldKey?: string,
): IaDemoOverlayAnswer {
  return { kind: 'json', questionText, fieldKey, value };
}

export function clearAnswer(questionText: string, fieldKey?: string): IaDemoOverlayAnswer {
  return { kind: 'clear', questionText, fieldKey, value: null };
}

/** Shared Care 2020 / person-centred questions used by several plans. */
function personCentredCore(params: {
  whatMatters: string;
  supportGoals: string;
  worried?: string;
  bathing: string;
  routine: string;
  privacy: string;
  keepDoing?: string;
  howAndWhen: string;
  personalHygiene: string;
  nightSupport: string;
  howICommunicate?: string;
}): IaDemoOverlayAnswer[] {
  const rows: IaDemoOverlayAnswer[] = [
    text('What matters most to the Service User?', params.whatMatters, 'whatMattersMost'),
    text('What do they want support to achieve?', params.supportGoals, 'supportGoals'),
    text('Bathing / shower and dressing preferences', params.bathing),
    text('Morning, meal, evening and bedtime routine', params.routine),
    text('How should staff support privacy during personal care?', params.privacy),
    text('How and when to support me', params.howAndWhen, 'howAndWhenToSupportMe'),
    text('Night support', params.nightSupport, 'nightSupport'),
    text('What is most important to me', params.whatMatters, 'whatIsMostImportantToMe'),
  ];
  if (params.worried) {
    rows.push(text('What are they worried about?', params.worried));
  }
  if (params.keepDoing) {
    rows.push(text('Things they want to keep doing independently', params.keepDoing));
  }
  if (params.howICommunicate) {
    rows.push(text('How I communicate and how to communicate with me', params.howICommunicate, 'howICommunicate'));
    rows.push(text('Staff communication instructions', params.howICommunicate, 'staffCommunicationInstructions'));
  }
  return rows;
}

export const MARGARET_ABOUT_ME_PATCH: Record<string, string> = {
  whatIsMostImportantToMe:
    'I want to stay in my own home and see my daughter Sarah regularly. Being rushed during personal care spoils my day.',
  peopleImportantToMe: 'Sarah Hughes (daughter), church friends, former neighbours.',
  howICommunicate: 'I speak clearly. Short sentences work best. I am hard of hearing in my left ear.',
  myWellness: 'I find it harder to get about. I use a walking frame indoors.',
  whatMakesAGoodDay: 'I like my personal care in the morning before 10, the radio on, and a visit from Sarah.',
  whatMakesMeHappy: 'I enjoy Classic FM, gardening programmes, and looking at family photos.',
  howAndWhenToSupportMe:
    'I prefer a female carer for personal care. Please speak calmly and at eye level. I am hard of hearing in my left ear.',
  whatMakesMeUnhappy: 'I do not like being rushed during personal care, or loud sudden noises.',
  whatMakesABadDay: 'I have a bad day if my medication is late or carers arrive very late.',
  alsoWorthKnowing: 'Please call me Margaret. I am Church of England and keep a bible by my bed.',
  supportedToWriteThisBy: 'Sarah Hughes (daughter)',
  hobbiesAndInterests: 'I like watching the garden, knitting, and church choir when I am well enough.',
  religiousSpiritualPreferences: 'I am Church of England. I like to go to Sunday service when my health allows.',
  whereIAmFrom: 'I was born in Bromley. I have lived in this house for 40 years.',
  whatILikeToTalkAbout: 'I like to talk about my family, the garden, and local news.',
  familyAndFriends: 'My daughter Sarah visits twice a week.',
  myOccupation: 'I am a retired school secretary.',
  personalHygiene: 'I prefer a shower in the morning and I need full help with washing and dressing.',
  domesticSupport: 'Carers prepare my meals and help with light housekeeping.',
  shoppingArrangements: 'Sarah does my online grocery orders.',
  nightSupport: 'I have a bed sensor mat. I sometimes try to get up on my own at night.',
  foodDrinksLike: 'I like porridge, soft cooked vegetables, and warm tea with one sugar.',
  foodDrinksDontLike: 'I cannot eat shellfish — I am allergic.',
  favouriteItems: 'My pearl necklace and family photo album.',
  tvProgrammes: "I like Gardeners' World and classic films.",
  favouriteActivities: 'I like listening to the radio and looking through photo albums.',
  favouriteRooms: 'I like the living room bay window seat.',
  identificationCharacteristics: 'Silver hair. I walk with a frame.',
};

export const CARE_PLAN_IA_DEMO_OVERLAYS: IaDemoOverlayPersona[] = [
  {
    serviceUserNumber: 'SU-1042',
    displayName: 'Margaret Hughes',
    aboutMe: MARGARET_ABOUT_ME_PATCH,
    answers: [
      ...personCentredCore({
        whatMatters: MARGARET_ABOUT_ME_PATCH.whatIsMostImportantToMe,
        supportGoals:
          'I want help to wash and dress in the morning so I can manage the rest of the day in my own home.',
        worried: 'I worry about falling on the front steps and about being rushed when I am washed.',
        bathing: 'I prefer a shower in the morning. I need full help to wash and dress. Please do not rush me.',
        routine:
          'I like to get up around 8, have a wash and dress, then porridge and tea. I like to be in bed by 9 after personal care.',
        privacy: 'Please close the bathroom door and keep me covered with a towel until we need to wash that area.',
        keepDoing: 'I still like to sit by the window and look at the garden. Please let me do what I can for myself.',
        howAndWhen: MARGARET_ABOUT_ME_PATCH.howAndWhenToSupportMe,
        personalHygiene: MARGARET_ABOUT_ME_PATCH.personalHygiene,
        nightSupport: MARGARET_ABOUT_ME_PATCH.nightSupport,
        howICommunicate: MARGARET_ABOUT_ME_PATCH.howICommunicate,
      }),
      select('Staff gender preference for personal care', 'female'),
      yesNo('Will the Service User accept care from the opposite sex?', false),
      yesNo('Comfortable with double-up care?', true),
      text('Modesty requirements', 'Please keep me covered and close the door during personal care.'),
      text('Religious or spiritual needs', 'I like to go to Sunday service when I am well enough. I keep a bible by my bed.'),
      text(
        'Religious or cultural dietary requirements',
        'I am Church of England. I do not eat shellfish — I am allergic.',
      ),
      select('Hearing impairment level', 'mild', 'hearingLevel'),
      yesNo('Hearing impairment (moderate or worse)?', false),
      select('Sight impairment level', 'no_concern', 'sightLevel'),
      select('Sleeping pattern', '6_8_hours', 'sleepingPattern'),
      yesNo('Sleeping pattern concern?', false),
      yesNo('Currently has ulcers or wounds?', true, 'hasWounds'),
      text(
        'Ulcers or wounds comment',
        'I have a sore area on my sacrum that is being checked, and a skin tear on my lower leg.',
      ),
      yesNo(
        'Pressure ulcer risk assessment completed (including photography)?',
        true,
        'pressureUlcerRiskAssessmentCompleted',
      ),
      yesNo('Pressure relieving equipment in use?', true),
      text(
        'Pressure equipment details',
        'I sleep on a high-spec foam mattress. A pressure cushion has been ordered for my chair.',
      ),
      yesNo('Further pressure equipment required?', true, 'furtherPressureEquipmentRequired'),
      text(
        'Further pressure equipment comment',
        'Please tell the office if my chair cushion has not arrived, or if my mattress is not working.',
      ),
      text(
        'Skin / wound notes',
        'Please check my sacrum and lower leg when you help me wash, and tell the nurse if anything looks worse.',
        'skinIntegrityComments',
      ),
      yesNo('Falls in last 12 months?', false, 'fallsLast12Months'),
      yesNo('Uses hoist or sling?', false, 'usesHoistOrSling'),
      yesNo('Transfer support required?', true, 'transferSupportRequired'),
      yesNo('Independent with all transfers?', false),
      text(
        'Transfer comments',
        'I use a walking frame indoors. Please stay with me on the front steps and in the wet room after my shower.',
      ),
      multi('Personal care completed in — locations', ['bathroom'], 'personalCareLocations'),
      multi('Bladder continence options', ['no_concern'], 'bladderContinenceOptions'),
      multi('Bowel continence options', ['no_concern'], 'bowelContinenceOptions'),
      yesNo('Continence products in use?', false),
      select('Assistance level for eating and drinking', 'prompting', 'eatingAssistanceLevel'),
      select('Food texture requirement', 'normal', 'foodTexture'),
      select('Nutrition status', 'nourished', 'nutritionStatus'),
      yesNo('Adequately hydrated?', true, 'adequatelyHydrated'),
      text(
        'Nutrition / hydration comments',
        'I like porridge, soft cooked vegetables, and tea with one sugar. Carers prepare my meals. I cannot eat shellfish.',
      ),
    ],
  },
  {
    serviceUserNumber: 'SU-TEST-P01',
    displayName: 'Doris Clarke',
    aboutMe: {
      whatIsMostImportantToMe:
        'I like to do as much as I can for myself. A little help in the morning and evening is enough.',
      peopleImportantToMe: 'Helen Clarke (daughter).',
      howICommunicate: 'I speak English. Please talk to me in a normal voice.',
      howAndWhenToSupportMe: 'I prefer a female carer for personal care. Please prompt me rather than doing everything for me.',
      personalHygiene: 'I need some prompting when washing and dressing. I manage the toilet myself using the grab rails.',
      nightSupport: 'I usually sleep through. I do not need anyone overnight.',
      foodDrinksLike: 'I like simple home-cooked meals.',
      domesticSupport: 'I need help with meals and a bit of housework.',
    },
    answers: [
      ...personCentredCore({
        whatMatters:
          'I like to do as much as I can for myself. A little help in the morning and evening is enough.',
        supportGoals: 'I want prompting with my tablets, help with meals, and a bit of help to wash and dress.',
        bathing:
          'I need some prompting when washing and dressing. I manage the toilet myself using the grab rails.',
        routine:
          'I like a morning call to wash, dress, have breakfast and take my tablets, and an evening call for my meal and to get ready for bed.',
        privacy: 'Please let me wash what I can myself, and keep the bathroom door closed.',
        keepDoing: 'I still like to walk indoors with my stick and look after my own toilet with the grab rails.',
        howAndWhen:
          'I prefer a female carer for personal care. Please prompt me rather than doing everything for me.',
        personalHygiene:
          'I need some prompting when washing and dressing. I manage the toilet myself using the grab rails.',
        nightSupport: 'I usually sleep through. I do not need anyone overnight.',
        howICommunicate: 'I speak English. Please talk to me in a normal voice.',
      }),
      select('Staff gender preference for personal care', 'female'),
      yesNo('Will the Service User accept care from the opposite sex?', false),
      yesNo('Comfortable with double-up care?', false),
      select('Hearing impairment level', 'no_concern', 'hearingLevel'),
      select('Sight impairment level', 'no_concern', 'sightLevel'),
      select('Sleeping pattern', '6_8_hours', 'sleepingPattern'),
      yesNo('Sleeping pattern concern?', false),
      yesNo('Currently has ulcers or wounds?', false, 'hasWounds'),
      yesNo('Falls in last 12 months?', false, 'fallsLast12Months'),
      yesNo('Uses hoist or sling?', false, 'usesHoistOrSling'),
      yesNo('Transfer support required?', false, 'transferSupportRequired'),
      yesNo('Independent with all transfers?', true),
      multi('Personal care completed in — locations', ['bathroom'], 'personalCareLocations'),
      multi('Bladder continence options', ['no_concern'], 'bladderContinenceOptions'),
      multi('Bowel continence options', ['no_concern'], 'bowelContinenceOptions'),
      select('Assistance level for eating and drinking', 'prompting', 'eatingAssistanceLevel'),
      select('Food texture requirement', 'normal', 'foodTexture'),
      select('Nutrition status', 'nourished', 'nutritionStatus'),
      yesNo('Adequately hydrated?', true, 'adequatelyHydrated'),
    ],
  },
  {
    serviceUserNumber: 'SU-TEST-P02',
    displayName: 'James Okafor',
    aboutMe: {
      whatIsMostImportantToMe:
        'I want to get stronger after my stroke and keep practising my exercises. Please give me time to find my words.',
      peopleImportantToMe: 'Grace Okafor (wife) — she lives with me and helps overnight.',
      howICommunicate: 'I have trouble finding words. Please speak slowly and wait for me to answer.',
      howAndWhenToSupportMe:
        'I need two carers to help me move. I do not mind if my carers are men or women. Please do not rush me.',
      personalHygiene: 'I need full help with washing and dressing. Two carers help me with all transfers.',
      nightSupport: 'My wife Grace helps me overnight. Please leave things ready for her.',
      domesticSupport: 'I need help with meals.',
    },
    answers: [
      ...personCentredCore({
        whatMatters:
          'I want to get stronger after my stroke and keep practising my exercises. Please give me time to find my words.',
        supportGoals:
          'I need two carers to help me move, and full help to wash and dress. I want to stay at home with my wife Grace.',
        bathing: 'I need full help with washing and dressing. Two carers help me with all transfers.',
        routine:
          'I have a morning call with two carers to get up, wash and dress, and an evening call to get ready for bed. Grace helps me in between.',
        privacy: 'Please tell me what you are going to do before you start, and keep me covered.',
        keepDoing: 'I still want to practise my exercises every day.',
        howAndWhen:
          'I need two carers to help me move. I do not mind if my carers are men or women. Please do not rush me.',
        personalHygiene: 'I need full help with washing and dressing. Two carers help me with all transfers.',
        nightSupport: 'My wife Grace helps me overnight. Please leave things ready for her.',
        howICommunicate: 'I have trouble finding words. Please speak slowly and wait for me to answer.',
      }),
      select('Staff gender preference for personal care', 'no_preference'),
      yesNo('Will the Service User accept care from the opposite sex?', true),
      yesNo('Comfortable with double-up care?', true),
      multi('Speech impairment options', ['difficulty_speaking'], 'speechOptions'),
      yesNo('Speech impairment or concern?', true),
      text(
        'Staff communication instructions',
        'I have trouble finding words. Please speak slowly and wait for me to answer.',
      ),
      text(
        'Communication support notes',
        'I have expressive dysphasia after my stroke. Please do not finish my sentences unless I ask.',
      ),
      select('Hearing impairment level', 'no_concern', 'hearingLevel'),
      select('Sight impairment level', 'no_concern', 'sightLevel'),
      select('Sleeping pattern', '6_8_hours', 'sleepingPattern'),
      yesNo('Currently has ulcers or wounds?', false, 'hasWounds'),
      yesNo('Uses hoist or sling?', false, 'usesHoistOrSling'),
      yesNo('Transfer support required?', true, 'transferSupportRequired'),
      yesNo('Independent with all transfers?', false),
      text(
        'Transfer comments',
        'I need two carers for all transfers — bed, chair and commode. Please do not move me on your own.',
      ),
      multi('Personal care completed in — locations', ['bed', 'commode', 'bathroom'], 'personalCareLocations'),
      yesNo('Falls in last 12 months?', false, 'fallsLast12Months'),
      multi('Bladder continence options', ['no_concern'], 'bladderContinenceOptions'),
      multi('Bowel continence options', ['no_concern'], 'bowelContinenceOptions'),
      select('Assistance level for eating and drinking', 'assistance', 'eatingAssistanceLevel'),
      select('Food texture requirement', 'normal', 'foodTexture'),
      select('Nutrition status', 'nourished', 'nutritionStatus'),
      yesNo('Adequately hydrated?', true, 'adequatelyHydrated'),
      text(
        'Nutrition / hydration comments',
        'I need help with my meals. Please give me time to eat and drink, and keep a note of how much I drink.',
      ),
      yesNo('Does the client receive support from an informal carer?', true, 'informalCarerSupport'),
      text('Informal carer name', 'Grace Okafor', 'informalCarerName'),
    ],
  },
  {
    serviceUserNumber: 'SU-TEST-P04',
    displayName: 'Fatima Al-Rashid',
    aboutMe: {
      whatIsMostImportantToMe:
        'I want carers who are women for all personal care, and I want my food to be Halal.',
      howICommunicate: 'I speak English. Please tell me before you start personal care.',
      howAndWhenToSupportMe:
        'I only want female carers for personal care. I need two carers and the ceiling hoist for transfers.',
      personalHygiene:
        'I need two female carers for washing and dressing. Please use the ceiling hoist for transfers.',
      nightSupport: 'I do not have overnight care from this package. Please leave me safe before you go.',
      foodDrinksLike: 'I eat Halal food only.',
      foodDrinksDontLike: 'I do not eat pork or anything that is not Halal.',
      religiousSpiritualPreferences: 'I am Muslim. I pray during the day.',
    },
    answers: [
      ...personCentredCore({
        whatMatters: 'I want carers who are women for all personal care, and I want my food to be Halal.',
        supportGoals: 'I need two carers and the ceiling hoist for transfers, and help to protect my skin.',
        bathing:
          'I need two female carers for washing and dressing. Please use the ceiling hoist for transfers.',
        routine:
          'I have three double-up calls a day. Please use the ceiling hoist whenever you move me, and keep my skin checked.',
        privacy: 'I only want women to help me with personal care. Please keep me covered.',
        keepDoing: 'I want to keep my prayers and eat food that is Halal.',
        howAndWhen:
          'I only want female carers for personal care. I need two carers and the ceiling hoist for transfers.',
        personalHygiene:
          'I need two female carers for washing and dressing. Please use the ceiling hoist for transfers.',
        nightSupport: 'I do not have overnight care from this package. Please leave me safe before you go.',
        howICommunicate: 'I speak English. Please tell me before you start personal care.',
      }),
      select('Staff gender preference for personal care', 'female'),
      yesNo('Will the Service User accept care from the opposite sex?', false),
      yesNo('Comfortable with double-up care?', true),
      text(
        'Modesty requirements',
        'I only want women to help me with washing, dressing and the toilet. Please keep me covered.',
      ),
      text('Religious or spiritual needs', 'I am Muslim. My faith and my privacy during personal care matter to me.'),
      text(
        'Prayer routine or worship needs',
        'I pray during the day. Please give me a quiet moment and do not interrupt if I am praying, unless I am unsafe.',
      ),
      text(
        'Religious or cultural dietary requirements',
        'I eat Halal food only. I do not eat pork or anything that is not Halal.',
      ),
      select('Hearing impairment level', 'no_concern', 'hearingLevel'),
      select('Sight impairment level', 'no_concern', 'sightLevel'),
      select('Sleeping pattern', '6_8_hours', 'sleepingPattern'),
      yesNo('Currently has ulcers or wounds?', true, 'hasWounds'),
      text(
        'Ulcers or wounds comment',
        'I have pressure areas that need checking when I am moved. Please tell the nurse if my skin looks worse.',
      ),
      text(
        'Skin / wound notes',
        'Please check my pressure areas when you turn me, especially after I have been sitting in my wheelchair.',
        'skinIntegrityComments',
      ),
      yesNo('Pressure relieving equipment in use?', true),
      text(
        'Pressure equipment details',
        'Please check any pressure cushion or mattress I am using, and tell the office if it is not working.',
      ),
      yesNo('Uses hoist or sling?', true, 'usesHoistOrSling'),
      yesNo('Transfer support required?', true, 'transferSupportRequired'),
      yesNo('Independent with all transfers?', false),
      text(
        'Transfer comments',
        'I am in a wheelchair. Please use the ceiling hoist with two carers for every transfer. Do not lift me.',
      ),
      multi('Personal care completed in — locations', ['bed'], 'personalCareLocations'),
      yesNo('Falls in last 12 months?', false, 'fallsLast12Months'),
      multi('Bladder continence options', ['incontinence', 'products'], 'bladderContinenceOptions'),
      multi('Bowel continence options', ['incontinence', 'products'], 'bowelContinenceOptions'),
      yesNo('Continence products in use?', true),
      yesNo('Doubly incontinent?', true),
      yesNo('Bladder continence concern?', true),
      yesNo('Bowel continence concern?', true),
      text(
        'Continence product details',
        'I use pads. Please change me when you visit and check my skin.',
      ),
      select('Assistance level for eating and drinking', 'assistance', 'eatingAssistanceLevel'),
      select('Food texture requirement', 'normal', 'foodTexture'),
      select('Nutrition status', 'nourished', 'nutritionStatus'),
      yesNo('Adequately hydrated?', true, 'adequatelyHydrated'),
      text(
        'Nutrition / hydration comments',
        'I eat Halal food only. Please do not give me pork or anything that is not Halal.',
      ),
    ],
  },
  {
    serviceUserNumber: 'SU-TEST-P10',
    displayName: 'Betty Henderson',
    aboutMe: {
      whatIsMostImportantToMe:
        'I like the radio on while you help me. Please speak slowly and do not rush. I want to stay here and be comfortable.',
      howICommunicate: 'Please speak clearly and calmly with me, and use short sentences. I do not like to be rushed.',
      howAndWhenToSupportMe:
        'I need full help with washing, dressing and meals. I prefer a female carer. Please put the radio on.',
      personalHygiene: 'I prefer a shower in the morning. I need full help with washing, dressing and the toilet.',
      nightSupport: 'I get unsettled at night and I may try to get out of bed. I have a sensor mat.',
      foodDrinksLike: 'I like porridge for breakfast and soft cooked vegetables. I like warm tea with one sugar.',
      foodDrinksDontLike: 'I cannot eat shellfish — I am allergic.',
      religiousSpiritualPreferences: 'I am Church of England. I keep a small bible by my bed.',
      domesticSupport: 'I need help with all my meals and drinks.',
    },
    answers: [
      ...personCentredCore({
        whatMatters:
          'I like the radio on while you help me. Please speak slowly and do not rush. I want to stay here and be comfortable.',
        supportGoals: 'I need help with all my washing, dressing and meals. Please offer me drinks through the day.',
        worried: 'I get unsettled at night. I worry about getting out of bed on my own.',
        bathing: 'I prefer a shower in the morning. I need full help with washing, dressing and the toilet.',
        routine:
          'I like a shower in the morning with the radio on, porridge for breakfast, and drinks offered through the day. I get unsettled at night.',
        privacy: 'Please keep me covered and tell me what you are going to do. I prefer a female carer.',
        keepDoing: 'I like listening to the radio. Please leave it on if I am enjoying it.',
        howAndWhen:
          'I need full help with washing, dressing and meals. I prefer a female carer. Please put the radio on.',
        personalHygiene: 'I prefer a shower in the morning. I need full help with washing, dressing and the toilet.',
        nightSupport: 'I get unsettled at night and I may try to get out of bed. I have a sensor mat.',
        howICommunicate: 'Please speak clearly and calmly with me, and use short sentences. I do not like to be rushed.',
      }),
      select('Staff gender preference for personal care', 'female'),
      yesNo('Will the Service User accept care from the opposite sex?', false),
      yesNo('Comfortable with double-up care?', true),
      text('Religious or spiritual needs', 'I am Church of England. I keep a small bible by my bed.'),
      text(
        'Religious or cultural dietary requirements',
        'I am Church of England. I cannot eat shellfish — I am allergic. I prefer soft food because chewing is hard.',
      ),
      select('Hearing impairment level', 'no_concern', 'hearingLevel'),
      select('Sight impairment level', 'no_concern', 'sightLevel'),
      select('Sleeping pattern', '4_6_hours', 'sleepingPattern'),
      yesNo('Sleeping pattern concern?', true),
      yesNo('Currently has ulcers or wounds?', false, 'hasWounds'),
      yesNo('Uses hoist or sling?', true, 'usesHoistOrSling'),
      yesNo('Transfer support required?', true, 'transferSupportRequired'),
      yesNo('Independent with all transfers?', false),
      text('Transfer comments', 'I need two carers for transfers and hoisting. Please do not move me on your own.'),
      multi('Personal care completed in — locations', ['bathroom'], 'personalCareLocations'),
      yesNo('Falls in last 12 months?', false, 'fallsLast12Months'),
      multi('Bladder continence options', ['products'], 'bladderContinenceOptions'),
      multi('Bowel continence options', ['products'], 'bowelContinenceOptions'),
      yesNo('Continence products in use?', true),
      yesNo('Doubly incontinent?', false),
      yesNo('Bladder continence concern?', true),
      yesNo('Bowel continence concern?', true),
      text('Continence product details', 'I need help with pads and the toilet.'),
      select('Assistance level for eating and drinking', 'full_support', 'eatingAssistanceLevel'),
      select('Food texture requirement', 'soft', 'foodTexture'),
      select('Nutrition status', 'average', 'nutritionStatus'),
      yesNo('Adequately hydrated?', false, 'adequatelyHydrated'),
      text(
        'Nutrition / hydration comments',
        'I forget to drink. Please offer me fluids often — I like warm tea with one sugar. I prefer soft food because chewing is hard. I cannot eat shellfish.',
      ),
      text(
        'Hydration comment',
        'I forget to drink. Please offer me fluids every couple of hours. I like warm tea with one sugar.',
      ),
      select('Cognitive impairment level', 'moderate', 'cognitiveImpairment'),
      yesNo('Diagnosed dementia?', true),
      yesNo('Fully orientated?', false),
      yesNo('Good short-term memory recall?', false),
      yesNo('Able to follow basic instructions?', true),
    ],
  },
];
