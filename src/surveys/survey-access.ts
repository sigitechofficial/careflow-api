import { Prisma, type PrismaClient } from '@prisma/client';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { IDENTITY_ROLE } from '../common/org-scope/org-scope.types';
import {
  MAX_REPORTING_THRESHOLD,
  MIN_REPORTING_THRESHOLD_UNLINKED,
} from '../../prisma/seed-lib/survey-library';
import { SURVEY_ALERT_OWNERS, SURVEY_ALERT_OWNER_KEYS, roleForOwner } from './survey-alert-rules.util';
import { effectiveLibraryMeta } from './survey-library-variant.util';
import { surveyVisibleInScope } from './survey-scope.util';

export { MAX_REPORTING_THRESHOLD, MIN_REPORTING_THRESHOLD_UNLINKED };

/**
 * Per-survey access.
 *
 * Two levels, each open (everyone with survey access) or restricted to named roles and people:
 *  - responses: individual responses and written answers (Results → Individual responses, written
 *    answers in the question figures, the people named in follow-ups);
 *  - results: the figures (question summaries, breakdowns, CSV, CQC evidence made from them).
 * Seeing individual responses always includes the figures. Super Admin and Admin, and the person
 * who made the survey, always keep access (they are the ones who set it, so nobody is locked out);
 * every change is audited. A ready-made survey can declare a default (library `access`), used until
 * the organisation saves its own. A repeating survey's periods follow the repeating survey.
 *
 * Reporting threshold: no question figures, breakdowns or exports until this many responses are in
 * the figures (written out: answers still held back in the anonymity batches do not count). Default
 * 5 when answers can be given without a name (anonymous surveys, "answer without my name"), never
 * lower there; otherwise off unless set. Applies on top of the existing small-group rules.
 */

export type AccessLevelSpec = { restricted: boolean; ownerKeys: string[]; roleIds: string[]; userIds: string[] };
/**
 * `excludeUserIds`: people who never see this survey's answers or figures whatever their role (the
 * manager a "Feedback on your manager" copy rates). Admins keep access (they set it), so a rated
 * manager who is an admin is warned about when the copies are made.
 */
export type SurveyAccessPolicy = { responses: AccessLevelSpec; results: AccessLevelSpec; excludeUserIds?: string[] };
export type AccessSource = 'survey' | 'ready-made' | 'open';

const OPEN: AccessLevelSpec = { restricted: false, ownerKeys: [], roleIds: [], userIds: [] };
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readLevel(v: unknown): AccessLevelSpec {
  if (!isObject(v)) return { ...OPEN };
  return {
    restricted: v.restricted === true,
    ownerKeys: strings(v.ownerKeys).filter((k) => (SURVEY_ALERT_OWNER_KEYS as string[]).includes(k)),
    roleIds: strings(v.roleIds),
    userIds: strings(v.userIds),
  };
}

export function readAccessPolicy(v: unknown): SurveyAccessPolicy | null {
  if (!isObject(v)) return null;
  const excludeUserIds = strings(v.excludeUserIds);
  return { responses: readLevel(v.responses), results: readLevel(v.results), ...(excludeUserIds.length ? { excludeUserIds } : {}) };
}

/** A policy with people who must never see the answers added (kept whatever else changes). */
export function withExcludedUsers(policy: SurveyAccessPolicy | null, userIds: readonly string[]): SurveyAccessPolicy | null {
  const all = [...new Set([...(policy?.excludeUserIds ?? []), ...userIds])];
  if (!all.length) return policy;
  return { ...(policy ?? { responses: { ...OPEN }, results: { ...OPEN } }), excludeUserIds: all };
}

/** A ready-made survey's default access (libraryMeta.access). */
export function libraryAccess(libraryMeta: unknown): { policy: SurveyAccessPolicy | null; threshold: number | null } {
  const a = isObject(libraryMeta) && isObject(libraryMeta.access) ? libraryMeta.access : null;
  if (!a) return { policy: null, threshold: null };
  const responses = strings(a.responses);
  const results = strings(a.results);
  const policy =
    responses.length || results.length
      ? {
          responses: responses.length ? { restricted: true, ownerKeys: responses, roleIds: [], userIds: [] } : { ...OPEN },
          // Whoever sees individual answers sees the figures too.
          results: results.length
            ? { restricted: true, ownerKeys: [...new Set([...results, ...responses])], roleIds: [], userIds: [] }
            : { ...OPEN },
        }
      : null;
  const t = a.reportingThreshold;
  return { policy, threshold: Number.isInteger(t) ? (t as number) : null };
}

/** The lowest threshold a survey may have: 5 when answers can be given without a name. */
export function minimumThreshold(survey: { isAnonymous: boolean; allowAnonymousResponses: boolean }): number {
  return survey.isAnonymous || survey.allowAnonymousResponses ? MIN_REPORTING_THRESHOLD_UNLINKED : 1;
}

/** The threshold in force: the survey's own, else the ready-made default, else 5 / none. */
export function effectiveThreshold(
  survey: { isAnonymous: boolean; allowAnonymousResponses: boolean; reportingThreshold: number | null },
  libraryThreshold: number | null,
): number {
  const min = minimumThreshold(survey);
  const chosen = survey.reportingThreshold ?? libraryThreshold;
  if (chosen == null) return min > 1 ? min : 0;
  return Math.min(MAX_REPORTING_THRESHOLD, Math.max(min, chosen));
}

/** "3 more answers are needed before results show" (null when there are enough). */
export function thresholdNote(threshold: number, counted: number): string | null {
  if (threshold <= 0 || counted >= threshold) return null;
  const more = threshold - counted;
  return `${more} more ${more === 1 ? 'answer is' : 'answers are'} needed before results show. To protect the people who answer, figures appear once at least ${threshold} answers are in.`;
}

type Db = Prisma.TransactionClient | PrismaClient;

export type SurveyForAccess = {
  id: string;
  clonedFromId: string | null;
  createdById: string | null;
  isAnonymous: boolean;
  allowAnonymousResponses: boolean;
  libraryReference: string | null;
  libraryMeta: Prisma.JsonValue;
  accessPolicy: Prisma.JsonValue;
  reportingThreshold: number | null;
};

export type SurveyAccess = {
  policy: SurveyAccessPolicy;
  source: AccessSource;
  /** May see the figures. */
  results: boolean;
  /** May see individual responses and written answers. */
  responses: boolean;
  /** May change who has access (Super Admin, Admin, or whoever made the survey). */
  configure: boolean;
  threshold: number;
  libraryThreshold: number | null;
  ownSurveyId: string;
};

export const isAdminActor = (actor: Pick<RequestUser, 'roles'>) =>
  (actor.roles ?? []).some((r) => r === IDENTITY_ROLE.SUPER_ADMIN || r === IDENTITY_ROLE.ADMIN);

async function actorRoleIds(db: Db, actor: Pick<RequestUser, 'roles'>): Promise<string[]> {
  if (!actor.roles?.length) return [];
  const rows = await db.role.findMany({ where: { name: { in: actor.roles }, deletedAt: null }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function ownerRoleIds(db: Db, ownerKeys: string[]): Promise<string[]> {
  if (!ownerKeys.length) return [];
  const [roles, settings] = await Promise.all([
    db.role.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } }),
    db.surveyAlertOwnerRole.findMany({ where: { ownerKey: { in: ownerKeys } } }),
  ]);
  const set = new Map(settings.map((s) => [s.ownerKey, s.roleId]));
  return ownerKeys.map((k) => set.get(k) ?? roleForOwner(k, roles)?.id).filter((x): x is string => !!x);
}

/** The roles (by id) a level names, its owner roles resolved through the organisation's setting. */
export async function levelRoleIds(db: Db, level: AccessLevelSpec): Promise<string[]> {
  return [...new Set([...level.roleIds, ...(await ownerRoleIds(db, level.ownerKeys))])];
}

async function loadOwner(db: Db, survey: SurveyForAccess): Promise<SurveyForAccess> {
  if (!survey.clonedFromId) return survey;
  const src = await db.survey.findUnique({
    where: { id: survey.clonedFromId },
    select: { id: true, clonedFromId: true, createdById: true, isAnonymous: true, allowAnonymousResponses: true, libraryReference: true, libraryMeta: true, accessPolicy: true, reportingThreshold: true },
  });
  return src ?? survey;
}

async function libraryMetaOf(db: Db, survey: SurveyForAccess): Promise<Prisma.JsonValue> {
  if (!survey.libraryReference) return effectiveLibraryMeta(survey.libraryMeta, survey.isAnonymous);
  const cat = await db.survey.findFirst({
    where: { isCatalogue: true, libraryReference: survey.libraryReference, deletedAt: null },
    select: { libraryMeta: true },
  });
  // The anonymous version of a ready-made survey has its own default access.
  return effectiveLibraryMeta(cat?.libraryMeta ?? survey.libraryMeta, survey.isAnonymous);
}

/** What `actor` may see of `survey` (and its threshold). Branch scope is checked separately. */
export async function surveyAccessFor(db: Db, actor: RequestUser, survey: SurveyForAccess): Promise<SurveyAccess> {
  const owner = await loadOwner(db, survey);
  const lib = libraryAccess(await libraryMetaOf(db, owner));
  const stored = readAccessPolicy(owner.accessPolicy);
  const policy = stored ?? lib.policy ?? { responses: { ...OPEN }, results: { ...OPEN } };
  const source: AccessSource = stored ? 'survey' : lib.policy ? 'ready-made' : 'open';
  const threshold = effectiveThreshold(owner, lib.threshold);
  // Someone this survey is about (the manager a copy rates) never sees it, even as its maker.
  if (!isAdminActor(actor) && policy.excludeUserIds?.includes(actor.id)) {
    return { policy, source, results: false, responses: false, configure: false, threshold, libraryThreshold: lib.threshold, ownSurveyId: owner.id };
  }
  const configure = isAdminActor(actor) || (Boolean(owner.createdById) && owner.createdById === actor.id);
  if (configure) {
    return { policy, source, results: true, responses: true, configure, threshold, libraryThreshold: lib.threshold, ownSurveyId: owner.id };
  }
  const mine = await actorRoleIds(db, actor);
  const allowed = async (level: AccessLevelSpec) =>
    !level.restricted || level.userIds.includes(actor.id) || (await levelRoleIds(db, level)).some((id) => mine.includes(id));
  const responses = await allowed(policy.responses);
  const results = responses || (await allowed(policy.results));
  return { policy, source, results, responses, configure, threshold, libraryThreshold: lib.threshold, ownSurveyId: owner.id };
}

/**
 * For system work (alert routing, task titles): the survey's policy, and when its results are
 * restricted the roles allowed to see them (null = open). Admins and the maker are always allowed.
 */
export async function surveyResultsAudience(
  db: Db,
  survey: SurveyForAccess,
): Promise<{ restricted: boolean; roleIds: Set<string> | null; userIds: string[]; createdById: string | null; excludedUserIds: string[] }> {
  const owner = await loadOwner(db, survey);
  const policy = readAccessPolicy(owner.accessPolicy) ?? libraryAccess(await libraryMetaOf(db, owner)).policy;
  const excludedUserIds = policy?.excludeUserIds ?? [];
  const restricted = Boolean(policy && (policy.results.restricted || policy.responses.restricted || excludedUserIds.length));
  if (!policy || !policy.results.restricted) return { restricted, roleIds: null, userIds: [], createdById: owner.createdById, excludedUserIds };
  const roleIds = new Set([...(await levelRoleIds(db, policy.results)), ...(await levelRoleIds(db, policy.responses))]);
  return { restricted, roleIds, userIds: [...policy.results.userIds, ...policy.responses.userIds], createdById: owner.createdById, excludedUserIds };
}

/** The ready-made default access for a survey (or its repeating survey), or null. */
export async function surveyDefaultAccessPolicy(db: Db, survey: SurveyForAccess): Promise<SurveyAccessPolicy | null> {
  return libraryAccess(await libraryMetaOf(db, await loadOwner(db, survey))).policy;
}

/** The reporting threshold in force for a survey (or period), for system work such as CQC capture. */
export async function surveyThreshold(db: Db, survey: SurveyForAccess): Promise<number> {
  const owner = await loadOwner(db, survey);
  return effectiveThreshold(owner, libraryAccess(await libraryMetaOf(db, owner)).threshold);
}

export const ACCESS_SELECT = {
  id: true,
  clonedFromId: true,
  createdById: true,
  isAnonymous: true,
  allowAnonymousResponses: true,
  libraryReference: true,
  libraryMeta: true,
  accessPolicy: true,
  reportingThreshold: true,
} satisfies Prisma.SurveySelect;

/** Survey ids (with their periods) whose results `actor` may not see — for lists such as CQC evidence. */
export async function surveysWithoutResultsAccess(db: Db, actor: RequestUser, surveyIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!surveyIds.length || isAdminActor(actor)) return out;
  const rows = await db.survey.findMany({ where: { id: { in: [...new Set(surveyIds)] } }, select: ACCESS_SELECT });
  for (const s of rows) {
    // Open surveys with no ready-made default need no lookups.
    if (!s.accessPolicy && !s.libraryReference && !s.clonedFromId) continue;
    const a = await surveyAccessFor(db, actor, s);
    if (!a.results) out.add(s.id);
  }
  return out;
}

/**
 * Surveys whose audit entries `actor` may not see. Survey audit entries show when things happened
 * to a survey (sends, reminders, answers counted per day, downloads), so they are shown only to
 * people with results access to that survey, in its branches: null = every survey (Super Admin,
 * Admin); 'all' = none (no survey access at all, e.g. an inspector with audit access only).
 * Deleted surveys (and repeating surveys' periods) are included; library surveys are not.
 */
export async function surveysHiddenFromAudit(db: Db, actor: RequestUser): Promise<Set<string> | 'all' | null> {
  if (isAdminActor(actor)) return null;
  const perms = actor.permissions ?? [];
  if (!perms.includes('surveys.read') && !perms.includes('surveys.manage')) return 'all';
  const rows = await db.survey.findMany({ where: { isCatalogue: false }, select: { ...ACCESS_SELECT, locationIds: true, isTemplate: true } });
  const scope = { locationIds: actor.assignedLocationIds ?? null };
  const hidden = new Set<string>();
  const inScope: string[] = [];
  for (const s of rows) {
    if (surveyVisibleInScope(scope, s)) inScope.push(s.id);
    else hidden.add(s.id);
  }
  for (const id of await surveysWithoutResultsAccess(db, actor, inScope)) hidden.add(id);
  return hidden;
}

/** Who a level lets in, in words (owner roles named as the organisation's role). */
export async function describeLevel(db: Db, level: AccessLevelSpec) {
  const roleIds = await levelRoleIds(db, level);
  const [roles, users] = await Promise.all([
    roleIds.length ? db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } }) : [],
    level.userIds.length ? db.user.findMany({ where: { id: { in: level.userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
  ]);
  return {
    restricted: level.restricted,
    ownerKeys: level.ownerKeys.map((k) => ({ key: k, label: SURVEY_ALERT_OWNERS[k as keyof typeof SURVEY_ALERT_OWNERS]?.label ?? k })),
    roles,
    people: users.map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email })),
  };
}

/** The message when someone may not see results / responses. */
export const RESULTS_RESTRICTED = 'The results of this survey are limited to particular people. Ask the survey owner or an admin if you need them.';
export const RESPONSES_RESTRICTED = 'Individual responses to this survey are limited to particular people. You can see the overall figures.';
