import { InitialAssessmentQuestionType } from '@prisma/client';
import { iaMeta } from './initial-assessment-enterprise-metadata';
import type { EnterpriseQuestionSeed } from './initial-assessment-enterprise-sections-5-10.seed';

const A = InitialAssessmentQuestionType.TEXTAREA;
const T = InitialAssessmentQuestionType.TEXT;

/** About Me profile tabs mirrored as enterprise §1 IA questions (specRef 1.3a–1.3g). */
export const ABOUT_ME_SPEC_REFS = [
  '1.3a',
  '1.3b',
  '1.3c',
  '1.3d',
  '1.3e',
  '1.3f',
  '1.3g',
] as const;

export type AboutMeIaTabId =
  | 'about-main'
  | 'interests'
  | 'history'
  | 'routine'
  | 'support'
  | 'favourites'
  | 'id-chars';

const ROUTINE_DAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const ROUTINE_SLOTS = ['getUp', 'breakfast', 'lunch', 'afternoon', 'teaTime', 'bedtime'] as const;

const ROUTINE_DAY_LABEL: Record<(typeof ROUTINE_DAYS)[number], string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

const ROUTINE_SLOT_LABEL: Record<(typeof ROUTINE_SLOTS)[number], string> = {
  getUp: 'Get up',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  afternoon: 'Afternoon',
  teaTime: 'Tea time',
  bedtime: 'Bedtime',
};

function aboutMeQuestion(
  specRef: (typeof ABOUT_ME_SPEC_REFS)[number],
  aboutMeTab: AboutMeIaTabId,
  questionText: string,
  sortOrder: number,
  fieldKey: string,
  questionType: InitialAssessmentQuestionType = A,
  /** Profile value(s) to prefill from — defaults to the About Me field of the same name. */
  prefillKey = `aboutMe_${fieldKey}`,
): EnterpriseQuestionSeed {
  return {
    questionText,
    questionType,
    sortOrder,
    metadata: iaMeta(specRef, {
      fieldKey,
      aboutMeTab,
      aboutMeProfileField: true,
      prefillKey,
    }),
  };
}

function routineQuestions(startSort: number): EnterpriseQuestionSeed[] {
  const out: EnterpriseQuestionSeed[] = [];
  let order = startSort;
  for (const day of ROUTINE_DAYS) {
    for (const slot of ROUTINE_SLOTS) {
      const fieldKey = `routine${day[0]!.toUpperCase()}${day.slice(1)}${slot[0]!.toUpperCase()}${slot.slice(1)}`;
      out.push({
        questionText: `${ROUTINE_DAY_LABEL[day]} — ${ROUTINE_SLOT_LABEL[slot]}`,
        questionType: A,
        sortOrder: order++,
        metadata: iaMeta('1.3d', {
          fieldKey,
          aboutMeTab: 'routine',
          aboutMeProfileField: true,
          aboutMeRoutineDay: day,
          aboutMeRoutineSlot: slot,
          prefillKey: `aboutMe_routine_${day}_${slot}`,
        }),
      });
    }
  }
  return out;
}

/** Merged into another About Me question — soft-deleted by `ia-template-cleanup` (answers moved on open IAs). */
export const IA_ABOUT_ME_MERGED_FIELD_KEYS: Array<{ from: string; into: string }> = [
  { from: 'whatMakesAGoodDay', into: 'whatMakesMeHappy' },
  { from: 'whatMakesABadDay', into: 'whatMakesMeUnhappy' },
  { from: 'familyAndFriends', into: 'peopleImportantToMe' },
];

/** Dropped from the IA About Me (asked elsewhere) — soft-deleted by `ia-template-cleanup`, answers kept. */
export const IA_ABOUT_ME_REMOVED_FIELD_KEYS = [
  'lifeHistoryFavourites', // the "My Favourite Things" group covers it
  'personalHygiene', // ADL: bathing, grooming
  'domesticSupport', // ADL housework / laundry + Practical Task
  'shoppingArrangements', // ADL + Practical Task
] as const;

/** All About Me tab fields as section 1 template questions (upserted by questionText). */
export const ABOUT_ME_IA_QUESTIONS: EnterpriseQuestionSeed[] = [
  // 1.3a — About Me. "What is most important to me" is asked once, as §1.3 "What matters most"
  // (prefilled from the About Me profile); ia-template-cleanup.ts retires the old 1.3a copy.
  // Merged pairs (IA only — the About Me profile keeps both): people + family and friends, good day + happy,
  // bad day + unhappy. Prefill joins both profile answers; see IA_ABOUT_ME_RETIRED_FIELD_KEYS.
  aboutMeQuestion('1.3a', 'about-main', 'People who are important to me (family and friends)', 201, 'peopleImportantToMe', A, 'aboutMe_peopleAndFamily'),
  aboutMeQuestion('1.3a', 'about-main', 'External About Me link', 202, 'externalAboutMeUrl', T),
  aboutMeQuestion('1.3a', 'about-main', 'How I communicate and how to communicate with me', 203, 'howICommunicate'),
  aboutMeQuestion('1.3a', 'about-main', 'My wellness', 204, 'myWellness'),
  aboutMeQuestion('1.3a', 'about-main', 'What makes me happy / a good day (please do!)', 206, 'whatMakesMeHappy', A, 'aboutMe_happyGoodDay'),
  aboutMeQuestion('1.3a', 'about-main', "What makes me unhappy / a bad day (please don't!)", 207, 'whatMakesMeUnhappy', A, 'aboutMe_unhappyBadDay'),
  aboutMeQuestion('1.3a', 'about-main', 'How and when to support me', 209, 'howAndWhenToSupportMe'),
  aboutMeQuestion('1.3a', 'about-main', 'Also worth knowing about me', 210, 'alsoWorthKnowing'),
  aboutMeQuestion('1.3a', 'about-main', 'Supported to write this by', 211, 'supportedToWriteThisBy'),
  // 1.3b — Interests
  aboutMeQuestion('1.3b', 'interests', 'Hobbies and interests', 220, 'hobbiesAndInterests'),
  aboutMeQuestion('1.3b', 'interests', 'Religious and/or spiritual preferences', 221, 'religiousSpiritualPreferences'),
  aboutMeQuestion('1.3b', 'interests', 'Where I am from', 222, 'whereIAmFrom'),
  aboutMeQuestion('1.3b', 'interests', 'What I like to talk about', 223, 'whatILikeToTalkAbout'),
  // 1.3c — My Life History
  aboutMeQuestion('1.3c', 'history', 'My childhood', 231, 'myChildhood'),
  aboutMeQuestion('1.3c', 'history', 'My education', 232, 'myEducation'),
  aboutMeQuestion('1.3c', 'history', 'My occupation', 233, 'myOccupation'),
  aboutMeQuestion('1.3c', 'history', 'My adulthood', 234, 'myAdulthood'),
  // 1.3d — My Daily Routine (weekly grid cells)
  ...routineQuestions(240),
  // 1.3e — Support I Need (personal hygiene / domestic / shopping are covered by the ADL worksheet and
  // Practical Task; care plans read them from the About Me profile)
  aboutMeQuestion('1.3e', 'support', 'Night support', 303, 'nightSupport'),
  aboutMeQuestion('1.3e', 'support', 'Other support needs', 304, 'supportOther'),
  // 1.3f — My Favourite Things
  aboutMeQuestion('1.3f', 'favourites', 'Food and drinks — I like', 310, 'foodDrinksLike'),
  aboutMeQuestion('1.3f', 'favourites', "Food and drinks — I don't like", 311, 'foodDrinksDontLike'),
  aboutMeQuestion('1.3f', 'favourites', 'Favourite items', 312, 'favouriteItems'),
  aboutMeQuestion('1.3f', 'favourites', 'TV programmes', 313, 'tvProgrammes'),
  aboutMeQuestion('1.3f', 'favourites', 'Activities', 314, 'favouriteActivities'),
  aboutMeQuestion('1.3f', 'favourites', 'Rooms', 315, 'favouriteRooms'),
  aboutMeQuestion('1.3f', 'favourites', 'Other favourite things', 316, 'favouriteOther'),
  // 1.3g — Identification Characteristics
  aboutMeQuestion(
    '1.3g',
    'id-chars',
    'My identification characteristics — so people can recognise me',
    320,
    'identificationCharacteristics',
  ),
];

export const ABOUT_ME_IA_QUESTION_TEXT = ABOUT_ME_IA_QUESTIONS.map((q) => q.questionText);
