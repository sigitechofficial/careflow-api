import type { PrismaClient } from '@prisma/client';
import { SECTION_1_QUESTIONS } from './initial-assessment-enterprise.seed';
import { HOLISTIC_SECTION_1_EXTRA_QUESTIONS } from './initial-assessment-holistic-section-1.seed';
import { ABOUT_ME_IA_QUESTION_TEXT } from './initial-assessment-about-me.seed';
import { SECTION_4_QUESTIONS } from './initial-assessment-enterprise-section-4.seed';
import {
  SECTION_7_QUESTIONS,
  SECTION_8_QUESTIONS,
  SECTION_9_QUESTIONS,
} from './initial-assessment-enterprise-sections-5-10.seed';
import {
  SECTION_11_QUESTIONS,
  SECTION_13_QUESTIONS,
} from './initial-assessment-enterprise-sections-11-14.seed';
import { pruneSectionCanonicalExtras } from './initial-assessment-section-prune.util';

function specRefStarts(sectionPrefix: string) {
  return (metadata: unknown): boolean => {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    const specRef = (metadata as Record<string, unknown>).specRef;
    return typeof specRef === 'string' && specRef.startsWith(sectionPrefix);
  };
}

const SECTION_1_LEGACY = new Set(['sec_care_assistance_required']);
const SECTION_4_LEGACY = new Set(['sec_build']);
const SECTION_7_LEGACY = new Set(['sec_incontinence']);
const SECTION_8_LEGACY = new Set(['sec_speech_impairment', 'sec_hearing', 'sec_sight']);
const SECTION_9_LEGACY = new Set(['sec_medication']);
const SECTION_11_LEGACY = new Set(['sec_skin_condition']);
const SECTION_13_LEGACY = new Set(['sec_additional_risks']);

export async function pruneSection1ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    1,
    [
      ...SECTION_1_QUESTIONS.map((q) => q.questionText),
      ...HOLISTIC_SECTION_1_EXTRA_QUESTIONS.map((q) => q.questionText),
      ...ABOUT_ME_IA_QUESTION_TEXT,
    ],
    specRefStarts('1.'),
    SECTION_1_LEGACY,
  );
}

export async function pruneSection4ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    4,
    SECTION_4_QUESTIONS.map((q) => q.questionText),
    specRefStarts('4.'),
    SECTION_4_LEGACY,
  );
}

export async function pruneSection7ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    7,
    SECTION_7_QUESTIONS.map((q) => q.questionText),
    specRefStarts('7.'),
    SECTION_7_LEGACY,
  );
}

export async function pruneSection8ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    8,
    SECTION_8_QUESTIONS.map((q) => q.questionText),
    specRefStarts('8.'),
    SECTION_8_LEGACY,
  );
}

export async function pruneSection9ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    9,
    SECTION_9_QUESTIONS.map((q) => q.questionText),
    specRefStarts('9.'),
    SECTION_9_LEGACY,
  );
}

export async function pruneSection11ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    11,
    SECTION_11_QUESTIONS.map((q) => q.questionText),
    specRefStarts('11.'),
    SECTION_11_LEGACY,
  );
}

export async function pruneSection13ActiveExtras(prisma: PrismaClient): Promise<number> {
  return pruneSectionCanonicalExtras(
    prisma,
    13,
    SECTION_13_QUESTIONS.map((q) => q.questionText),
    specRefStarts('13.'),
    SECTION_13_LEGACY,
  );
}
