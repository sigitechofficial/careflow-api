/**
 * Privacy and sharing on a service user's record: how they need information (Accessible Information Standard),
 * who we may share it with, and information shared without consent. Pure lists and helpers; the service does the
 * database work.
 */

export const INFORMATION_FORMATS = {
  LARGE_PRINT: 'Large print',
  EASY_READ: 'Easy read',
  PLAIN_LANGUAGE: 'Plain, simple words',
  BRAILLE: 'Braille',
  AUDIO: 'Audio',
  READ_ALOUD: 'Read it to them',
  BSL: 'British Sign Language interpreter',
} as const;
export type InformationFormat = keyof typeof INFORMATION_FORMATS;
export const INFORMATION_FORMAT_KEYS = Object.keys(INFORMATION_FORMATS) as InformationFormat[];

export const SHARING_CATEGORIES = {
  ALL: 'Everything about their care',
  CARE_UPDATES: 'Day-to-day care updates',
  VISIT_TIMES: 'Visit times and carers',
  HEALTH_MEDICINES: 'Health and medicines',
  INCIDENTS: 'Incidents, falls and concerns',
  FINANCE: 'Money and invoices',
  /** Agreed to be asked to take part in our surveys. Not part of "Everything": it is asking, not sharing. */
  SURVEYS: 'Surveys about our care',
} as const;
export type SharingCategory = keyof typeof SHARING_CATEGORIES;
export const SHARING_CATEGORY_KEYS = Object.keys(SHARING_CATEGORIES) as SharingCategory[];

export const SHARING_CHANNELS = {
  PHONE: 'Phone',
  EMAIL: 'Email',
  PORTAL: 'Family portal',
  LETTER: 'Letter',
  IN_PERSON: 'In person',
} as const;
export type SharingChannel = keyof typeof SHARING_CHANNELS;
export const SHARING_CHANNEL_KEYS = Object.keys(SHARING_CHANNELS) as SharingChannel[];

export const SHARING_BASIS_WORDS = {
  CONSENT: 'They agreed',
  BEST_INTERESTS: 'Best-interests decision (they lack capacity for this)',
  LPA_HEALTH_WELFARE: 'Health and welfare lasting power of attorney',
  DEPUTY: 'Court-appointed deputy',
  OTHER: 'Other',
} as const;

export const SHARING_EXCEPTION_REASON_WORDS = {
  SAFEGUARDING: 'Safeguarding: to protect them or someone else from abuse or neglect',
  VITAL_INTERESTS: 'Someone’s life or health was at serious risk',
  LEGAL_DUTY: 'A legal duty (court order, CQC, police with lawful request)',
  PREVENT_CRIME: 'To prevent or detect a crime',
  OTHER: 'Other',
} as const;

/** Assessment answers on who information may be shared with (Consent tab, 2.8) → words for the screen. */
export const ASSESSMENT_SHARING_WITH = {
  gp: 'GP',
  district_nurse: 'District or community nurse',
  pharmacy: 'Pharmacy',
  hospital_ambulance: 'Hospital or ambulance',
  local_authority: 'Local authority or social worker',
  family_representatives: 'Family or representatives',
  other: 'Other',
} as const;

/** YYYY-MM-DD of a date column (stored at UTC midnight), or null. */
export function dayOf(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Whether a sharing line applies on `today` (YYYY-MM-DD): started, not past its end, not stopped. */
export function sharingIsActive(
  a: { startsOn: Date; endsOn: Date | null; stoppedAt: Date | null; deletedAt?: Date | null },
  today: string,
): boolean {
  if (a.deletedAt || a.stoppedAt) return false;
  const start = dayOf(a.startsOn)!;
  const end = dayOf(a.endsOn);
  return start <= today && (!end || end >= today);
}

/** What a line's status is today, in words the screen shows. */
export function sharingStatus(
  a: { startsOn: Date; endsOn: Date | null; stoppedAt: Date | null; reviewOn: Date | null },
  today: string,
): 'ACTIVE' | 'NOT_STARTED' | 'ENDED' | 'STOPPED' | 'REVIEW_DUE' {
  if (a.stoppedAt) return 'STOPPED';
  const start = dayOf(a.startsOn)!;
  const end = dayOf(a.endsOn);
  if (start > today) return 'NOT_STARTED';
  if (end && end < today) return 'ENDED';
  const review = dayOf(a.reviewOn);
  return review && review <= today ? 'REVIEW_DUE' : 'ACTIVE';
}

/**
 * One short line of a person's communication needs, for lists where staff contact them (surveys to collect,
 * call lists): "Large print · Interpreter: Polish". Empty when nothing is recorded.
 */
export function communicationNeedsWords(n: {
  interpreterNeeded: boolean;
  interpreterLanguage: string;
  formats: string[];
  contactViaName?: string | null;
} | null): string {
  if (!n) return '';
  const parts: string[] = n.formats
    .filter((f): f is InformationFormat => f in INFORMATION_FORMATS)
    .map((f) => INFORMATION_FORMATS[f]);
  if (n.interpreterNeeded) parts.push(n.interpreterLanguage.trim() ? `Interpreter: ${n.interpreterLanguage.trim()}` : 'Interpreter');
  if (n.contactViaName) parts.push(`Contact through ${n.contactViaName}`);
  return parts.join(' · ');
}

type AssessmentAnswer = {
  checked: boolean | null;
  booleanValue: boolean | null;
  textValue: string | null;
  selectedOptions: unknown;
};

const yes = (a?: AssessmentAnswer) => a?.checked === true || a?.booleanValue === true || /^yes$/i.test(a?.textValue?.trim() ?? '');
const no = (a?: AssessmentAnswer) => a?.checked === false || a?.booleanValue === false || /^no$/i.test(a?.textValue?.trim() ?? '');
const text = (a?: AssessmentAnswer) => (a?.textValue ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const selected = (a?: AssessmentAnswer): string[] => {
  const o = a?.selectedOptions;
  if (Array.isArray(o)) return o.map(String);
  return typeof o === 'string' && o ? [o] : [];
};
/** An option value such as "moderate_loss" in words: "Moderate loss". */
const optionWords = (v: string) => (v ? (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ') : '');

/**
 * What the latest initial assessment recorded, keyed the way the assessment's questions are (by field key, or
 * by question text where the question has none). Used to fill the Privacy section the first time, and shown
 * beside it so staff can see where it came from.
 */
export function assessmentPrivacyAnswers(answers: {
  byKey: Map<string, AssessmentAnswer>;
  byText: Map<string, AssessmentAnswer>;
}) {
  const t = (q: string) => answers.byText.get(q);
  const k = (key: string) => answers.byKey.get(key);
  const hearing = selected(k('hearingLevel'))[0] ?? text(k('hearingLevel'));
  const sight = selected(k('sightLevel'))[0] ?? text(k('sightLevel'));
  const largePrint = yes(t('Easy read or large print required?'));
  const consent = k('infoSharingConsent');
  return {
    needs: {
      interpreterNeeded: yes(t('Interpreter required?')),
      interpreterLanguage: text(t('Language required')),
      /** The assessment asks one question for both; staff pick which. */
      easyReadOrLargePrint: largePrint,
      hearing: hearing && !/^no(_|$)|none|no_concern/i.test(hearing) ? optionWords(hearing) : '',
      sight: sight && !/^no(_|$)|none|no_concern/i.test(sight) ? optionWords(sight) : '',
    },
    sharing: {
      consent: yes(consent) ? ('YES' as const) : no(consent) ? ('NO' as const) : ('NOT_ANSWERED' as const),
      with: selected(k('infoSharingWith')).map((v) => ASSESSMENT_SHARING_WITH[v as keyof typeof ASSESSMENT_SHARING_WITH] ?? optionWords(v)),
      limits: text(k('infoSharingLimits')),
      restrictions: text(k('infoSharingRestrictions')),
      conditions: yes(k('partialConsentRefusal')) ? text(k('partialConsentRefusalDetails')) : '',
    },
  };
}
export type AssessmentPrivacyAnswers = ReturnType<typeof assessmentPrivacyAnswers>;

/** One row of the person's consent record (Profile → Privacy → Consents), from wherever it was recorded. */
export type ConsentRow = {
  key: string;
  /** What was consented to. */
  title: string;
  answer: 'GIVEN' | 'REFUSED' | 'PARTLY' | 'WITHDRAWN' | 'BEST_INTERESTS' | 'HAS_CAPACITY' | 'NOT_ANSWERED' | 'RECORDED';
  /** Who, how, conditions, reasons: one or two short sentences. */
  detail: string;
  /** YYYY-MM-DD the answer was given or recorded, when known. */
  on: string | null;
  source: 'INITIAL_ASSESSMENT' | 'CAPACITY' | 'VISITS' | 'PHOTOS' | 'SURVEYS' | 'SHARING' | 'CHANGE';
  /** Set on consents staff can change here (Record a change); the topic the change is recorded under. */
  topic?: string | null;
  /** Who recorded it (changes only). */
  recordedBy?: string | null;
  /** Earlier answers for this consent, newest first (the assessment's answer last). */
  history?: Array<Pick<ConsentRow, 'answer' | 'detail' | 'on' | 'source' | 'recordedBy'>>;
};

const CONSENT_METHOD_WORDS: Record<string, string> = {
  written: 'in writing',
  verbal: 'verbally',
  non_verbal: 'by gestures or other non-verbal ways',
};

const CAPACITY_DECISION_WORDS: Record<string, string> = {
  consent_to_assessment: 'Consent to the assessment',
  consent_to_care: 'Consent to the proposed care',
  information_sharing: 'Sharing information with family or professionals',
  photography: 'Clinical photography',
  medication_support: 'Support with medication',
  covert_medication: 'Covert medication',
  key_safe_access: 'Key safe and access to the home',
  bed_rails: 'Bed rails',
  finance_support: 'Support with finances',
  care_arrangements: 'Care arrangements that restrict freedom',
  future_care_wishes: 'Advance care planning and end-of-life wishes',
};

/**
 * The consents the initial assessment recorded (Consent tab and sign-off) and its decision-specific capacity
 * records, as rows for the consent record. `on` is the assessment's date.
 */
export function assessmentConsentRows(
  byKey: Map<string, AssessmentAnswer>,
  capacityDecisions: unknown,
  on: string | null,
): ConsentRow[] {
  const k = (key: string) => byKey.get(key);
  const yn = (key: string): ConsentRow['answer'] => (yes(k(key)) ? 'GIVEN' : no(k(key)) ? 'REFUSED' : 'NOT_ANSWERED');
  const rows: ConsentRow[] = [];
  const method = selected(k('consentMethod')).map((v) => CONSENT_METHOD_WORDS[v] ?? optionWords(v).toLowerCase())[0] ?? text(k('consentMethodOther'));
  rows.push({
    key: 'ia-assessment',
    title: 'Consent to the assessment',
    answer: yn('consentToAssessment'),
    detail: yes(k('consentToAssessment')) ? (method ? `Given ${method}.` : '') : text(k('consentToAssessmentNoReason')),
    on,
    source: 'INITIAL_ASSESSMENT',
  });
  rows.push({
    key: 'ia-family',
    title: 'Family or representatives involved in the assessment',
    answer: yn('familyInvolvementConsent'),
    detail: '',
    on,
    source: 'INITIAL_ASSESSMENT',
  });
  const sharingWith = selected(k('infoSharingWith')).map((v) => ASSESSMENT_SHARING_WITH[v as keyof typeof ASSESSMENT_SHARING_WITH] ?? optionWords(v));
  rows.push({
    key: 'ia-sharing',
    title: 'Sharing information with people and professionals involved in their care',
    answer: yn('infoSharingConsent'),
    detail: [
      sharingWith.length ? `With: ${sharingWith.join(', ')}.` : '',
      text(k('infoSharingLimits')) ? `Limits: ${text(k('infoSharingLimits'))}.` : '',
      text(k('infoSharingRestrictions')) ? `Restrictions: ${text(k('infoSharingRestrictions'))}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    on,
    source: 'INITIAL_ASSESSMENT',
  });
  const refusal = yes(k('partialConsentRefusal'));
  rows.push({
    key: 'ia-care',
    title: 'Consent to receive care and support',
    answer: yes(k('consentToCare')) ? (refusal ? 'PARTLY' : 'GIVEN') : no(k('consentToCare')) ? 'REFUSED' : 'NOT_ANSWERED',
    detail: refusal ? `Not consented to, or conditions: ${text(k('partialConsentRefusalDetails')) || 'not described'}.` : '',
    on,
    source: 'INITIAL_ASSESSMENT',
  });
  const decisions = Array.isArray(capacityDecisions) ? (capacityDecisions as Array<Record<string, unknown>>) : [];
  for (const d of decisions) {
    if (d.outcome !== 'has_capacity' && d.outcome !== 'lacks_capacity') continue;
    const title =
      d.decision === 'other'
        ? String(d.decisionOther ?? '').trim() || 'Other decision'
        : (CAPACITY_DECISION_WORDS[String(d.decision)] ?? 'Decision not named');
    const lacks = d.outcome === 'lacks_capacity';
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    rows.push({
      key: `capacity-${String(d.id ?? title)}`,
      title,
      answer: lacks ? 'BEST_INTERESTS' : 'HAS_CAPACITY',
      detail: lacks
        ? [
            d.authorityCovers === 'yes' ? `Decided by their legal authority${str(d.authorityDetails) ? ` (${str(d.authorityDetails)})` : ''}.` : '',
            str(d.bestInterestsOutcome) ? `Best-interests decision: ${str(d.bestInterestsOutcome)}.` : '',
            str(d.bestInterestsDecisionMaker) ? `Decision maker: ${str(d.bestInterestsDecisionMaker)}.` : '',
            str(d.wishes) ? `Their wishes: ${str(d.wishes)}.` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : `Able to make this decision themselves${str(d.assessorName) ? `; assessed by ${str(d.assessorName)}` : ''}.`,
      on: str(d.assessedOn).slice(0, 10) || on,
      source: 'CAPACITY',
    });
  }
  return rows;
}

/**
 * The version of a survey a person's own link should open in, from their communication needs: easy read when
 * they need it and the survey has it, else the language they need an interpreter for when it is published.
 * Null = English. The person can still switch on the page.
 */
export function suggestedSurveyLanguage(
  needs: { formats: string[]; interpreterNeeded: boolean; interpreterLanguage: string } | null | undefined,
  offered: Array<{ code: string; name?: string | null; nativeName?: string | null }>,
): string | null {
  if (!needs || !offered.length) return null;
  if (needs.formats.includes('EASY_READ') || needs.formats.includes('PLAIN_LANGUAGE')) {
    const easy = offered.find((l) => l.code === 'en-x-easyread');
    if (easy) return easy.code;
  }
  const want = needs.interpreterNeeded ? needs.interpreterLanguage.trim().toLowerCase() : '';
  if (!want) return null;
  const match = offered.find(
    (l) => l.code.toLowerCase() === want || (l.name ?? '').toLowerCase() === want || (l.nativeName ?? '').toLowerCase() === want,
  );
  return match?.code ?? null;
}

/**
 * What carers need to know about sharing, one line each: who they may tell what (with conditions), and who sharing
 * was stopped with (and not restarted). For the carer app's client details.
 */
export function carerSharingNotes(
  lines: Array<{
    recipientName: string;
    recipientRole: string;
    contactId: string | null;
    categories: string[];
    conditions: string;
    startsOn: Date;
    endsOn: Date | null;
    stoppedAt: Date | null;
  }>,
  today: string,
): string[] {
  const active = lines.filter((l) => sharingIsActive(l, today));
  const notes = active.map((l) => {
    const who = l.recipientRole ? `${l.recipientName} (${l.recipientRole})` : l.recipientName;
    const care = l.categories.filter((c) => c !== 'SURVEYS');
    const what = care.includes('ALL')
      ? 'anything about their care'
      : care.map((c) => (SHARING_CATEGORIES[c as SharingCategory] ?? c).toLowerCase()).join(', ');
    const surveys = l.categories.includes('SURVEYS');
    const told = what ? `may be told: ${what}${surveys ? '; and may be sent our surveys' : ''}` : 'may be sent our surveys';
    return `${who} ${told}${l.conditions ? `. ${l.conditions}` : ''}`;
  });
  const activeNames = new Set(active.map((l) => l.contactId ?? l.recipientName));
  const stopped = new Set<string>();
  for (const l of lines) {
    const key = l.contactId ?? l.recipientName;
    if (l.stoppedAt && !activeNames.has(key) && !stopped.has(key)) {
      stopped.add(key);
      notes.push(`Do not share information with ${l.recipientName}`);
    }
  }
  return notes;
}

/** Consents that can be recorded or changed on the profile, and their titles. OTHER takes its own title. */
export const CONSENT_TOPICS = {
  ASSESSMENT: 'Consent to the assessment',
  FAMILY_INVOLVEMENT: 'Family or representatives involved in the assessment',
  INFO_SHARING: 'Sharing information with people and professionals involved in their care',
  CARE: 'Consent to receive care and support',
  PHOTOGRAPHY: 'Photographs (body map and observations)',
  MEDICATION_SUPPORT: 'Support with medication',
  KEY_SAFE: 'Key safe and access to the home',
  OTHER: 'Other',
} as const;
export type ConsentTopic = keyof typeof CONSENT_TOPICS;
export const CONSENT_TOPIC_KEYS = Object.keys(CONSENT_TOPICS) as ConsentTopic[];
export const CONSENT_CHANGE_ANSWERS = ['GIVEN', 'REFUSED', 'PARTLY', 'WITHDRAWN', 'BEST_INTERESTS'] as const;
export const CONSENT_METHODS = { written: 'in writing', verbal: 'verbally', non_verbal: 'by gestures or other non-verbal ways', representative: 'by their representative' } as const;

/**
 * The person's standing consent to photographs, for the carer app. Each body map photo still asks for consent at
 * the time; this tells the carer beforehand if the person has refused or withdrawn it, or agreed with limits.
 */
export function carerPhotoConsent(
  latest: { answer: string; details: string | null; decidedOn: Date | string } | null,
): { answer: string; note: string } | null {
  if (!latest) return null;
  const on = typeof latest.decidedOn === 'string' ? latest.decidedOn.slice(0, 10) : latest.decidedOn.toISOString().slice(0, 10);
  const limits = latest.details?.trim() ? ` ${latest.details.trim()}` : '';
  switch (latest.answer) {
    case 'REFUSED':
    case 'WITHDRAWN':
      return {
        answer: latest.answer,
        note: `${latest.answer === 'REFUSED' ? 'Refused' : 'Withdrew'} consent to photographs (${on}). Do not take photos; record on the body map without one and tell the office.${limits}`,
      };
    case 'PARTLY':
      return { answer: latest.answer, note: `Agreed to some photographs only (${on}).${limits || ' Check with the office before taking one.'}` };
    case 'BEST_INTERESTS':
      return { answer: latest.answer, note: `Photographs agreed as a best interests decision (${on}).${limits}` };
    case 'GIVEN':
      return { answer: latest.answer, note: `Agreed to photographs (${on}). Still ask each time.${limits}` };
    default:
      return null;
  }
}

/** The assessment rows that a change on the profile replaces, by topic. */
const ASSESSMENT_ROW_TOPIC: Record<string, ConsentTopic> = {
  'ia-assessment': 'ASSESSMENT',
  'ia-family': 'FAMILY_INVOLVEMENT',
  'ia-sharing': 'INFO_SHARING',
  'ia-care': 'CARE',
};

type ConsentChangeInput = {
  topic: string;
  title: string;
  answer: string;
  method: string;
  givenBy: string;
  details: string;
  decidedOn: Date;
  createdAt: Date;
  recordedBy: string | null;
};

const topicKey = (c: { topic: string; title: string }) => (c.topic === 'OTHER' ? `OTHER:${c.title.trim().toLowerCase()}` : c.topic);

/**
 * The consent record with changes made since the assessment: the newest change for a topic is the consent now,
 * and what it replaced (earlier changes, then the assessment's answer) is its history. Topics the assessment did
 * not cover appear from their first change. Rows from other sources pass through unchanged.
 */
export function mergeConsentChanges(rows: ConsentRow[], changes: ConsentChangeInput[]): ConsentRow[] {
  const byTopic = new Map<string, ConsentChangeInput[]>();
  for (const c of [...changes].sort((a, b) => b.decidedOn.getTime() - a.decidedOn.getTime() || b.createdAt.getTime() - a.createdAt.getTime())) {
    const k = topicKey(c);
    byTopic.set(k, [...(byTopic.get(k) ?? []), c]);
  }
  const asRow = (c: ConsentChangeInput) => {
    const who = c.givenBy.trim() ? `${c.answer === 'BEST_INTERESTS' ? 'decided by' : 'by'} ${c.givenBy.trim()}` : '';
    const how = CONSENT_METHODS[c.method as keyof typeof CONSENT_METHODS] ?? '';
    const lead = [who, how].filter(Boolean).join(', ');
    return {
      answer: c.answer as ConsentRow['answer'],
      detail: [lead ? `${lead.charAt(0).toUpperCase()}${lead.slice(1)}.` : '', c.details.trim()].filter(Boolean).join(' '),
      on: dayOf(c.decidedOn),
      source: 'CHANGE' as const,
      recordedBy: c.recordedBy,
    };
  };
  const used = new Set<string>();
  const out: ConsentRow[] = rows.map((r) => {
    const topic = ASSESSMENT_ROW_TOPIC[r.key];
    if (!topic) return r;
    const list = byTopic.get(topic);
    used.add(topic);
    const assessment = { answer: r.answer, detail: r.detail, on: r.on, source: r.source, recordedBy: null };
    if (!list?.length) return { ...r, topic, history: [] };
    const [now, ...earlier] = list;
    return { ...r, ...asRow(now), key: r.key, title: r.title, topic, history: [...earlier.map(asRow), assessment] };
  });
  for (const [k, list] of byTopic) {
    if (used.has(k)) continue;
    const [now, ...earlier] = list;
    out.push({
      key: `change-${k}`,
      title: now.topic === 'OTHER' ? now.title.trim() || 'Other consent' : CONSENT_TOPICS[now.topic as ConsentTopic] ?? now.topic,
      ...asRow(now),
      topic: now.topic,
      history: earlier.map(asRow),
    });
  }
  return out;
}
