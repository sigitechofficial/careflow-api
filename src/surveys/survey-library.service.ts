import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SurveyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import {
  readCommentConfig,
  readExclusiveOptions,
  readNotCountedOptions,
  readOtherOption,
  readShowIf,
  type CommentSettings,
  type OtherOptionSettings,
  type ShowIfSettings,
} from './survey-question-config.util';
import { isContactRequestQuestion, storedAllowAnonymousResponses } from './survey-respondent-anonymity.util';
import { libraryRuleRows, type AlertQuestion } from './survey-alert-rules.util';
import { withLookupOptions } from './survey-lookup-options';
import { describePlan, planLibraryUpdate, readKeyChanges, type LibraryUpdatePlan } from './survey-library-update.util';
import { libraryAnonymousVariant } from './survey-library-variant.util';

/** Json column value for a create (null → SQL NULL). */
const jsonOrNull = (value: unknown) =>
  value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

/** A show-if rule with the text of the question it points at (for the Ready-made reader). */
function showIfWithText(
  rule: ShowIfSettings | null,
  textByKey: ReadonlyMap<string, string>,
): (ShowIfSettings & { questionText: string | null }) | null {
  return rule ? { ...rule, questionText: textByKey.get(rule.questionKey) ?? null } : null;
}

/** Library details on a catalogue survey (Survey.libraryMeta; prisma/seed-lib/survey-library.ts). */
type LibraryMeta = {
  type: 'survey-library';
  version: 1;
  group: { code: string; short: string; name: string; displayOrder: number; researchedOn: string };
  revisionNote: string | null;
  respondents: string;
  summary: string;
  purpose: string;
  timing: { when: string; recurrence: string | null; trigger: string | null };
  channels: string[];
  cqc: { keyQuestions: string[]; qualityStatements: string[] };
  estimatedMinutes: number;
  introduction: string;
  privacyNotice: string;
  managerGuidance: {
    howToRun: string[];
    actingOnResults: string[];
    alerts: Array<{ when: string; action: string }>;
  };
  relatedPolicies: string[];
  regulatoryBasis: Array<{ source: string; url: string }>;
  sections: Array<{ title: string; questionCount: number; evidence: string[]; introduction?: string }>;
};

function libraryMeta(value: Prisma.JsonValue | null | undefined): LibraryMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.type === 'survey-library' && v.version === 1 && v.group && typeof v.group === 'object'
    ? (v as unknown as LibraryMeta)
    : null;
}

const ORGANISATION_TOKEN = '{{organisation}}';

/** Replace the organisation token in every string of a JSON value. */
function fillDeep<T>(value: T, name: string): T {
  if (typeof value === 'string') return value.split(ORGANISATION_TOKEN).join(name) as T;
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, name)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillDeep(v, name)]),
    ) as T;
  }
  return value;
}

/** A good number of surveys can be adopted in one go, but not the whole library by accident. */
const MAX_ADOPT = 50;

const CATALOGUE_WHERE = { isCatalogue: true, isTemplate: true, deletedAt: null } satisfies Prisma.SurveyWhereInput;

const catalogueInclude = {
  questions: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.SurveyInclude;
type CatalogueSurvey = Prisma.SurveyGetPayload<{ include: typeof catalogueInclude }>;

type AdoptedTemplate = { templateId: string; libraryRevision: number | null };

/** Question bank: who a question is for (from its ready-made survey's group). */
export const BANK_AUDIENCES = ['PWS', 'FAM', 'STF', 'PRO', 'ORG', 'CQC'] as const;
export type BankAudience = (typeof BANK_AUDIENCES)[number];
/** Organisation-wide and job-applicant surveys are shown together as "Organisation / public". */
export function bankAudienceOf(groupShort: string): BankAudience {
  return (BANK_AUDIENCES as readonly string[]).includes(groupShort) ? (groupShort as BankAudience) : 'ORG';
}

/** Question bank: answer type filters (written answers together). */
export const BANK_TYPE_GROUPS: Record<string, string[]> = {
  YES_NO: ['YES_NO'],
  SINGLE_SELECT: ['SINGLE_SELECT'],
  MULTI_SELECT: ['MULTI_SELECT'],
  LIKERT: ['LIKERT'],
  RATING: ['RATING'],
  TEXT: ['TEXT', 'TEXTAREA'],
  NUMBER: ['NUMBER'],
};

export type QuestionBankQuery = {
  search?: string;
  audience?: BankAudience;
  topic?: string;
  type?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Surveys → Ready-made surveys: surveys researched for CQC home care (catalogue surveys) an
 * organisation adopts as its own survey TEMPLATES. A template is a starting point only; "Use this
 * template" then creates a draft survey as usual. Adopted templates are company-wide, so (as for
 * every company template) only users with access to all branches can adopt or change them;
 * branch-restricted users can read the library and use adopted templates.
 * `{{organisation}}` becomes the organisation's name (company profile) when shown or adopted.
 */
@Injectable()
export class SurveyLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditLogsService,
  ) {}

  async list() {
    const [rows, organisationName] = await Promise.all([
      this.prisma.survey.findMany({
        where: CATALOGUE_WHERE,
        orderBy: { libraryReference: 'asc' },
        include: catalogueInclude,
      }),
      this.organisationName(),
    ]);
    const adopted = await this.adoptedTemplates(rows.map((r) => r.id));
    return {
      data: rows.flatMap((r) => {
        const meta = libraryMeta(r.libraryMeta);
        return meta ? [fillDeep(this.summaryOf(r, meta, adopted), organisationName)] : [];
      }),
    };
  }

  /** One ready-made survey: introduction, privacy notice, sections and questions, manager guidance. */
  async get(id: string) {
    const row = await this.prisma.survey.findFirst({ where: { id, ...CATALOGUE_WHERE }, include: catalogueInclude });
    const meta = libraryMeta(row?.libraryMeta);
    if (!row || !meta) throw new NotFoundException('Survey not found in the library');
    const [adopted, policyTitles, organisationName] = await Promise.all([
      this.adoptedTemplates([row.id]),
      this.policyTitles(meta.relatedPolicies),
      this.organisationName(),
    ]);
    const sections = this.sectionsOf(row, meta);
    return {
      data: fillDeep(
        {
          ...this.summaryOf(row, meta, adopted),
          purpose: meta.purpose,
          introduction: meta.introduction,
          privacyNotice: meta.privacyNotice,
          /** Shown to people after they submit. */
          closingMessage: row.closingMessage ?? null,
          sections,
          // An alert retired in place (its position is its identity) is not shown.
          managerGuidance: {
            ...meta.managerGuidance,
            alerts: meta.managerGuidance.alerts.filter((a) => (a as { retired?: unknown }).retired !== true),
          },
          relatedPolicies: meta.relatedPolicies.map((reference) => ({
            reference,
            title: policyTitles.get(reference) ?? null,
          })),
          regulatoryBasis: meta.regulatoryBasis,
          anonymousVariant: this.variantSummary(row.libraryMeta, row.questions, meta),
        },
        organisationName,
      ),
    };
  }

  /**
   * The anonymous version a named ready-made survey offers (chosen at New survey): what people read
   * first and what it leaves out. Null when there is none.
   */
  private variantSummary(
    libraryMeta: Prisma.JsonValue | null,
    questions: Array<{ key: string | null; questionText: string }>,
    meta: { managerGuidance: { alerts: Array<{ when: string }> } },
  ) {
    const v = libraryAnonymousVariant(libraryMeta);
    if (!v) return null;
    const leaveOut = new Set(v.leaveOut);
    return {
      introduction: v.introduction,
      privacyNotice: v.privacyNotice,
      closingMessage: v.closingMessage ?? null,
      questionsLeftOut: questions.filter((q) => q.key && leaveOut.has(q.key)).map((q) => q.questionText),
      alertsLeftOut: v.leaveOutAlerts.flatMap((i) => (meta.managerGuidance.alerts[i] ? [meta.managerGuidance.alerts[i].when] : [])),
    };
  }

  /**
   * The question bank: the questions of the ready-made library (catalogue surveys only — never an
   * organisation's own surveys, which may hold names or local wording), each once however many
   * ready-made surveys ask it, with the surveys it comes from. Filters: who it is for (the library
   * group), topic (the section heading), answer type; search over the question, its help text and its
   * answers. Paged. A "Show only if" rule is never part of a bank question (the question it depends
   * on is not in the survey it is copied into): `askedOnlyIf` only says that the original had one.
   */
  async questionBank(query: QuestionBankQuery = {}) {
    const [rows, organisationName] = await Promise.all([
      this.prisma.survey.findMany({ where: CATALOGUE_WHERE, orderBy: { libraryReference: 'asc' }, include: catalogueInclude }),
      this.organisationName(),
    ]);
    type BankQuestion = ReturnType<SurveyLibraryService['sectionsOf']>[number]['questions'][number];
    type Entry = {
      question: BankQuestion;
      topic: string | null;
      audience: string;
      sources: Array<{ surveyId: string; reference: string | null; title: string; group: string }>;
      audiences: Set<string>;
      topics: Set<string>;
    };
    const byKey = new Map<string, Entry>();
    for (const row of rows) {
      const meta = libraryMeta(row.libraryMeta);
      if (!meta) continue;
      const audience = bankAudienceOf(meta.group.short);
      for (const section of this.sectionsOf(row, meta)) {
        for (const q of section.questions) {
          // Identical = same wording, type, answers and answer settings (a score's range, the answers not
          // counted, Other, the clearing answers): questions that differ in any of these stay separate,
          // so the one copied is exactly what its sources ask.
          const key = [
            q.questionType,
            q.questionText.trim().toLocaleLowerCase('en-GB'),
            JSON.stringify(q.options ?? []),
            q.optionsFrom ?? '',
            JSON.stringify(q.config ?? null),
            JSON.stringify(q.otherOption ?? null),
            JSON.stringify([...q.exclusiveOptions].sort()),
          ].join('|');
          let entry = byKey.get(key);
          if (!entry) {
            entry = { question: q, topic: section.title, audience, sources: [], audiences: new Set(), topics: new Set() };
            byKey.set(key, entry);
          }
          entry.audiences.add(audience);
          if (section.title) entry.topics.add(section.title.trim());
          if (!entry.sources.some((s) => s.surveyId === row.id)) {
            entry.sources.push({ surveyId: row.id, reference: row.libraryReference, title: row.title, group: meta.group.name });
          }
        }
      }
    }

    const all = [...byKey.values()];
    const topics = [...new Set(all.flatMap((e) => [...e.topics]))].sort((a, b) => a.localeCompare(b, 'en-GB'));
    const search = query.search?.trim().toLocaleLowerCase('en-GB');
    const topic = query.topic?.trim().toLocaleLowerCase('en-GB');
    const types = query.type ? BANK_TYPE_GROUPS[query.type] : null;
    const matches = all.filter((e) => {
      const q = e.question;
      if (query.audience && !e.audiences.has(query.audience)) return false;
      if (topic && ![...e.topics].some((t) => t.toLocaleLowerCase('en-GB') === topic)) return false;
      if (types && !types.includes(q.questionType)) return false;
      if (search) {
        // As people read it: {{organisation}} filled in.
        const haystack = fillDeep(
          [q.questionText, q.helpText ?? '', ...(q.options ?? []), q.otherOption?.label ?? ''].join('\n'),
          organisationName,
        ).toLocaleLowerCase('en-GB');
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    const pageSize = Math.min(Math.max(query.pageSize ?? 30, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const items = matches.slice((page - 1) * pageSize, page * pageSize).map((e) => {
      const { showIf, key: _key, ...q } = e.question;
      return {
        ...q,
        /** The section it sits under in the ready-made survey: a section suggestion. */
        topic: e.topic,
        /**
         * "Would you like someone to contact you…", or one of its own contact-details questions (asked
         * only after a Yes to it — and, as its rule is not copied, otherwise always): not for anonymous
         * surveys, where nobody could be contacted and contact details would name the person.
         */
        contactRequest:
          isContactRequestQuestion(q) ||
          Boolean(showIf?.questionText && isContactRequestQuestion({ questionType: 'YES_NO', questionText: showIf.questionText })),
        /** The original is asked only after an answer to another question; that rule is not copied. */
        askedOnlyIf: showIf ? { questionText: showIf.questionText, answers: showIf.answers } : null,
        audiences: [...e.audiences],
        sources: e.sources,
      };
    });
    return {
      data: fillDeep({ items, total: matches.length, page, pageSize, topics }, organisationName),
    };
  }

  /**
   * Adopt ready-made surveys as the organisation's own company-wide templates (questions keep their
   * sections). One already adopted (a live template linked to it) is skipped and reported.
   */
  async adopt(user: RequestUser, ids: string[], meta?: RequestAuditMeta) {
    this.assertCompanyWide(
      user,
      'Ready-made surveys become shared company templates, so only someone with access to all branches can adopt them.',
    );
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException('Choose at least one survey');
    if (unique.length > MAX_ADOPT) throw new BadRequestException(`Adopt at most ${MAX_ADOPT} surveys at a time`);
    const rows = await this.prisma.survey.findMany({
      where: { id: { in: unique }, ...CATALOGUE_WHERE },
      include: catalogueInclude,
      orderBy: { libraryReference: 'asc' },
    });
    if (rows.length !== unique.length) throw new BadRequestException('Some surveys were not found in the library');

    const [alreadyAdopted, organisationName] = await Promise.all([
      this.adoptedTemplates(rows.map((r) => r.id)),
      this.organisationName(),
    ]);
    const created: Array<{ libraryId: string; templateId: string; reference: string; title: string }> = [];
    const skipped: Array<{
      libraryId: string;
      reference: string;
      title: string;
      reason: string;
      /** Already adopted: the organisation's template for it. */
      templateId?: string;
    }> = [];
    for (const row of rows) {
      const reference = row.libraryReference ?? '';
      const title = fillDeep(row.title, organisationName);
      if (!libraryMeta(row.libraryMeta)) {
        skipped.push({ libraryId: row.id, reference, title, reason: 'The survey has no library details' });
        continue;
      }
      const adoptedAlready = alreadyAdopted.get(row.id);
      if (adoptedAlready) {
        skipped.push({ libraryId: row.id, reference, title, reason: 'Already adopted', templateId: adoptedAlready.templateId });
        continue;
      }
      let template;
      try {
        template = await this.prisma.survey.create({
          data: {
            ...this.templateDetails(row, organisationName),
            status: SurveyStatus.DRAFT,
            isTemplate: true,
            isCatalogue: false,
            locationIds: [],
            roleIds: [],
            libraryReference: row.libraryReference,
            librarySourceId: row.id,
            createdById: user.id,
            updatedById: user.id,
            questions: { create: this.questionRows(row, organisationName) },
          },
        });
      } catch (e) {
        // Someone adopted it at the same moment: a ready-made survey has at most one live template
        // (unique index), so theirs is the organisation's template.
        const existing =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
            ? (await this.adoptedTemplates([row.id])).get(row.id)
            : undefined;
        if (!existing) throw e;
        skipped.push({ libraryId: row.id, reference, title, reason: 'Already adopted', templateId: existing.templateId });
        continue;
      }
      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_CREATED,
        recordType: 'Survey',
        recordId: template.id,
        newValues: auditSnapshot(template),
        metadata: { adoptedFromLibrary: reference, libraryRevision: row.libraryRevision, questionCount: row.questions.length },
        ...meta,
      });
      created.push({ libraryId: row.id, templateId: template.id, reference, title });
    }
    return {
      message: `${created.length} survey template${created.length === 1 ? '' : 's'} added`,
      data: { created, skipped },
    };
  }

  /** The ready-made survey a template was adopted from, and whether it has been updated since. */
  async forTemplate(user: RequestUser, surveyId: string) {
    const target = await this.prisma.survey.findFirst({
      where: { id: surveyId, isCatalogue: false, deletedAt: null },
      select: { librarySourceId: true, libraryRevision: true, locationIds: true, isTemplate: true, isAnonymous: true, libraryMeta: true },
    });
    if (!target?.librarySourceId || !target.isTemplate || !this.visible(user, target)) return { data: null };
    const library = await this.prisma.survey.findFirst({
      where: { id: target.librarySourceId, ...CATALOGUE_WHERE },
      select: { id: true, title: true, libraryReference: true, libraryRevision: true, libraryMeta: true },
    });
    const meta = libraryMeta(library?.libraryMeta);
    if (!library || !meta) return { data: null };
    const adoptedRevision = target.libraryRevision ?? 1;
    const currentRevision = library.libraryRevision ?? 1;
    const updateAvailable = adoptedRevision < currentRevision;
    const organisationName = await this.organisationName();
    // What applying it would do to this template's alert rules and section introductions.
    const plan = updateAvailable ? describePlan(await this.updatePlan(surveyId, library.id, organisationName)) : null;
    // New survey offers the anonymous version (the template's own details, else the current ready-made ones).
    const variantMeta = target.isAnonymous
      ? null
      : libraryAnonymousVariant(target.libraryMeta)
        ? target.libraryMeta
        : libraryAnonymousVariant(library.libraryMeta)
          ? library.libraryMeta
          : null;
    const anonymousVariant = variantMeta
      ? fillDeep(
          this.variantSummary(
            variantMeta,
            (await this.prisma.surveyQuestion.findMany({
              where: { surveyId, deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: { key: true, questionText: true },
            })) ?? [],
            meta,
          ),
          organisationName,
        )
      : null;
    return {
      data: {
        ...fillDeep(
          {
            libraryId: library.id,
            reference: library.libraryReference,
            title: library.title,
            adoptedRevision,
            currentRevision,
            revisionNote: meta.revisionNote,
            updateAvailable,
          },
          organisationName,
        ),
        plan,
        anonymousVariant,
      },
    };
  }

  /**
   * Bring an adopted template up to the latest ready-made revision: its details and questions are
   * replaced. Templates are never sent or answered, and surveys already started from the template
   * keep their own copy of the questions, so nothing anyone answered changes.
   */
  async applyUpdate(user: RequestUser, surveyId: string, meta?: RequestAuditMeta) {
    const target = await this.prisma.survey.findFirst({ where: { id: surveyId, isCatalogue: false, deletedAt: null } });
    if (!target || !this.visible(user, target)) throw new NotFoundException('Survey not found');
    if (!target.isTemplate || !target.librarySourceId) {
      throw new NotFoundException('This template was not adopted from the ready-made surveys');
    }
    if (target.locationIds.length === 0) {
      this.assertCompanyWide(
        user,
        'This is a shared company template, so only someone with access to all branches can update it.',
      );
    }
    const library = await this.prisma.survey.findFirst({
      where: { id: target.librarySourceId, ...CATALOGUE_WHERE },
      include: catalogueInclude,
    });
    if (!library || !libraryMeta(library.libraryMeta)) {
      throw new NotFoundException('The ready-made survey is no longer available');
    }
    const revision = library.libraryRevision ?? 1;
    if (revision <= (target.libraryRevision ?? 1)) {
      throw new BadRequestException('This template is already based on the latest ready-made version');
    }
    const [recipients, responses] = await Promise.all([
      this.prisma.surveyRecipient.count({ where: { surveyId } }),
      this.prisma.surveyResponse.count({ where: { surveyId } }),
    ]);
    if (recipients > 0 || responses > 0) {
      throw new BadRequestException('This survey has been sent or answered, so its questions cannot be replaced.');
    }

    const organisationName = await this.organisationName();
    const plan = await this.updatePlan(surveyId, library.id, organisationName);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.surveyQuestion.updateMany({
        where: { surveyId, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      });
      const saved = await tx.survey.update({
        where: { id: surveyId },
        data: {
          ...this.templateDetails(library, organisationName),
          // The template's own section introductions stay where their section is still there.
          sectionIntros: plan.sectionIntros ?? Prisma.JsonNull,
          updatedById: user.id,
          questions: { create: this.questionRows(library, organisationName) },
        },
      });
      await this.applyRulePlan(tx, surveyId, plan, user.id);
      return saved;
    });
    const summary = describePlan(plan);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.SURVEY,
      action: AuditAction.SURVEY_UPDATED,
      recordType: 'Survey',
      recordId: surveyId,
      oldValues: auditSnapshot(target),
      newValues: auditSnapshot(updated),
      metadata: { libraryUpdate: { reference: library.libraryReference, from: target.libraryRevision, to: revision, ...summary } },
      ...meta,
    });
    const off = summary.turnedOff.length;
    return {
      message:
        `The template now has ready-made revision ${revision}.` +
        (off ? ` ${off} alert rule${off === 1 ? ' was' : 's were'} turned off because they can no longer work as set: check the alert rules.` : ''),
      data: { surveyId, revision, ...summary },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * What bringing the template up to the ready-made survey's current revision does to its alert
   * rules and its own section introductions (survey-library-update.util.ts).
   */
  private async updatePlan(surveyId: string, libraryId: string, organisationName: string): Promise<LibraryUpdatePlan> {
    const [target, library, oldRows, rules] = await Promise.all([
      this.prisma.survey.findUniqueOrThrow({
        where: { id: surveyId },
        select: { isAnonymous: true, libraryMeta: true, libraryRevision: true, alertRulesSetUpAt: true, sectionIntros: true },
      }),
      this.prisma.survey.findUniqueOrThrow({ where: { id: libraryId }, include: catalogueInclude }),
      this.prisma.surveyQuestion.findMany({ where: { surveyId, deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.surveyAlertRule.findMany({ where: { surveyId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const newDetails = this.templateDetails(library, organisationName);
    const oldQuestions = await this.alertQuestions(oldRows, target.isAnonymous);
    const newQuestions = await this.alertQuestions(
      library.questions.map((q) => fillDeep({ ...q, id: `new-${q.id}` }, organisationName)),
      newDetails.isAnonymous,
    );
    const newMeta = fillDeep(library.libraryMeta, organisationName);
    return planLibraryUpdate({
      rulesSetUp: Boolean(target.alertRulesSetUpAt),
      rules,
      oldLibraryRows: libraryRuleRows(target.libraryMeta, oldQuestions, { anonymous: target.isAnonymous }),
      newLibraryRows: libraryRuleRows(newMeta, newQuestions, { anonymous: newDetails.isAnonymous }),
      newQuestions,
      oldQuestions,
      changes: readKeyChanges(newMeta),
      fromRevision: target.libraryRevision ?? 1,
      toRevision: library.libraryRevision ?? 1,
      sectionIntros: target.sectionIntros,
      newSectionTitles: [...new Set(library.questions.flatMap((q) => (q.sectionTitle ? [fillDeep(q.sectionTitle, organisationName)] : [])))],
      fill: (text) => fillDeep(text, organisationName),
    });
  }

  /** Questions as alert rules read them (CareFlow lists filled in; blocked on anonymous surveys). */
  private async alertQuestions(
    rows: Array<{
      id: string;
      key: string | null;
      questionText: string;
      questionType: AlertQuestion['questionType'];
      options: unknown;
      config: unknown;
      otherOption: unknown;
      optionsFrom: string | null;
    }>,
    anonymous: boolean,
  ): Promise<AlertQuestion[]> {
    const plain = rows.map((q) => ({
      id: q.id,
      key: q.key,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options,
      config: q.config,
      otherOption: q.otherOption,
      optionsFrom: q.optionsFrom,
    }));
    if (!plain.some((q) => q.optionsFrom)) return plain;
    if (anonymous) return plain.map((q) => (q.optionsFrom ? { ...q, options: null, lookupBlocked: true } : q));
    return withLookupOptions(this.prisma, plain, { includeRetired: true });
  }

  /** Carries out the alert-rule part of an update plan (inside the update's transaction). */
  private async applyRulePlan(tx: Prisma.TransactionClient, surveyId: string, plan: LibraryUpdatePlan, userId: string) {
    let position = ((await tx.surveyAlertRule.aggregate({ where: { surveyId }, _max: { position: true } }))._max.position ?? -1) + 1;
    for (const step of plan.rules) {
      if (step.kind === 'refresh') {
        const { key: _key, position: _position, conditions, ...row } = step.row;
        await tx.surveyAlertRule.update({
          where: { id: step.ruleId },
          data: { ...row, conditions: conditions as unknown as Prisma.InputJsonValue, roleId: null, isActive: true, updatedById: userId },
        });
      } else if (step.kind === 'remove') {
        // Alerts already raised keep their task and history (ruleId is set to null).
        await tx.surveyAlertRule.delete({ where: { id: step.ruleId } });
      } else if (step.kind === 'map') {
        await tx.surveyAlertRule.update({
          where: { id: step.ruleId },
          data: { conditions: step.conditions as unknown as Prisma.InputJsonValue, updatedById: userId },
        });
      } else if (step.kind === 'turnOff') {
        await tx.surveyAlertRule.update({ where: { id: step.ruleId }, data: { isActive: false, updatedById: userId } });
      } else if (step.kind === 'add') {
        const { conditions, position: _p, ...row } = step.row;
        await tx.surveyAlertRule.create({
          data: { ...row, surveyId, position: position++, conditions: conditions as unknown as Prisma.InputJsonValue, createdById: userId, updatedById: userId },
        });
      }
    }
  }

  private assertCompanyWide(user: RequestUser, message: string) {
    if (this.orgScope.fromRequestUser(user).locationIds !== null) throw new ForbiddenException(message);
  }

  /** Same rule as the survey list: branch-restricted users see company templates and their own branches. */
  private visible(user: RequestUser, survey: { locationIds: string[]; isTemplate: boolean }) {
    const scope = this.orgScope.fromRequestUser(user);
    if (scope.locationIds === null) return true;
    if (survey.locationIds.length === 0) return survey.isTemplate;
    const allowed = new Set(scope.locationIds);
    return survey.locationIds.every((id) => allowed.has(id));
  }

  /** The details an adopted template takes from the ready-made survey (organisation name filled in). */
  private templateDetails(row: CatalogueSurvey, organisationName: string) {
    return {
      title: fillDeep(row.title, organisationName),
      description: row.description === null ? null : fillDeep(row.description, organisationName),
      // What people see after submitting, as the ready-made survey says it.
      closingMessage: row.closingMessage === null ? null : fillDeep(row.closingMessage, organisationName),
      targetKind: row.targetKind,
      isAnonymous: row.isAnonymous,
      // The ready-made privacy notice says whether people may answer without their name.
      allowAnonymousResponses: storedAllowAnonymousResponses(row.isAnonymous, row.allowAnonymousResponses),
      libraryRevision: row.libraryRevision ?? 1,
      libraryMeta: fillDeep(row.libraryMeta, organisationName) as Prisma.InputJsonValue,
      // Who it's for, as the ready-made survey says.
      audienceGroup: row.audienceGroup ?? null,
      // Section introductions come from the library (libraryMeta.sections); the survey's own start empty.
      sectionIntros: Prisma.JsonNull,
    };
  }

  private questionRows(row: CatalogueSurvey, organisationName: string) {
    return row.questions.map((q) => ({
      questionText: fillDeep(q.questionText, organisationName),
      helpText: q.helpText === null ? null : fillDeep(q.helpText, organisationName),
      questionType: q.questionType,
      options: q.options === null ? Prisma.JsonNull : (fillDeep(q.options, organisationName) as Prisma.InputJsonValue),
      // Options from a CareFlow list (e.g. the organisation's ethnicity list).
      optionsFrom: q.optionsFrom ?? null,
      // A rating's bounds, or the answers not counted in percentages (filled like the options).
      config: q.config === null ? Prisma.JsonNull : (fillDeep(q.config, organisationName) as Prisma.InputJsonValue),
      isRequired: q.isRequired,
      sortOrder: q.sortOrder,
      sectionTitle: q.sectionTitle === null ? null : fillDeep(q.sectionTitle, organisationName),
      // Keys are kept, so "Show only if" rules keep pointing at the same questions. Labels are
      // filled like the options they match.
      key: q.key,
      otherOption: jsonOrNull(fillDeep(q.otherOption, organisationName)),
      exclusiveOptions: jsonOrNull(fillDeep(q.exclusiveOptions, organisationName)),
      commentConfig: jsonOrNull(fillDeep(q.commentConfig, organisationName)),
      showIf: jsonOrNull(fillDeep(q.showIf, organisationName)),
    }));
  }

  private summaryOf(row: CatalogueSurvey, meta: LibraryMeta, adopted: Map<string, AdoptedTemplate>) {
    const copy = adopted.get(row.id);
    const revision = row.libraryRevision ?? 1;
    return {
      id: row.id,
      reference: row.libraryReference,
      title: row.title,
      summary: meta.summary,
      group: { code: meta.group.code, short: meta.group.short, name: meta.group.name, displayOrder: meta.group.displayOrder },
      researchedOn: meta.group.researchedOn,
      audience: row.targetKind,
      respondents: meta.respondents,
      anonymous: row.isAnonymous,
      /** Named survey: people may choose to answer without their name. */
      allowAnonymousResponses: storedAllowAnonymousResponses(row.isAnonymous, row.allowAnonymousResponses),
      estimatedMinutes: meta.estimatedMinutes,
      questionCount: row.questions.length,
      sectionCount: meta.sections.length,
      cqc: meta.cqc,
      timing: meta.timing,
      channels: meta.channels,
      revision,
      revisionNote: meta.revisionNote,
      adoptedTemplateId: copy?.templateId ?? null,
      adoptedRevision: copy ? (copy.libraryRevision ?? 1) : null,
      updateAvailable: Boolean(copy && (copy.libraryRevision ?? 1) < revision),
      /** A named survey that also offers an anonymous version (chosen at New survey). */
      hasAnonymousVersion: !row.isAnonymous && Boolean(libraryAnonymousVariant(row.libraryMeta)),
    };
  }

  /** Questions grouped by section, in order, with the section's evidence. */
  private sectionsOf(row: CatalogueSurvey, meta: LibraryMeta) {
    const sections: Array<{
      title: string | null;
      evidence: string[];
      /** One or two sentences shown under the heading to people answering. */
      introduction: string | null;
      questions: Array<{
        id: string;
        questionText: string;
        helpText: string | null;
        questionType: string;
        options: string[] | null;
        /** Options from a CareFlow list (ETHNICITY …) instead of `options`. */
        optionsFrom: string | null;
        config: Record<string, unknown> | null;
        /** Answers left out of percentages ("Don't know"). */
        notCountedOptions: string[];
        isRequired: boolean;
        key: string | null;
        otherOption: OtherOptionSettings | null;
        /** MULTI_SELECT: answers that cannot be combined with any other ("None of these"). */
        exclusiveOptions: string[];
        commentConfig: CommentSettings | null;
        /** Asked only if the earlier question (its text given) has one of these answers. */
        showIf: (ShowIfSettings & { questionText: string | null }) | null;
      }>;
    }> = [];
    const textByKey = new Map(row.questions.filter((q) => q.key).map((q) => [q.key!, q.questionText]));
    for (const q of row.questions) {
      let current = sections[sections.length - 1];
      if (!current || current.title !== (q.sectionTitle ?? null)) {
        current = {
          title: q.sectionTitle ?? null,
          evidence: meta.sections.find((s) => s.title === q.sectionTitle)?.evidence ?? [],
          introduction: meta.sections.find((s) => s.title === q.sectionTitle)?.introduction ?? null,
          questions: [],
        };
        sections.push(current);
      }
      current.questions.push({
        id: q.id,
        questionText: q.questionText,
        helpText: q.helpText,
        questionType: q.questionType,
        options: Array.isArray(q.options) ? (q.options as string[]) : null,
        optionsFrom: q.optionsFrom ?? null,
        config: q.config && typeof q.config === 'object' && !Array.isArray(q.config) ? (q.config as Record<string, unknown>) : null,
        notCountedOptions: readNotCountedOptions(q.config),
        isRequired: q.isRequired,
        key: q.key,
        otherOption: readOtherOption(q.otherOption),
        exclusiveOptions: readExclusiveOptions(q.exclusiveOptions),
        commentConfig: readCommentConfig(q.commentConfig),

        showIf: showIfWithText(readShowIf(q.showIf), textByKey),
      });

    }
    return sections;
  }

  /** Titles of related policies, from the ready-made policies (catalogue documents LIB-POL-…). */
  private async policyTitles(references: string[]): Promise<Map<string, string>> {
    if (!references.length) return new Map();
    const docs = await this.prisma.policyDocument.findMany({
      where: { isCatalogue: true, deletedAt: null, reference: { in: references.map((r) => `LIB-${r}`) } },
      select: { reference: true, title: true },
    });
    return new Map(docs.map((d) => [d.reference.replace(/^LIB-/, ''), d.title]));
  }

  private async organisationName(): Promise<string> {
    const profile = await this.prisma.companyProfile.findFirst({ select: { companyName: true } });
    return profile?.companyName?.trim() || 'the organisation';
  }

  /** Catalogue survey id → the organisation's live template adopted from it. */
  private async adoptedTemplates(catalogueIds: string[]): Promise<Map<string, AdoptedTemplate>> {
    if (!catalogueIds.length) return new Map();
    const rows = await this.prisma.survey.findMany({
      where: { librarySourceId: { in: catalogueIds }, isCatalogue: false, isTemplate: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, librarySourceId: true, libraryRevision: true },
    });
    const map = new Map<string, AdoptedTemplate>();
    for (const r of rows) {
      if (!map.has(r.librarySourceId!)) map.set(r.librarySourceId!, { templateId: r.id, libraryRevision: r.libraryRevision });
    }
    return map;
  }
}
