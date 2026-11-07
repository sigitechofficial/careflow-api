import { Prisma, SurveyQuestionType, SurveyStatus, SurveyTargetKind, type PrismaClient } from '@prisma/client';
import {
  loadSurveyLibrary,
  readReleasedLibraryIds,
  surveyDescription,
  surveyLibraryMeta,
  surveyScoringRow,
  surveyQuestionRows,
  type ReleasedLibraryIds,
  type SurveyLibraryFile,
} from '../seed-lib/survey-library';

/** JSON with object keys sorted, so equal values compare equal whatever order they were stored in. */
function fingerprint(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(sort(value));
}

type QuestionFields = {
  questionText: string;
  helpText: string | null;
  questionType: string;
  options: unknown;
  config: unknown;
  isRequired: boolean;
  sortOrder: number;
  sectionTitle: string | null;
  key: string | null;
  otherOption: unknown;
  exclusiveOptions: unknown;
  commentConfig: unknown;
  showIf: unknown;
  optionsFrom?: string | null;
};

/** What a catalogue question is compared on (a change to any of these replaces the questions). */
const questionFingerprint = (q: QuestionFields) => [
  q.questionText,
  q.helpText,
  q.questionType,
  q.options,
  q.config,
  q.isRequired,
  q.sortOrder,
  q.sectionTitle,
  q.key,
  q.otherOption ?? null,
  q.exclusiveOptions ?? null,
  q.commentConfig ?? null,
  q.showIf ?? null,
  q.optionsFrom ?? null,
];

/**
 * The survey library as catalogue surveys
 (isCatalogue = true, isTemplate = true): ready-made
 * surveys an organisation adopts as its own templates from Surveys → Ready-made surveys. Runs on
 * every deploy. Catalogue surveys belong to CareFlow, so their content is refreshed and ones no
 * longer in the library are retired; nothing an organisation adopted or wrote is touched, and
 * catalogue surveys never appear in survey lists, counts, sends or links (all filter isCatalogue).
 * Text keeps `{{organisation}}`; it is filled from the company profile when shown or adopted.
 */
export async function seedSurveyLibrary(
  prisma: PrismaClient,
  files: SurveyLibraryFile[] = loadSurveyLibrary(),
  /** Released question ids: questions keep their released keys (see questionKeys). */
  released: ReleasedLibraryIds = readReleasedLibraryIds(),
  /**
   * References a partial load skipped (LoadSurveyLibraryOptions.skipped). They are still in the
   * library, only unfinished, so their catalogue surveys are left as they are, never retired.
   */
  opts: { keep?: readonly string[] } = {},
): Promise<{ created: number; updated: number; unchanged: number; retired: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const references = [...files.flatMap((f) => f.surveys.map((s) => s.reference)), ...(opts.keep ?? [])];

  for (const file of files) {
    for (const s of file.surveys) {
      const meta = surveyLibraryMeta(s, file.group, released[s.reference] ?? null);
      const rows = surveyQuestionRows(s, released[s.reference] ?? null);
      const questions = rows.map((q) => ({
        ...q,
        questionType: q.questionType as SurveyQuestionType,
        options: q.options ?? Prisma.JsonNull,
        config: q.config ?? Prisma.JsonNull,
        otherOption: q.otherOption ?? Prisma.JsonNull,
        exclusiveOptions: q.exclusiveOptions ?? Prisma.JsonNull,
        commentConfig: q.commentConfig ?? Prisma.JsonNull,
        showIf: q.showIf ?? Prisma.JsonNull,
      }));
      const details = {
        title: s.title,
        description: surveyDescription(s),
        targetKind: s.audience as SurveyTargetKind,
        isAnonymous: s.anonymous,
        allowAnonymousResponses: !s.anonymous && s.allowAnonymousResponses === true,
        libraryRevision: s.revision,
        libraryMeta: meta as unknown as Prisma.InputJsonValue,
        audienceGroup: meta.audienceGroup,
        closingMessage: s.closingMessage?.trim() || null,
        // A scored measure's scales (null clears scoring a revision took away).
        scoring: (surveyScoringRow(s) as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
      };

      const existing = await prisma.survey.findFirst({
        where: { isCatalogue: true, libraryReference: s.reference },
        include: { questions: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      });
      if (!existing) {
        await prisma.survey.create({
          data: {
            ...details,
            status: SurveyStatus.DRAFT,
            isTemplate: true,
            isCatalogue: true,
            libraryReference: s.reference,
            locationIds: [],
            roleIds: [],
            questions: { create: questions },
          },
        });
        created += 1;
        continue;
      }

      // Postgres stores JSON with its own key order, so compare with keys sorted.
      const same =
        !existing.deletedAt &&
        existing.isTemplate &&
        existing.title === details.title &&
        existing.description === details.description &&
        existing.targetKind === details.targetKind &&
        existing.isAnonymous === details.isAnonymous &&
        existing.allowAnonymousResponses === details.allowAnonymousResponses &&
        existing.libraryRevision === details.libraryRevision &&
        existing.audienceGroup === details.audienceGroup &&
        (existing.closingMessage ?? null) === details.closingMessage &&
        fingerprint(existing.libraryMeta) === fingerprint(meta) &&
        fingerprint(existing.scoring ?? null) === fingerprint(surveyScoringRow(s)) &&
        fingerprint(existing.questions.map((q) => questionFingerprint(q))) ===
          fingerprint(rows.map((q) => questionFingerprint(q)));
      if (same) {
        unchanged += 1;
        continue;
      }

      // Catalogue surveys are never sent or answered, so their questions can simply be replaced.
      await prisma.$transaction([
        prisma.surveyQuestion.deleteMany({ where: { surveyId: existing.id } }),
        prisma.survey.update({
          where: { id: existing.id },
          data: {
            ...details,
            status: SurveyStatus.DRAFT,
            isTemplate: true,
            deletedAt: null,
            questions: { create: questions },
          },
        }),
      ]);
      updated += 1;
    }
  }

  const retired = await prisma.survey.updateMany({
    where: { isCatalogue: true, deletedAt: null, libraryReference: { notIn: references } },
    data: { deletedAt: new Date() },
  });
  return { created, updated, unchanged, retired: retired.count };
}
