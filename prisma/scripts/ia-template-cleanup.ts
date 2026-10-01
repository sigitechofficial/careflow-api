/**
 * IA template cleanup for the default (Enterprise) template. Idempotent — safe to re-run.
 * - soft-deletes redundant questions
 * - aligns question text / metadata changed in the seed (upsert by fieldKey)
 *
 * Runs after `prisma db seed` on deploy (see run-deploy-seeds.sh) because the seed's legacy-catalog
 * import can re-activate retired questions. Scoped to the default template so the legacy checklist
 * template is never touched. Answers are kept (soft delete) so finalised IAs still export in full.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  ABOUT_ME_IA_QUESTIONS,
  IA_ABOUT_ME_MERGED_FIELD_KEYS,
  IA_ABOUT_ME_REMOVED_FIELD_KEYS,
} from '../seeds/initial-assessment-about-me.seed';
import {
  BEST_INTEREST_DETAILS_HELP,
  IA_CONSENT_TAB_QUESTIONS,
  IA_CONSENT_TAB_RETIRED_FIELD_KEYS,
  IA_CULTURAL_BACKGROUND_QUESTION,
  IA_DEPRIVATION_OF_LIBERTY_QUESTIONS,
  IA_DOL_RETIRED_FIELD_KEYS,
  IA_MISSING_CONTENT_SECTION_1_QUESTIONS,
} from '../seeds/initial-assessment-enterprise.seed';
import {
  IA_FALLS_HISTORY_QUESTIONS,
  SECTION_11_QUESTIONS,
} from '../seeds/initial-assessment-enterprise-sections-11-14.seed';
import { SECTION_9_QUESTIONS } from '../seeds/initial-assessment-enterprise-sections-5-10.seed';
import { PAIN_DISTRESS_OPTIONS } from '../seeds/initial-assessment-enterprise-options';

const REDUNDANT_QUESTION_TEXTS = [
  // Prior §1 / person-centred cleanup
  'How does the person prefer to be addressed?',
  'BSL required?',
  'Hearing support required?',
  'Visual support required?',
  'Important routines (meals, prayer, medication, bedtime)',
  'Personal priorities, goals, independence goals',
  'Care preferences and dislikes',
  'Activity likes and dislikes',
  // Pairs 16 / 18 / 20–27
  'Assessor designation',
  'Family, LPA, deputy, appointee, advocate involvement',
  'Poor lighting?',
  'Heating risk?',
  'Breathing / pain / swallowing action plan notes',
  'Pain management plan documented?',
  'Care plan recommendations reviewed?',
  'Actions generated and reviewed?',
  'Risk matrix entry required for identified risks?',
  'Reviewed monthly (legacy additional risk flag)?',
  // Pairs 28–39
  'Beliefs',
  'Religion, culture, language, reasonable adjustments',
  'Communication needs',
  'Gets agitated with change?',
  'De-orientated?',
  'Feels low in mood?',
  'Thickened fluids required?',
  'Prompting or reminding required?',
  'Help removing medicines from packaging required?',
  'Assistance administering medication required?',
  'Independent self-administration?',
  'Hoist / profiling bed / air mattress in use?',
  'Key safe code',
  'Instructions for gaining access to client’s home',
  'Lone worker risk identified?',
  'Staff safety instructions',
  'GP name',
  'GP practice and phone',
  // C45 — manager panel / submit metadata own these
  'Manager review required?',
  'Approved for care start?',
  // §2.8 — sharing with GP / pharmacy / local authority is part of direct care, not a consent question
  'Consent to share with GP',
  'Consent to share with pharmacy',
  'Consent to share with local authority',
] as const;

/** Retired About Me 1.3a copy of §1.3 "What matters most" (same question, asked twice on Tab 1). */
const RETIRED_ABOUT_ME_MOST_IMPORTANT_FIELD_KEY = 'whatIsMostImportantToMe';
const WHAT_MATTERS_MOST_FIELD_KEY = 'whatMattersMost';
/** Only IAs still being filled in get answers moved; finalised ones keep their record as signed. */
const OPEN_SUBMISSION_STATUSES = ['DRAFT', 'IN_PROGRESS'] as const;

const FURTHER_EQUIPMENT_QUESTION_TEXT = 'Further equipment required to be ordered?';
const FURTHER_EQUIPMENT_FIELD_KEY = 'furtherEquipmentRequired';

/**
 * Stable fieldKeys for questions that consumers used to find by question text. The text stays
 * as-is (older readers still match it); the key lets new readers stop depending on wording.
 */
const FIELD_KEY_BACKFILL: ReadonlyArray<{ sectionNumber: number; questionText: string; fieldKey: string }> = [
  { sectionNumber: 13, questionText: 'DNACPR or ReSPECT in place?', fieldKey: 'dnacprRespectInPlace' },
  { sectionNumber: 12, questionText: 'Number of falls (last 12 months)', fieldKey: 'fallsCount12Months' },
  { sectionNumber: 12, questionText: 'Most recent fall date', fieldKey: 'mostRecentFallDate' },
  { sectionNumber: 12, questionText: 'Injury caused by fall?', fieldKey: 'fallInjury' },
  { sectionNumber: 2, questionText: 'Has the Service User consented to receive care and support?', fieldKey: 'consentToCare' },
  { sectionNumber: 2, questionText: 'MCA completed?', fieldKey: 'mcaCompleted' },
  { sectionNumber: 2, questionText: 'Best interest decision required?', fieldKey: 'bestInterestDecisionRequired' },
  { sectionNumber: 2, questionText: 'Best interest decision details', fieldKey: 'bestInterestDecisionDetails' },
];

type SeedQuestion = (typeof IA_DEPRIVATION_OF_LIBERTY_QUESTIONS)[number];

/** Create or align seed questions in one section, matched by `metadata.fieldKey`. */
async function upsertSectionQuestionsByFieldKey(
  prisma: PrismaClient,
  templateId: string,
  sectionNumber: number,
  questions: readonly SeedQuestion[],
  label: string,
): Promise<void> {
  const section = await prisma.initialAssessmentSection.findFirst({
    where: { templateId, sectionNumber, deletedAt: null },
    select: { id: true },
  });
  if (!section) return;
  let created = 0;
  let updated = 0;
  for (const q of questions) {
    const fieldKey = (q.metadata as Record<string, unknown> | undefined)?.fieldKey;
    if (typeof fieldKey !== 'string') continue;
    const flags = q as { riskFlag?: boolean; carePlanTrigger?: boolean };
    const data = {
      questionText: q.questionText,
      helpText: q.helpText ?? null,
      questionType: q.questionType!,
      options: q.options ? (q.options as Prisma.InputJsonValue) : Prisma.JsonNull,
      isRequired: q.isRequired ?? false,
      ...(flags.riskFlag !== undefined ? { riskFlag: flags.riskFlag } : {}),
      ...(flags.carePlanTrigger !== undefined ? { carePlanTrigger: flags.carePlanTrigger } : {}),
      sortOrder: q.sortOrder,
      metadata: (q.metadata ?? {}) as Prisma.InputJsonValue,
      isActive: true,
      deletedAt: null,
    };
    const existing = await prisma.initialAssessmentQuestion.findFirst({
      where: { sectionId: section.id, metadata: { path: ['fieldKey'], equals: fieldKey } },
      select: { id: true },
    });
    if (existing) {
      await prisma.initialAssessmentQuestion.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.initialAssessmentQuestion.create({ data: { sectionId: section.id, ...data } });
      created += 1;
    }
  }
  console.log(`${label}: ${updated} aligned, ${created} created.`);
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function asHtmlParagraphs(value: string): string {
  const v = value.trim();
  if (v.startsWith('<')) return v;
  const escaped = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function metaObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const template = await prisma.initialAssessmentTemplate.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!template) {
      console.log('No default IA template — nothing to clean up.');
      return;
    }
    const inTemplate = { section: { templateId: template.id, deletedAt: null } };

    const pruned = await prisma.initialAssessmentQuestion.updateMany({
      where: {
        ...inTemplate,
        deletedAt: null,
        questionText: { in: [...REDUNDANT_QUESTION_TEXTS] },
      },
      data: { deletedAt: new Date(), isActive: false },
    });
    console.log(`[${template.name}] soft-deleted ${pruned.count} redundant IA question(s).`);

    // C42 — §12.10 is the single "further equipment" trigger; the admin derives §11.1 from it.
    const furtherEquipment = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, questionText: FURTHER_EQUIPMENT_QUESTION_TEXT },
      select: { id: true, metadata: true },
    });
    for (const q of furtherEquipment) {
      const meta = metaObject(q.metadata);
      if (meta.fieldKey === FURTHER_EQUIPMENT_FIELD_KEY) continue;
      await prisma.initialAssessmentQuestion.update({
        where: { id: q.id },
        data: { metadata: { ...meta, fieldKey: FURTHER_EQUIPMENT_FIELD_KEY } as Prisma.InputJsonValue },
      });
      console.log(`[${template.name}] set fieldKey "${FURTHER_EQUIPMENT_FIELD_KEY}" on §12.10.`);
    }

    // §1.7 — culture question that replaced the retired combined field.
    const cultural = IA_CULTURAL_BACKGROUND_QUESTION;
    const culturalFieldKey = metaObject(cultural.metadata as Prisma.JsonValue).fieldKey as string;
    const section1 = await prisma.initialAssessmentSection.findFirst({
      where: { templateId: template.id, sectionNumber: 1, deletedAt: null },
      select: { id: true },
    });
    if (section1) {
      const existing = await prisma.initialAssessmentQuestion.findFirst({
        where: {
          sectionId: section1.id,
          metadata: { path: ['fieldKey'], equals: culturalFieldKey },
        },
        select: { id: true, isActive: true, deletedAt: true },
      });
      if (!existing) {
        await prisma.initialAssessmentQuestion.create({
          data: {
            sectionId: section1.id,
            questionText: cultural.questionText,
            questionType: cultural.questionType!,
            sortOrder: cultural.sortOrder,
            metadata: cultural.metadata as Prisma.InputJsonValue,
            isActive: true,
          },
        });
        console.log(`[${template.name}] created §1.7 "${cultural.questionText}".`);
      } else if (!existing.isActive || existing.deletedAt) {
        await prisma.initialAssessmentQuestion.update({
          where: { id: existing.id },
          data: { isActive: true, deletedAt: null },
        });
        console.log(`[${template.name}] re-activated §1.7 "${cultural.questionText}".`);
      }
    }
    // §1.9 hospital stay, §1.10 social wellbeing, §1.11 smoking / alcohol / drugs.
    await upsertSectionQuestionsByFieldKey(
      prisma,
      template.id,
      1,
      IA_MISSING_CONTENT_SECTION_1_QUESTIONS,
      `[${template.name}] §1.9–1.11 hospital / social / substance use`,
    );

    // §18.2 wording: any local fire and rescue service, not only London.
    for (const [fieldKey, questionText] of [
      ['londonFireBrigadeInformed', 'Local fire and rescue service informed (home fire safety visit)?'],
      ['londonFireBrigadeDetails', 'Local fire and rescue service — details'],
    ] as const) {
      await prisma.initialAssessmentQuestion.updateMany({
        where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: fieldKey } },
        data: { questionText },
      });
    }

    // §3.2 kept a duplicate "fire service — details" row with the same fieldKey as §18.2 (hidden on the
    // Environment tab, but found first by fieldKey lookups). Move open-IA text to §18.2, then retire it.
    const fireDetailRows = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: 'londonFireBrigadeDetails' } },
      select: { id: true, section: { select: { sectionNumber: true } } },
    });
    const fireMaster = fireDetailRows.find((q) => q.section.sectionNumber === 18);
    for (const dup of fireDetailRows.filter((q) => q.section.sectionNumber === 3)) {
      if (!fireMaster) break;
      const open = await prisma.initialAssessmentAnswer.findMany({
        where: { questionId: dup.id, submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] }, deletedAt: null } },
        select: { submissionId: true, textValue: true },
      });
      for (const a of open) {
        if (!plainText(a.textValue ?? '')) continue;
        const key = { submissionId_questionId: { submissionId: a.submissionId, questionId: fireMaster.id } };
        const target = await prisma.initialAssessmentAnswer.findUnique({ where: key, select: { textValue: true } });
        if (plainText(target?.textValue ?? '')) continue;
        await prisma.initialAssessmentAnswer.upsert({
          where: key,
          create: { submissionId: a.submissionId, questionId: fireMaster.id, textValue: a.textValue },
          update: { textValue: a.textValue },
        });
      }
      await prisma.initialAssessmentQuestion.update({
        where: { id: dup.id },
        data: { deletedAt: new Date(), isActive: false },
      });
      console.log(`[${template.name}] retired the duplicate §3.2 fire-service details row (kept §18.2).`);
    }

    // §13.9 "District nurse involved?" gets a fieldKey so hospital follow-ups can fill it.
    const districtNurse = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, questionText: 'District nurse involved?' },
      select: { id: true, metadata: true },
    });
    for (const q of districtNurse) {
      const meta = metaObject(q.metadata);
      if (meta.fieldKey === 'districtNurseInvolved') continue;
      await prisma.initialAssessmentQuestion.update({
        where: { id: q.id },
        data: { metadata: { ...meta, fieldKey: 'districtNurseInvolved' } as Prisma.InputJsonValue },
      });
    }

    // §1.3 "What matters most" starts from the About Me "What is most important to me" (fill-empty prefill).
    const whatMattersMost = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: WHAT_MATTERS_MOST_FIELD_KEY } },
      select: { id: true, metadata: true },
    });
    for (const q of whatMattersMost) {
      const meta = metaObject(q.metadata);
      if (meta.prefillKey === 'aboutMe_whatIsMostImportantToMe') continue;
      await prisma.initialAssessmentQuestion.update({
        where: { id: q.id },
        data: { metadata: { ...meta, prefillKey: 'aboutMe_whatIsMostImportantToMe' } as Prisma.InputJsonValue },
      });
    }

    // About Me 1.3a "What is most important to me" duplicated §1.3 "What matters most" on the same
    // tab. Open IAs keep the text in §1.3 (copied when empty, added below when different); then the
    // 1.3a question is retired. Finalised IAs are untouched and still export the old answer.
    if (whatMattersMost[0]) {
      const targetId = whatMattersMost[0].id;
      const retiredMostImportant = await prisma.initialAssessmentQuestion.findMany({
        where: {
          ...inTemplate,
          metadata: { path: ['fieldKey'], equals: RETIRED_ABOUT_ME_MOST_IMPORTANT_FIELD_KEY },
        },
        select: { id: true },
      });
      const oldAnswers = await prisma.initialAssessmentAnswer.findMany({
        where: {
          questionId: { in: retiredMostImportant.map((q) => q.id) },
          textValue: { not: null },
          submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] } },
        },
        select: { submissionId: true, textValue: true },
      });
      let copied = 0;
      let appended = 0;
      let same = 0;
      for (const old of oldAnswers) {
        const value = old.textValue?.trim() ?? '';
        if (!plainText(value)) continue;
        const key = { submissionId_questionId: { submissionId: old.submissionId, questionId: targetId } };
        const existing = await prisma.initialAssessmentAnswer.findUnique({
          where: key,
          select: { textValue: true },
        });
        const current = existing?.textValue?.trim() ?? '';
        if (!plainText(current)) {
          await prisma.initialAssessmentAnswer.upsert({
            where: key,
            create: { submissionId: old.submissionId, questionId: targetId, textValue: value },
            update: { textValue: value },
          });
          copied += 1;
        } else if (plainText(current).includes(plainText(value))) {
          same += 1;
        } else {
          await prisma.initialAssessmentAnswer.update({
            where: key,
            data: { textValue: `${asHtmlParagraphs(current)}${asHtmlParagraphs(value)}` },
          });
          appended += 1;
        }
      }
      const retired = await prisma.initialAssessmentQuestion.updateMany({
        where: { id: { in: retiredMostImportant.map((q) => q.id) }, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      });
      console.log(
        `[${template.name}] About Me "What is most important to me" → §1.3 What matters most: ` +
          `${copied} copied, ${appended} added below, ${same} already there; ${retired.count} question(s) retired.`,
      );
    }

    // About Me merged pairs (good day → happy, bad day → unhappy, family and friends → people important):
    // align the kept question's wording / prefill, move open-IA text across (copied when empty, added
    // below when different), then retire the merged-away question. Finalised IAs keep their record.
    for (const { from, into } of IA_ABOUT_ME_MERGED_FIELD_KEYS) {
      const seedQ = ABOUT_ME_IA_QUESTIONS.find((q) => metaObject(q.metadata as Prisma.JsonValue).fieldKey === into);
      const [target] = await prisma.initialAssessmentQuestion.findMany({
        where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: into } },
        select: { id: true, metadata: true },
      });
      if (!seedQ || !target) continue;
      await prisma.initialAssessmentQuestion.update({
        where: { id: target.id },
        data: {
          questionText: seedQ.questionText,
          metadata: { ...metaObject(target.metadata), ...metaObject(seedQ.metadata as Prisma.JsonValue) } as Prisma.InputJsonValue,
        },
      });
      const sources = await prisma.initialAssessmentQuestion.findMany({
        where: { ...inTemplate, metadata: { path: ['fieldKey'], equals: from } },
        select: { id: true, deletedAt: true },
      });
      const oldAnswers = await prisma.initialAssessmentAnswer.findMany({
        where: {
          questionId: { in: sources.map((q) => q.id) },
          textValue: { not: null },
          submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] } },
        },
        select: { submissionId: true, textValue: true },
      });
      let moved = 0;
      for (const old of oldAnswers) {
        const value = old.textValue?.trim() ?? '';
        if (!plainText(value)) continue;
        const key = { submissionId_questionId: { submissionId: old.submissionId, questionId: target.id } };
        const current = (await prisma.initialAssessmentAnswer.findUnique({ where: key, select: { textValue: true } }))
          ?.textValue?.trim() ?? '';
        if (plainText(current).includes(plainText(value))) continue;
        const next = plainText(current) ? `${asHtmlParagraphs(current)}${asHtmlParagraphs(value)}` : value;
        await prisma.initialAssessmentAnswer.upsert({
          where: key,
          create: { submissionId: old.submissionId, questionId: target.id, textValue: next },
          update: { textValue: next },
        });
        moved += 1;
      }
      const retired = await prisma.initialAssessmentQuestion.updateMany({
        where: { id: { in: sources.map((q) => q.id) }, deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      });
      if (moved || retired.count) {
        console.log(`[${template.name}] About Me "${from}" → "${into}": ${moved} open IA answer(s) merged, ${retired.count} retired.`);
      }
    }

    const removedAboutMe = await prisma.initialAssessmentQuestion.updateMany({
      where: {
        ...inTemplate,
        deletedAt: null,
        OR: IA_ABOUT_ME_REMOVED_FIELD_KEYS.map((fieldKey) => ({ metadata: { path: ['fieldKey'], equals: fieldKey } })),
      },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (removedAboutMe.count) {
      console.log(`[${template.name}] About Me: retired ${removedAboutMe.count} question(s) asked elsewhere.`);
    }

    // Key-safe codes saved on the retired §1.2 / §3 "Key safe code" move to §3.5 "Door entry code" (the
    // single secure key-safe field, synced with DOM Care). Values are already encrypted (both fields are
    // secure) so they are copied as stored; an existing door code is never overwritten.
    const doorCodeQuestion = await prisma.initialAssessmentQuestion.findFirst({
      where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: 'doorCode' } },
      select: { id: true },
    });
    if (doorCodeQuestion) {
      const retiredKeySafe = await prisma.initialAssessmentQuestion.findMany({
        where: {
          ...inTemplate,
          OR: [
            { metadata: { path: ['fieldKey'], equals: 'keySafeCodeHolistic' } },
            { metadata: { path: ['fieldKey'], equals: 'keySafeCode' } },
          ],
        },
        select: { id: true },
      });
      const oldAnswers = await prisma.initialAssessmentAnswer.findMany({
        where: { questionId: { in: retiredKeySafe.map((q) => q.id) }, textValue: { not: null } },
        select: { submissionId: true, textValue: true },
      });
      let moved = 0;
      let kept = 0;
      let plain = 0;
      for (const old of oldAnswers) {
        const value = old.textValue?.trim();
        if (!value) continue;
        const existing = await prisma.initialAssessmentAnswer.findUnique({
          where: {
            submissionId_questionId: { submissionId: old.submissionId, questionId: doorCodeQuestion.id },
          },
          select: { textValue: true },
        });
        if (existing?.textValue?.trim()) {
          kept += 1;
          continue;
        }
        if (!value.startsWith('enc:')) plain += 1;
        await prisma.initialAssessmentAnswer.upsert({
          where: {
            submissionId_questionId: { submissionId: old.submissionId, questionId: doorCodeQuestion.id },
          },
          create: { submissionId: old.submissionId, questionId: doorCodeQuestion.id, textValue: value },
          update: { textValue: value },
        });
        moved += 1;
      }
      console.log(
        `[${template.name}] key-safe codes → §3.5 door code: ${moved} moved, ${kept} kept (door code already set)` +
          (plain ? `, ${plain} were stored unencrypted (they encrypt when next edited)` : '') +
          '.',
      );
    }

    // Consent tab: older rows had no fieldKey. Key them first (matched by current or
    // former wording) so the upsert below rewords them in place and their answers stay attached.
    const section2 = await prisma.initialAssessmentSection.findFirst({
      where: { templateId: template.id, sectionNumber: 2, deletedAt: null },
      select: { id: true },
    });
    if (section2) {
      let keyed = 0;
      for (const q of IA_CONSENT_TAB_QUESTIONS) {
        const fieldKey = metaObject(q.metadata as Prisma.JsonValue).fieldKey as string;
        const hasKeyed = await prisma.initialAssessmentQuestion.findFirst({
          where: { sectionId: section2.id, metadata: { path: ['fieldKey'], equals: fieldKey } },
          select: { id: true },
        });
        if (hasKeyed) continue;
        const byText = await prisma.initialAssessmentQuestion.findFirst({
          where: {
            sectionId: section2.id,
            deletedAt: null,
            questionText: { in: [q.questionText, ...(q.formerQuestionTexts ?? [])] },
          },
          select: { id: true, metadata: true },
        });
        if (!byText) continue;
        await prisma.initialAssessmentQuestion.update({
          where: { id: byText.id },
          data: { metadata: { ...metaObject(byText.metadata), fieldKey } as Prisma.InputJsonValue },
        });
        keyed += 1;
      }
      if (keyed) console.log(`[${template.name}] Consent tab: set fieldKey on ${keyed} existing question(s).`);
    }
    await upsertSectionQuestionsByFieldKey(
      prisma,
      template.id,
      2,
      IA_CONSENT_TAB_QUESTIONS,
      `[${template.name}] consent tab (10 questions)`,
    );

    // Open IAs keep what was already answered on the retired consent questions:
    // "Capacity … appears intact?" is the inverse of "reason to doubt capacity?", and
    // "Consent given by: LPA / attorney" means a Health & Welfare LPA is in place.
    const byFieldKey = async (fieldKey: string) =>
      prisma.initialAssessmentQuestion.findMany({
        where: { ...inTemplate, metadata: { path: ['fieldKey'], equals: fieldKey } },
        select: { id: true, deletedAt: true },
      });
    const openAnswers = (questionIds: string[]) =>
      prisma.initialAssessmentAnswer.findMany({
        where: { questionId: { in: questionIds }, submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] } } },
        select: { submissionId: true, checked: true, booleanValue: true, selectedOptions: true },
      });
    const moveAnswer = async (
      submissionId: string,
      questionId: string,
      data: Prisma.InitialAssessmentAnswerUncheckedUpdateInput,
    ): Promise<boolean> => {
      const key = { submissionId_questionId: { submissionId, questionId } };
      const existing = await prisma.initialAssessmentAnswer.findUnique({
        where: key,
        select: { checked: true, booleanValue: true, selectedOptions: true },
      });
      const answered =
        existing &&
        (existing.checked != null ||
          existing.booleanValue != null ||
          (Array.isArray(existing.selectedOptions) && existing.selectedOptions.length > 0));
      if (answered) return false;
      await prisma.initialAssessmentAnswer.upsert({
        where: key,
        create: { ...(data as Prisma.InitialAssessmentAnswerUncheckedCreateInput), submissionId, questionId },
        update: data,
      });
      return true;
    };
    const [doubtQ] = (await byFieldKey('capacityDoubt')).filter((q) => !q.deletedAt);
    if (doubtQ) {
      let moved = 0;
      for (const a of await openAnswers((await byFieldKey('capacityToConsentIntact')).map((q) => q.id))) {
        const intact = a.booleanValue ?? a.checked;
        if (intact == null) continue;
        if (await moveAnswer(a.submissionId, doubtQ.id, { checked: !intact, booleanValue: !intact })) moved += 1;
      }
      if (moved) console.log(`[${template.name}] capacity intact → reason to doubt capacity: ${moved} open IA(s) moved.`);
    }
    const [legalQ] = (await byFieldKey('legalAuthority')).filter((q) => !q.deletedAt);
    if (legalQ) {
      let moved = 0;
      for (const a of await openAnswers((await byFieldKey('consentGivenBy')).map((q) => q.id))) {
        const sel = Array.isArray(a.selectedOptions) ? a.selectedOptions : [];
        if (!sel.includes('lpa')) continue;
        if (await moveAnswer(a.submissionId, legalQ.id, { selectedOptions: ['hw_lpa'] })) moved += 1;
      }
      if (moved) console.log(`[${template.name}] consent given by LPA → Health & Welfare LPA: ${moved} open IA(s).`);
    }

    // Consolidation: restrictions → "anything they do not consent to / conditions", the free-text
    // "Who may be involved?" → representative name, and Personal Details' "Representative involved in
    // assessment?" → the Consent tab question (asked once now).
    const textAnswers = (questionIds: string[]) =>
      prisma.initialAssessmentAnswer.findMany({
        where: { questionId: { in: questionIds }, submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] } } },
        select: { submissionId: true, checked: true, booleanValue: true, textValue: true },
      });
    const idsOf = async (fieldKey: string) => (await byFieldKey(fieldKey)).map((q) => q.id);
    const [refusalQ] = (await byFieldKey('partialConsentRefusal')).filter((q) => !q.deletedAt);
    const [refusalDetailsQ] = (await byFieldKey('partialConsentRefusalDetails')).filter((q) => !q.deletedAt);
    if (refusalQ && refusalDetailsQ) {
      const restrictionsYes = new Set(
        (await openAnswers(await idsOf('consentRestrictions')))
          .filter((a) => (a.booleanValue ?? a.checked) === true)
          .map((a) => a.submissionId),
      );
      let merged = 0;
      for (const a of await textAnswers(await idsOf('consentRestrictionsDetails'))) {
        const text = a.textValue?.trim();
        if (!restrictionsYes.has(a.submissionId) || !text || !plainText(text)) continue;
        await moveAnswer(a.submissionId, refusalQ.id, { checked: true, booleanValue: true });
        const key = { submissionId_questionId: { submissionId: a.submissionId, questionId: refusalDetailsQ.id } };
        const current = (await prisma.initialAssessmentAnswer.findUnique({ where: key, select: { textValue: true } }))
          ?.textValue?.trim() ?? '';
        if (plainText(current).includes(plainText(text))) continue;
        const next = plainText(current) ? `${asHtmlParagraphs(current)}${asHtmlParagraphs(text)}` : text;
        await prisma.initialAssessmentAnswer.upsert({
          where: key,
          create: { submissionId: a.submissionId, questionId: refusalDetailsQ.id, textValue: next },
          update: { textValue: next },
        });
        merged += 1;
      }
      if (merged) console.log(`[${template.name}] consent restrictions → conditions to follow: ${merged} open IA(s).`);
    }
    const [repNameQ] = (await byFieldKey('familyInvolvedName')).filter((q) => !q.deletedAt);
    if (repNameQ) {
      let moved = 0;
      for (const a of await textAnswers(await idsOf('familyInvolvedWho'))) {
        const text = a.textValue ? plainText(a.textValue) : '';
        if (!text) continue;
        const key = { submissionId_questionId: { submissionId: a.submissionId, questionId: repNameQ.id } };
        const existing = await prisma.initialAssessmentAnswer.findUnique({ where: key, select: { textValue: true } });
        if (existing?.textValue?.trim()) continue;
        await prisma.initialAssessmentAnswer.upsert({
          where: key,
          create: { submissionId: a.submissionId, questionId: repNameQ.id, textValue: text },
          update: { textValue: text },
        });
        moved += 1;
      }
      if (moved) console.log(`[${template.name}] "Who may be involved?" → representative name: ${moved} open IA(s).`);
    }
    const personalRepGate = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, questionText: 'Representative involved in assessment?' },
      select: { id: true },
    });
    const [involvementQ] = (await byFieldKey('familyInvolvementConsent')).filter((q) => !q.deletedAt);
    if (personalRepGate.length && involvementQ) {
      let moved = 0;
      for (const a of await openAnswers(personalRepGate.map((q) => q.id))) {
        const yes = a.booleanValue ?? a.checked;
        if (yes == null) continue;
        if (await moveAnswer(a.submissionId, involvementQ.id, { checked: yes, booleanValue: yes })) moved += 1;
      }
      await prisma.initialAssessmentQuestion.updateMany({
        where: { id: { in: personalRepGate.map((q) => q.id) } },
        data: { deletedAt: new Date(), isActive: false },
      });
      console.log(
        `[${template.name}] Personal Details "Representative involved in assessment?" retired (asked on the Consent tab)` +
          (moved ? `; ${moved} open IA answer(s) moved.` : '.'),
      );
    }
    // Personal Details representative name / relationship now follow the Consent tab gate.
    for (const questionText of ['Representative name', 'Representative relationship']) {
      const rows = await prisma.initialAssessmentQuestion.findMany({
        where: { ...inTemplate, deletedAt: null, questionText, section: { templateId: template.id, sectionNumber: 1 } },
        select: { id: true, metadata: true },
      });
      for (const q of rows) {
        const meta = metaObject(q.metadata);
        const showWhen = metaObject(meta.showWhen as Prisma.JsonValue);
        if (showWhen.gateFieldKey === 'familyInvolvementConsent') continue;
        await prisma.initialAssessmentQuestion.update({
          where: { id: q.id },
          data: {
            metadata: {
              ...meta,
              showWhen: { gateFieldKey: 'familyInvolvementConsent', yes: true },
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    const retiredConsent = await prisma.initialAssessmentQuestion.updateMany({
      where: {
        ...inTemplate,
        deletedAt: null,
        OR: IA_CONSENT_TAB_RETIRED_FIELD_KEYS.map((fieldKey) => ({ metadata: { path: ['fieldKey'], equals: fieldKey } })),
      },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (retiredConsent.count) {
      console.log(`[${template.name}] retired ${retiredConsent.count} replaced consent question(s).`);
    }

    // "LPOA" → "LPA" (Lasting Power of Attorney) in the Personal Details question text.
    for (const [fieldKey, questionText] of [
      ['lpoaAppointed', 'LPA appointed?'],
      ['lpoaContactDetails', 'LPA contact details'],
      ['lpoaDesignation', 'LPA designation'],
      ['lpoaName', 'LPA name'],
    ] as const) {
      await prisma.initialAssessmentQuestion.updateMany({
        where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: fieldKey } },
        data: { questionText },
      });
    }

    for (const item of FIELD_KEY_BACKFILL) {
      const rows = await prisma.initialAssessmentQuestion.findMany({
        where: {
          ...inTemplate,
          deletedAt: null,
          questionText: item.questionText,
          section: { templateId: template.id, deletedAt: null, sectionNumber: item.sectionNumber },
        },
        select: { id: true, metadata: true },
      });
      for (const q of rows) {
        const meta = metaObject(q.metadata);
        if (meta.fieldKey === item.fieldKey) continue;
        await prisma.initialAssessmentQuestion.update({
          where: { id: q.id },
          data: { metadata: { ...meta, fieldKey: item.fieldKey } as Prisma.InputJsonValue },
        });
        console.log(`[${template.name}] set fieldKey "${item.fieldKey}" on "${item.questionText}".`);
      }
    }

    await prisma.initialAssessmentQuestion.updateMany({
      where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: 'bestInterestDecisionDetails' } },
      data: { helpText: BEST_INTEREST_DETAILS_HELP },
    });

    // Option lists changed in the seed (new values are additive — existing answers stay valid).
    for (const [fieldKey, options] of [['painConcerns', PAIN_DISTRESS_OPTIONS]] as const) {
      await prisma.initialAssessmentQuestion.updateMany({
        where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: fieldKey } },
        data: { options: options as unknown as Prisma.InputJsonValue },
      });
    }

    // §1.8 "Language required" is free text: prefill the language name, not the lookup code.
    for (const q of await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, questionText: 'Language required' },
      select: { id: true, metadata: true },
    })) {
      const meta = metaObject(q.metadata);
      if (meta.prefillKey !== 'language') continue;
      await prisma.initialAssessmentQuestion.update({
        where: { id: q.id },
        data: { metadata: { ...meta, prefillKey: 'languageName' } as Prisma.InputJsonValue },
      });
    }

    // "Planned number of carers" is hidden and owned by DOM Care / the visit plan — never required.
    await prisma.initialAssessmentQuestion.updateMany({
      where: { ...inTemplate, deletedAt: null, questionText: 'Planned number of carers', isRequired: true },
      data: { isRequired: false },
    });

    // §1.0 "Care instructions for staff" shared a syncKey with §3.5 access instructions, so every save
    // overwrote the care instructions with the access text. Give it its own key; on IAs still being
    // filled in, drop a copy that is identical to the access text so DOM Care prefills it again.
    const careInstructionQs = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, questionText: 'Care instructions for staff' },
      select: { id: true, metadata: true },
    });
    const [accessQ] = await prisma.initialAssessmentQuestion.findMany({
      where: { ...inTemplate, deletedAt: null, metadata: { path: ['fieldKey'], equals: 'accessInstructions' } },
      select: { id: true },
    });
    let clearedCopies = 0;
    for (const q of careInstructionQs) {
      const meta = metaObject(q.metadata);
      if (meta.syncKey === 'accessInstructions') {
        const { syncKey: _dropped, ...rest } = meta;
        await prisma.initialAssessmentQuestion.update({
          where: { id: q.id },
          data: { metadata: { ...rest, fieldKey: 'careInstructions' } as Prisma.InputJsonValue },
        });
      }
      if (!accessQ) continue;
      const copies = await prisma.initialAssessmentAnswer.findMany({
        where: { questionId: q.id, submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] }, deletedAt: null } },
        select: { id: true, submissionId: true, textValue: true },
      });
      for (const a of copies) {
        const access = await prisma.initialAssessmentAnswer.findUnique({
          where: { submissionId_questionId: { submissionId: a.submissionId, questionId: accessQ.id } },
          select: { textValue: true },
        });
        const same = plainText(a.textValue ?? '') && plainText(a.textValue ?? '') === plainText(access?.textValue ?? '');
        if (same) {
          await prisma.initialAssessmentAnswer.delete({ where: { id: a.id } });
          clearedCopies += 1;
        }
      }
    }
    if (clearedCopies) {
      console.log(`[${template.name}] cleared ${clearedCopies} care-instruction answer(s) that were copies of the access text.`);
    }

    // §12.7 falls case-finding (after the fieldKey backfill above, so existing rows are matched).
    await upsertSectionQuestionsByFieldKey(
      prisma,
      template.id,
      12,
      IA_FALLS_HISTORY_QUESTIONS as unknown as readonly SeedQuestion[],
      `[${template.name}] §12.7 falls case-finding`,
    );

    // §2.9 Deprivation of liberty — screening first (restrictions → concern → review → status).
    await upsertSectionQuestionsByFieldKey(
      prisma,
      template.id,
      2,
      IA_DEPRIVATION_OF_LIBERTY_QUESTIONS,
      `[${template.name}] §2.9 deprivation of liberty`,
    );
    // §11 skin — bruising, wound dressings and repositioning (new fieldKeys; other rows unchanged).
    await upsertSectionQuestionsByFieldKey(
      prisma,
      template.id,
      11,
      SECTION_11_QUESTIONS.filter((q) =>
        [
          'skinBruising',
          'skinBruisingDetails',
          'woundDressingRequired',
          'woundDressingDetails',
          'repositioningRequired',
          'repositioningDetails',
        ].includes(String((q.metadata as Record<string, unknown> | undefined)?.fieldKey)),
      ) as unknown as readonly SeedQuestion[],
      `[${template.name}] §11 bruising, wound dressings, repositioning`,
    );
    // §9 medication — one support vocabulary (codes unchanged) + §9.6 managing medicines.
    await upsertSectionQuestionsByFieldKey(
      prisma,
      template.id,
      9,
      SECTION_9_QUESTIONS as unknown as readonly SeedQuestion[],
      `[${template.name}] §9 medication (support vocabulary, managing medicines)`,
    );
    // Open IAs: carry the old "authorisation in place?" answers onto the new status question. A "No"
    // with no referral maps to "not known — to be checked", never to "not required".
    const dolKey = async (fieldKey: string) =>
      (
        await prisma.initialAssessmentQuestion.findFirst({
          where: { ...inTemplate, metadata: { path: ['fieldKey'], equals: fieldKey } },
          select: { id: true },
        })
      )?.id;
    const [oldGateId, oldTypeId, oldReferredId, statusId, concernId] = await Promise.all(
      ['dolsLpsAuthorisationInPlace', 'dolAuthorisationType', 'dolReferredAwaiting', 'dolAuthorisationStatus', 'dolConcern'].map(dolKey),
    );
    if (oldGateId && statusId && concernId) {
      let mapped = 0;
      const gates = await prisma.initialAssessmentAnswer.findMany({
        where: { questionId: oldGateId, submission: { status: { in: [...OPEN_SUBMISSION_STATUSES] }, deletedAt: null } },
        select: { submissionId: true, checked: true, booleanValue: true },
      });
      for (const gate of gates) {
        const inPlace = gate.booleanValue ?? gate.checked;
        if (inPlace == null) continue;
        const existing = await prisma.initialAssessmentAnswer.findUnique({
          where: { submissionId_questionId: { submissionId: gate.submissionId, questionId: statusId } },
          select: { id: true },
        });
        if (existing) continue;
        const sel = async (questionId: string | undefined) =>
          questionId
            ? prisma.initialAssessmentAnswer.findUnique({
                where: { submissionId_questionId: { submissionId: gate.submissionId, questionId } },
                select: { checked: true, booleanValue: true, selectedOptions: true },
              })
            : null;
        const type = await sel(oldTypeId);
        const referred = await sel(oldReferredId);
        const typeValue = Array.isArray(type?.selectedOptions) ? String(type?.selectedOptions[0] ?? '') : '';
        const status = inPlace
          ? typeValue === 'court_of_protection'
            ? 'authorised_cop'
            : typeValue === 'dols_care_home_hospital'
              ? 'authorised_dols'
              : 'unknown'
          : (referred?.booleanValue ?? referred?.checked) === true
            ? 'application_made'
            : 'unknown';
        await prisma.initialAssessmentAnswer.create({
          data: { submissionId: gate.submissionId, questionId: statusId, selectedOptions: [status] },
        });
        await prisma.initialAssessmentAnswer.upsert({
          where: { submissionId_questionId: { submissionId: gate.submissionId, questionId: concernId } },
          create: { submissionId: gate.submissionId, questionId: concernId, selectedOptions: ['unsure'] },
          update: {},
        });
        mapped += 1;
      }
      if (mapped) console.log(`[${template.name}] mapped ${mapped} old deprivation-of-liberty answer(s) to the new status.`);
    }
    const retiredDol = await prisma.initialAssessmentQuestion.updateMany({
      where: {
        ...inTemplate,
        deletedAt: null,
        OR: IA_DOL_RETIRED_FIELD_KEYS.map((fieldKey) => ({ metadata: { path: ['fieldKey'], equals: fieldKey } })),
      },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (retiredDol.count) console.log(`[${template.name}] retired ${retiredDol.count} old deprivation-of-liberty question(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
