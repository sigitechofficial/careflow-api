import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SurveysService } from './surveys.service';
import {
  LANGUAGE_BY_CODE,
  SURVEY_LANGUAGES,
  applyTranslationEdits,
  readTranslationContent,
  readTranslationCsv,
  sourceStrings,
  translationCsv,
  translationProgress,
  type SourceString,
  type TranslationContent,
} from './survey-translation.util';
import {
  QUESTION_SELECT,
  TRANSLATION_STATUS,
  type SourceSurvey,
} from './survey-translations.answer-page';

/**
 * A survey in other languages and easy read (roadmap Phase 3). Translations belong to the survey people
 * are sent, or to the repeating survey (each period uses its repeating survey's translations, matched
 * through each question's sourceQuestionId). Staff edit them on screen or with a translator's pack (CSV);
 * a published translation is offered on the answer page. Answers are always stored in English.
 */
@Injectable()
export class SurveyTranslationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly audit: AuditLogsService,
  ) {}

  /** The survey whose translations apply: a period's repeating survey, else the survey itself. */
  private ownerOf<T extends { clonedFromId: string | null }>(
    survey: T & { id: string },
  ): string {
    return survey.clonedFromId ?? survey.id;
  }

  private async readable(
    actor: RequestUser,
    surveyId: string,
  ): Promise<Survey> {
    const s = await this.surveys.visibleSurvey(actor, surveyId);
    if (!s || s.isCatalogue) throw new NotFoundException('Survey not found');
    return s;
  }

  private async writable(
    actor: RequestUser,
    surveyId: string,
  ): Promise<Survey> {
    const s = await this.surveys.editableSurvey(actor, surveyId);
    if (s.isCatalogue) throw new NotFoundException('Survey not found');
    if (s.clonedFromId)
      throw new BadRequestException(
        'Translate the repeating survey: each period uses its translations.',
      );
    return s;
  }

  private language(code: string) {
    const lang = LANGUAGE_BY_CODE.get(code);
    if (!lang)
      throw new BadRequestException('Choose a language from the list.');
    return lang;
  }

  /** The texts to translate on this survey (the repeating survey's own questions). */
  async sourcesFor(survey: SourceSurvey): Promise<SourceString[]> {
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: survey.id, deletedAt: null, isActive: true },
      select: QUESTION_SELECT,
    });
    return sourceStrings(survey, questions);
  }

  // ─── Staff ──────────────────────────────────────────────────────────────

  async list(actor: RequestUser, surveyId: string) {
    const survey = await this.readable(actor, surveyId);
    const ownerId = this.ownerOf(survey);
    const owner =
      ownerId === survey.id
        ? survey
        : await this.prisma.survey.findUniqueOrThrow({
            where: { id: ownerId },
          });
    const [rows, sources] = await Promise.all([
      this.prisma.surveyTranslation.findMany({
        where: { surveyId: ownerId },
        orderBy: { language: 'asc' },
      }),
      this.sourcesFor(owner),
    ]);
    return {
      message: 'Translations',
      data: {
        surveyId: ownerId,
        editedOnSurveyId: ownerId !== survey.id ? ownerId : null,
        languages: SURVEY_LANGUAGES,
        translations: rows.map((r) => {
          const lang = LANGUAGE_BY_CODE.get(r.language);
          return {
            language: r.language,
            name: lang?.name ?? r.language,
            nativeName: lang?.nativeName ?? r.language,
            dir: lang?.dir ?? 'ltr',
            status: r.status,
            publishedAt: r.publishedAt?.toISOString() ?? null,
            updatedAt: r.updatedAt.toISOString(),
            progress: translationProgress(
              sources,
              readTranslationContent(r.content),
            ),
          };
        }),
      },
    };
  }

  async get(actor: RequestUser, surveyId: string, code: string) {
    const survey = await this.readable(actor, surveyId);
    const lang = this.language(code);
    const ownerId = this.ownerOf(survey);
    const owner =
      ownerId === survey.id
        ? survey
        : await this.prisma.survey.findUniqueOrThrow({
            where: { id: ownerId },
          });
    const row = await this.prisma.surveyTranslation.findUnique({
      where: { surveyId_language: { surveyId: ownerId, language: code } },
    });
    const content = readTranslationContent(row?.content);
    const sources = await this.sourcesFor(owner);
    return {
      message: 'Translation',
      data: {
        surveyId: ownerId,
        language: lang,
        status: row?.status ?? null,
        publishedAt: row?.publishedAt?.toISOString() ?? null,
        progress: translationProgress(sources, content),
        strings: sources.map((s) => {
          const t = content.strings[s.key];
          return {
            key: s.key,
            where: s.where,
            english: s.english,
            translation: t?.text ?? '',
            /** Translated from English that has since changed: shown in English to people until redone. */
            outOfDate: Boolean(t && t.source !== s.english),
            /** What it was translated from, when the English has since changed. */
            translatedFrom: t && t.source !== s.english ? t.source : null,
          };
        }),
      },
    };
  }

  /** Save translated texts (draft or published). Keys not on the survey are refused. */
  async save(
    actor: RequestUser,
    surveyId: string,
    code: string,
    edits: unknown,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.writable(actor, surveyId);
    this.language(code);
    const list = Array.isArray(edits)
      ? (edits as unknown[]).filter((e): e is { key: string; text: string } => {
          const o = e as { key?: unknown; text?: unknown } | null;
          return (
            Boolean(o) &&
            typeof o!.key === 'string' &&
            typeof o!.text === 'string'
          );
        })
      : [];
    if (!list.length) throw new BadRequestException('Nothing to save.');
    if (list.length > 2000)
      throw new BadRequestException('Too many texts at once.');
    const sources = await this.sourcesFor(survey);
    const row = await this.prisma.surveyTranslation.findUnique({
      where: { surveyId_language: { surveyId: survey.id, language: code } },
    });
    const { content, unknownKeys } = applyTranslationEdits(
      sources,
      readTranslationContent(row?.content),
      list,
    );
    if (unknownKeys.length)
      throw new BadRequestException(
        'Some texts are no longer on this survey. Reload and try again.',
      );
    await this.write(
      actor,
      survey,
      code,
      content,
      row ? undefined : TRANSLATION_STATUS.DRAFT,
    );
    await this.log(actor, survey, code, 'saved', { texts: list.length }, meta);
    return this.get(actor, surveyId, code);
  }

  /** A filled-in translator's pack. Rows whose English has changed since the pack was made are not taken. */
  async importCsv(
    actor: RequestUser,
    surveyId: string,
    code: string,
    csv: unknown,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.writable(actor, surveyId);
    this.language(code);
    if (typeof csv !== 'string' || !csv.trim())
      throw new BadRequestException('Choose the filled-in file.');
    if (csv.length > 2_000_000)
      throw new BadRequestException('That file is too large for one survey.');
    const sources = await this.sourcesFor(survey);
    let read;
    try {
      read = readTranslationCsv(csv, sources);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'The file could not be read.',
      );
    }
    const row = await this.prisma.surveyTranslation.findUnique({
      where: { surveyId_language: { surveyId: survey.id, language: code } },
    });
    const { content } = applyTranslationEdits(
      sources,
      readTranslationContent(row?.content),
      read.edits,
    );
    if (read.edits.length)
      await this.write(
        actor,
        survey,
        code,
        content,
        row ? undefined : TRANSLATION_STATUS.DRAFT,
      );
    await this.log(
      actor,
      survey,
      code,
      'imported',
      {
        taken: read.edits.length,
        englishChanged: read.englishChanged.length,
        blank: read.blank,
      },
      meta,
    );
    const result = await this.get(actor, surveyId, code);
    return {
      message: `${read.edits.length} text${read.edits.length === 1 ? '' : 's'} taken from the file`,
      data: {
        ...result.data,
        imported: {
          taken: read.edits.length,
          englishChanged: read.englishChanged,
          unknownKeys: read.unknownKeys,
          blank: read.blank,
        },
      },
    };
  }

  async exportCsv(actor: RequestUser, surveyId: string, code: string) {
    const survey = await this.readable(actor, surveyId);
    const lang = this.language(code);
    const ownerId = this.ownerOf(survey);
    const owner =
      ownerId === survey.id
        ? survey
        : await this.prisma.survey.findUniqueOrThrow({
            where: { id: ownerId },
          });
    const row = await this.prisma.surveyTranslation.findUnique({
      where: { surveyId_language: { surveyId: ownerId, language: code } },
    });
    const sources = await this.sourcesFor(owner);
    const safeTitle =
      owner.title
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'survey';
    return {
      message: 'Translator’s pack',
      data: {
        filename: `${safeTitle}-${lang.code}.csv`,
        csv: translationCsv(sources, readTranslationContent(row?.content)),
      },
    };
  }

  /**
   * Offer it to people answering. Every text of the survey itself must be translated and up to date (people
   * would otherwise meet a page in two languages); the page's own wording may fall back to English.
   */
  async publish(
    actor: RequestUser,
    surveyId: string,
    code: string,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.writable(actor, surveyId);
    this.language(code);
    const row = await this.prisma.surveyTranslation.findUnique({
      where: { surveyId_language: { surveyId: survey.id, language: code } },
    });
    if (!row) throw new NotFoundException('Translate it first.');
    const sources = (await this.sourcesFor(survey)).filter(
      (s) => !s.key.startsWith('ui:') && s.key !== 'closingMessage',
    );
    const progress = translationProgress(
      sources,
      readTranslationContent(row.content),
    );
    if (progress.missing || progress.outOfDate) {
      throw new BadRequestException(
        `${progress.missing + progress.outOfDate} of the survey’s texts still need translating${progress.outOfDate ? ` (${progress.outOfDate} because the English changed)` : ''}.`,
      );
    }
    await this.prisma.surveyTranslation.update({
      where: { id: row.id },
      data: {
        status: TRANSLATION_STATUS.PUBLISHED,
        publishedAt: new Date(),
        updatedById: actor.id,
      },
    });
    await this.log(actor, survey, code, 'published', {}, meta);
    return this.get(actor, surveyId, code);
  }

  async unpublish(
    actor: RequestUser,
    surveyId: string,
    code: string,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.writable(actor, surveyId);
    this.language(code);
    const row = await this.prisma.surveyTranslation.findUnique({
      where: { surveyId_language: { surveyId: survey.id, language: code } },
    });
    if (!row) throw new NotFoundException('Translation not found');
    await this.prisma.surveyTranslation.update({
      where: { id: row.id },
      data: {
        status: TRANSLATION_STATUS.DRAFT,
        publishedAt: null,
        updatedById: actor.id,
      },
    });
    await this.log(actor, survey, code, 'withdrawn', {}, meta);
    return this.get(actor, surveyId, code);
  }

  async remove(
    actor: RequestUser,
    surveyId: string,
    code: string,
    meta?: RequestAuditMeta,
  ) {
    const survey = await this.writable(actor, surveyId);
    this.language(code);
    const { count } = await this.prisma.surveyTranslation.deleteMany({
      where: { surveyId: survey.id, language: code },
    });
    if (!count) throw new NotFoundException('Translation not found');
    await this.log(actor, survey, code, 'deleted', {}, meta);
    return {
      message: 'Translation deleted',
      data: { surveyId: survey.id, language: code },
    };
  }

  private async write(
    actor: RequestUser,
    survey: Survey,
    code: string,
    content: TranslationContent,
    createStatus?: string,
  ) {
    const json = content as unknown as Prisma.InputJsonValue;
    await this.prisma.surveyTranslation.upsert({
      where: { surveyId_language: { surveyId: survey.id, language: code } },
      create: {
        surveyId: survey.id,
        language: code,
        status: createStatus ?? TRANSLATION_STATUS.DRAFT,
        content: json,
        createdById: actor.id,
        updatedById: actor.id,
      },
      update: { content: json, updatedById: actor.id },
    });
  }

  private async log(
    actor: RequestUser,
    survey: Survey,
    code: string,
    what: string,
    counts: Record<string, number>,
    meta?: RequestAuditMeta,
  ) {
    const lang = LANGUAGE_BY_CODE.get(code);
    await this.audit.logAudit({
      userId: actor.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_TRANSLATION_CHANGED,
      recordType: 'Survey',
      recordId: survey.id,
      description: `${lang?.name ?? code} translation ${what} on survey "${survey.title}"`,
      newValues: { language: code, change: what, ...counts },
      ...(meta ?? {}),
    });
  }
}
