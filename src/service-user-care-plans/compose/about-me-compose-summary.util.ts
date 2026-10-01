export type AboutMeComposeSummary = {
  whatMattersMost: string | null;
  peopleImportant: string | null;
  howToSupport: string | null;
  communication: string | null;
  personalCare: string | null;
  domesticSupport: string | null;
  foodPreferences: string | null;
  routineSummary: string | null;
  triggersCalm: string | null;
  lifeHistoryInterests: string | null;
  meaningfulActivities: string | null;
  goodDay: string | null;
  nightSupport: string | null;
  /** About Me profile only — the IA no longer asks it (ADL / Practical Task cover the task). */
  shopping?: string | null;
};

const ABOUT_ME_REF_TYPE = 'SU_ABOUT_ME_V1';

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function joinNonEmpty(parts: Array<string | null>): string | null {
  const lines = parts.filter(Boolean) as string[];
  return lines.length > 0 ? lines.join('\n') : null;
}

function summarizeRoutine(routine: unknown): string | null {
  if (!routine || typeof routine !== 'object' || Array.isArray(routine)) return null;
  const lines: string[] = [];
  for (const [day, slots] of Object.entries(routine as Record<string, unknown>)) {
    if (!slots || typeof slots !== 'object' || Array.isArray(slots)) continue;
    for (const [slot, text] of Object.entries(slots as Record<string, unknown>)) {
      if (typeof text !== 'string' || !text.trim()) continue;
      lines.push(`${day} ${slot}: ${text.trim()}`);
    }
  }
  return lines.length > 0 ? lines.slice(0, 8).join('\n') : null;
}

export function parseAboutMeReferenceJson(raw: string | null | undefined): AboutMeComposeSummary | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const likes = readString(parsed, 'foodDrinksLike');
    const dislikes = readString(parsed, 'foodDrinksDontLike');
    const foodParts = [likes, dislikes ? `Dislikes: ${dislikes}` : null].filter(Boolean);

    const unhappy = readString(parsed, 'whatMakesMeUnhappy');
    const badDay = readString(parsed, 'whatMakesABadDay');
    const calmParts = [
      readString(parsed, 'whatMakesMeHappy'),
      unhappy ? `Avoid: ${unhappy}` : null,
      badDay ? `Bad day triggers: ${badDay}` : null,
    ].filter(Boolean);

    return {
      whatMattersMost: readString(parsed, 'whatIsMostImportantToMe'),
      peopleImportant: readString(parsed, 'peopleImportantToMe') ?? readString(parsed, 'familyAndFriends'),
      howToSupport: readString(parsed, 'howAndWhenToSupportMe'),
      communication: readString(parsed, 'howICommunicate'),
      personalCare: readString(parsed, 'personalHygiene'),
      domesticSupport: readString(parsed, 'domesticSupport'),
      foodPreferences: foodParts.length > 0 ? foodParts.join('\n') : null,
      routineSummary: summarizeRoutine(parsed.routine),
      triggersCalm: calmParts.length > 0 ? calmParts.join('\n') : null,
      lifeHistoryInterests: joinNonEmpty([
        readString(parsed, 'myOccupation'),
        readString(parsed, 'whereIAmFrom'),
        readString(parsed, 'hobbiesAndInterests'),
        readString(parsed, 'whatILikeToTalkAbout'),
      ]),
      meaningfulActivities: joinNonEmpty([
        readString(parsed, 'favouriteActivities'),
        readString(parsed, 'tvProgrammes'),
        readString(parsed, 'favouriteRooms'),
      ]),
      goodDay: readString(parsed, 'whatMakesAGoodDay'),
      nightSupport: readString(parsed, 'nightSupport'),
      shopping: readString(parsed, 'shoppingArrangements'),
    };
  } catch {
    return null;
  }
}

export function loadAboutMeFromReferences(
  references: Array<{ referenceType: string; referenceValue: string | null }>,
): AboutMeComposeSummary | null {
  const row = references.find((r) => r.referenceType === ABOUT_ME_REF_TYPE && r.referenceValue?.trim());
  return parseAboutMeReferenceJson(row?.referenceValue ?? null);
}
