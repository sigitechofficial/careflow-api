/**
 * Written answers, read inside CareFlow only (Phase 2 part 5). Themes: a local dictionary of what people in home care
 * write about, counted per theme. Safeguarding words: words that may point to harm, so a person reads the answer
 * the same day. Nothing here sends text anywhere, keeps it, logs it or returns it: callers get counts, theme codes and
 * kinds of words only. Matching is on whole words, lower case, apostrophes ignored.
 */

export type TextTheme = { code: string; label: string; patterns: RegExp[] };

const w = (s: string) => new RegExp(`\\b(?:${s})\\b`, 'i');

/** Home-care themes. Kept short and plain; a written answer can count towards several. */
export const TEXT_THEMES: TextTheme[] = [
  { code: 'TIMEKEEPING', label: 'Time keeping and late or missed visits', patterns: [w('late|on time|early|lateness|punctual\\w*|waiting|wait(?:ed)? for|missed (?:visit|call)s?|no ?show|didnt (?:turn up|come)|did not (?:turn up|come)|rushed|rush(?:ing)?|short visits?|cut short|time keeping')] },
  { code: 'CONTINUITY', label: 'Same carers, knowing who is coming', patterns: [w('same carers?|different carers?|new carers?|strangers?|continuity|regular carers?|who is coming|whos coming|too many carers|familiar faces?')] },
  { code: 'ROTA', label: 'Rota, hours and shifts', patterns: [w('rotas?|shifts?|hours|schedul\\w*|weekends?|days off|annual leave|holidays?|split shifts?|calls? back to back|back to back')] },
  { code: 'COMMUNICATION', label: 'Communication with the office', patterns: [w('office|phone(?:d|s)?|call(?:ed)? back|ring(?:s|ing)? back|never (?:told|informed)|not (?:told|informed)|let (?:me|us) know|keep (?:me|us) informed|communicat\\w*|answer the phone|emails?|messages?')] },
  { code: 'KINDNESS', label: 'Kindness, respect and dignity', patterns: [w('kind(?:ness)?|caring|respect\\w*|dignity|polite|rude|friendly|lovely|patient|compassion\\w*|listen(?:s|ed|ing)?|cheerful|smile|treat(?:s|ed)? (?:me|us|mum|dad) well')] },
  { code: 'SKILLS', label: 'Care tasks and skills', patterns: [w('skills?|trained|experienced|inexperienced|knows? what (?:to do|they are doing)|hoist\\w*|moving and handling|personal care|showers?|wash(?:ing)?|dress(?:ing)?|catheter|stoma|pressure (?:sores?|care)')] },
  { code: 'MEDICINES', label: 'Medicines', patterns: [w('medicines?|medication|tablets?|pills?|marr?\\b|mar charts?|dose|doses|creams?|inhalers?|prescriptions?|pharmacy')] },
  { code: 'FOOD', label: 'Food and drink', patterns: [w('food|meals?|breakfast|lunch|dinner|tea|drinks?|fluids?|hungry|thirsty|cooking|microwave|sandwich(?:es)?')] },
  { code: 'PAY', label: 'Pay and expenses', patterns: [w('pay|paid|wages?|salary|mileage|expenses|travel time|unpaid|overtime|pay rise|minimum wage|living wage')] },
  { code: 'TRAINING', label: 'Training and development', patterns: [w('training|trained|courses?|induction|shadow(?:ing)?|e-?learning|refresher|qualification|nvq|care certificate|development')] },
  { code: 'MANAGEMENT', label: 'Support from managers', patterns: [w('managers?|management|supervisors?|supervision|support(?:ed|ive)?|unsupported|appreciated|valued|listened to|team leaders?|coordinators?')] },
  { code: 'WORKLOAD', label: 'Workload, stress and wellbeing', patterns: [w('workload|stress(?:ed|ful)?|tired|exhausted|burn(?:t|ed)? out|pressure|overworked|too much work|wellbeing|mental health|breaks?')] },
  { code: 'TRAVEL', label: 'Travel between visits', patterns: [w('travel(?:l?ing)?|driving|drive|parking|petrol|fuel|traffic|bus(?:es)?|journey|distance|rural')] },
  { code: 'SAFETY', label: 'Feeling safe', patterns: [w('safe|safety|unsafe|secure|insecure|lone working|key ?safe|locked|door|falls?|fell|alarm|emergenc\\w*')] },
];

export type ThemeCount = { code: string; label: string; count: number };

/** Lower case, apostrophes dropped ("didn't" → "didnt"), whitespace squashed. */
export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[’'`]/g, '').replace(/\s+/g, ' ').trim();
}

/** Themes one written answer touches (codes, each once). */
export function themesIn(text: string): string[] {
  const t = normaliseText(text);
  if (!t) return [];
  return TEXT_THEMES.filter((th) => th.patterns.some((p) => p.test(t))).map((th) => th.code);
}

/** Counts per theme over written answers (each answer counts once per theme), largest first; themes never seen left out. */
export function countThemes(texts: ReadonlyArray<string>): ThemeCount[] {
  const counts = new Map<string, number>();
  for (const text of texts) for (const code of themesIn(text)) counts.set(code, (counts.get(code) ?? 0) + 1);
  return TEXT_THEMES.filter((th) => counts.has(th.code))
    .map((th) => ({ code: th.code, label: th.label, count: counts.get(th.code)! }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ─── Safeguarding words ──────────────────────────────────────────────────

export type SafeguardingKind = { code: string; label: string; pattern: RegExp };

/**
 * Words that may point to harm or a risk to someone. A flag only: a person must read the answer. Cautious on purpose
 * ("I was never hit" is flagged too); a missed flag is worse than an extra read.
 */
export const SAFEGUARDING_KINDS: SafeguardingKind[] = [
  { code: 'PHYSICAL', label: 'Physical harm', pattern: w('hit(?:s|ting)?|slap(?:s|ped|ping)?|punch(?:es|ed|ing)?|kick(?:s|ed|ing)?|push(?:es|ed|ing)? (?:me|him|her|them)|shov(?:e|ed|ing)|grabb?(?:ed|ing)?|rough(?:ly)? handl\\w*|too rough|bruis(?:e|es|ed|ing)|pinch(?:es|ed|ing)?|hurt (?:me|him|her|them)|restrain(?:ed|ing)?|tied (?:me|him|her) (?:up|down)') },
  { code: 'FINANCIAL', label: 'Money or belongings', pattern: w('stole|stolen|steal(?:s|ing)?|theft|money (?:has gone|went|is) missing|missing money|took (?:my|his|her|their) (?:money|cards?|purse|wallet|jewell?ery)|borrow(?:ed)? money|asked (?:me|him|her) for money|bank cards?|pin number|cash (?:went|has gone|is) missing|things go(?:ne)? missing') },
  { code: 'PSYCHOLOGICAL', label: 'Shouting, threats or fear', pattern: w('shout(?:s|ed|ing)? at|swore at|swear(?:s|ing)? at|threat(?:en|ened|ening|s)?|bull(?:y|ied|ying)|humiliat\\w*|intimidat\\w*|scared of|frightened of|afraid of|terrified|belittl\\w*|mock(?:s|ed|ing)?') },
  { code: 'SEXUAL', label: 'Sexual or unwanted touching', pattern: w('touched me|touching me|inappropriate(?:ly)? touch\\w*|unwanted touch\\w*|sexual(?:ly)?|indecent\\w*|groped|grop(?:e|ing)|exposed (?:himself|herself)') },
  { code: 'NEGLECT', label: 'Neglect or care left undone', pattern: w('neglect(?:ed|ing)?|left (?:me|him|her|them) (?:wet|soiled|dirty|alone|on the floor|in bed all day)|left in (?:a )?(?:wet|soiled|dirty)|not (?:fed|washed|changed|given (?:my|his|her) (?:tablets|medication|medicines))|no food|went without (?:food|a drink|medication|tablets)|wrong (?:tablets|medication|medicines|dose)|overdose|pressure sores?|lying on the floor') },
  { code: 'SELF_HARM', label: 'Self-harm or not wanting to live', pattern: w('suicid\\w*|kill (?:my|him|her)self|end (?:my|it all|my life)|self[- ]?harm\\w*|hurt(?:ing)? myself|cut(?:ting)? myself|dont want to (?:live|be here)|do not want to (?:live|be here)|want to die|better off dead') },
  { code: 'DISCRIMINATION', label: 'Discrimination or harassment', pattern: w('racis[mt]\\w*|racial(?:ly)?|harass\\w*|homophob\\w*|transphob\\w*|sexis[mt]|discriminat\\w*|because of my (?:colour|race|religion|accent)') },
  { code: 'WHISTLEBLOWING', label: 'Unsafe practice or covering up', pattern: w('cover(?:ed|ing)? up|covered it up|falsif\\w*|fake (?:records|signatures?|notes)|signed (?:for|off) (?:visits|calls|medication) (?:not|never) (?:done|given)|lied (?:on|in) the (?:notes|records|mar)|not reported|afraid to report|scared to report') },
];

/** Kinds of safeguarding words in one text (codes, each once). */
export function safeguardingKindsIn(text: string): string[] {
  const t = normaliseText(text);
  if (!t) return [];
  return SAFEGUARDING_KINDS.filter((k) => k.pattern.test(t)).map((k) => k.code);
}

export function safeguardingLabel(code: string): string {
  return SAFEGUARDING_KINDS.find((k) => k.code === code)?.label ?? code;
}

/** Written parts of an answer: a text answer, the "Other" text and the comment. */
export function writtenPartsOf(a: { textValue?: string | null; otherText?: string | null; comment?: string | null }): string[] {
  return [a.textValue, a.otherText, a.comment].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

/** Smallest theme count shown as a number; fewer shows as "fewer than 3". */
export const THEME_MIN_COUNT = 3;
