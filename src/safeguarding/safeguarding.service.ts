import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  Prisma,
  SafeguardingReferralDecision,
  SafeguardingRisk,
  SafeguardingStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService, andWhereFragment } from '../common/org-scope/org-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateSafeguardingDto } from './dto/create-safeguarding.dto';
import { UpdateSafeguardingDto } from './dto/update-safeguarding.dto';
import { TransitionSafeguardingDto } from './dto/transition-safeguarding.dto';
import { SafeguardingNoteDto } from './dto/note-safeguarding.dto';
import { ListSafeguardingQueryDto } from './dto/list-safeguarding-query.dto';
import {
  nextSafeguardingStatus,
  safeguardingActionLabel,
} from './safeguarding-workflow.util';

type Tx = Prisma.TransactionClient;
type EventRow = Prisma.SafeguardingEventGetPayload<object>;
type CaseRow = Prisma.SafeguardingCaseGetPayload<{ include: { events: true } }>;
type PlainRow = Prisma.SafeguardingCaseGetPayload<object>;
type NameMaps = {
  users: Map<string, string | null>;
  serviceUsers: Map<string, string | null>;
  locations: Map<string, string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function fullName(p: { firstName?: string | null; lastName?: string | null }): string | null {
  const n = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return n || null;
}

export type SafeguardingCheck = { key: string; label: string; ok: boolean | null };

/**
 * What CQC looks for in a safeguarding record, checked from the case itself.
 * `ok: null` means the check does not apply to this case.
 */
export function safeguardingChecks(row: PlainRow, now = new Date()): SafeguardingCheck[] {
  const closed = row.status === SafeguardingStatus.CLOSED;
  const laMade = row.laReferral === SafeguardingReferralDecision.MADE;
  const cqcMade = row.cqcNotified === SafeguardingReferralDecision.MADE;
  return [
    {
      key: 'logged',
      label: 'Logged with the person, date, category and who raised it',
      ok: !!((row.aboutServiceUserId || row.personDescription) && row.raisedAt && row.category && row.raisedByRole),
    },
    { key: 'laDecision', label: 'Local Authority referral decision recorded', ok: row.laReferral !== SafeguardingReferralDecision.PENDING },
    {
      key: 'laPrompt',
      label: 'Referral made promptly (same or next day)',
      ok: laMade ? !!row.laReferredAt && dayStart(row.laReferredAt) - dayStart(row.raisedAt) <= DAY_MS : null,
    },
    { key: 'laRef', label: 'LA reference number recorded', ok: laMade ? !!row.laReference : null },
    { key: 'cqcDecision', label: 'CQC notification decision recorded', ok: row.cqcNotified !== SafeguardingReferralDecision.PENDING },
    { key: 'cqcRef', label: 'CQC reference number recorded', ok: cqcMade ? !!row.cqcReference : null },
    { key: 'lead', label: 'Case lead allocated', ok: !!row.leadUserId },
    { key: 'safety', label: 'Immediate safety recorded', ok: !!(row.personSafe && (row.safetyMeasures || row.immediateAction)) },
    { key: 'voice', label: 'Voice of the person recorded (wishes and capacity)', ok: !!(row.personWants && row.capacity) },
    {
      key: 'review',
      label: 'Review date set and not passed',
      ok: closed ? null : !!row.reviewDate && dayStart(row.reviewDate) >= dayStart(now),
    },
    { key: 'closure', label: 'Closure outcome and lessons learned recorded', ok: closed ? !!(row.outcome && row.lessonsLearned) : null },
  ];
}

export function checkScore(checks: SafeguardingCheck[]) {
  const applicable = checks.filter(c => c.ok !== null);
  const passed = applicable.filter(c => c.ok).length;
  return { passed, of: applicable.length, pct: applicable.length ? Math.round((passed / applicable.length) * 100) : null };
}

export type SafeguardingAlert = { text: string; tone: 'bad' | 'warn' };

/** What needs attention on a case now (shown on the list and the case). */
export function safeguardingAlerts(row: PlainRow, now = new Date()): SafeguardingAlert[] {
  const out: SafeguardingAlert[] = [];
  if (row.status === SafeguardingStatus.CLOSED) {
    if (!row.lessonsLearned) out.push({ text: 'Closed without lessons learned', tone: 'warn' });
    return out;
  }
  if (row.laReferral === SafeguardingReferralDecision.PENDING) {
    out.push({ text: 'Local Authority referral decision pending', tone: 'bad' });
  }
  if (row.cqcNotified === SafeguardingReferralDecision.PENDING) {
    out.push({ text: 'CQC notification decision pending', tone: 'bad' });
  }
  if (!row.leadUserId) out.push({ text: 'No case lead allocated', tone: 'warn' });
  if (!row.reviewDate) out.push({ text: 'No review date set', tone: 'warn' });
  else if (dayStart(row.reviewDate) < dayStart(now)) out.push({ text: 'Review date has passed', tone: 'warn' });
  return out;
}

function mapEvent(row: EventRow, names: NameMaps) {
  return {
    id: row.id,
    action: row.action,
    note: row.note,
    userId: row.userId,
    userName: row.userId ? names.users.get(row.userId) ?? null : null,
    at: row.at.toISOString(),
  };
}

function mapCase(row: CaseRow | PlainRow, names: NameMaps) {
  const events = 'events' in row && Array.isArray(row.events) ? row.events : [];
  const checks = safeguardingChecks(row);
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    status: row.status,
    category: row.category,
    riskLevel: row.riskLevel,
    aboutServiceUserId: row.aboutServiceUserId,
    serviceUserName: row.aboutServiceUserId ? names.serviceUsers.get(row.aboutServiceUserId) ?? null : null,
    personDescription: row.personDescription,
    locationId: row.locationId,
    locationName: row.locationId ? names.locations.get(row.locationId) ?? null : null,
    handlerEmployeeId: row.handlerEmployeeId,
    leadUserId: row.leadUserId,
    leadName: row.leadUserId ? names.users.get(row.leadUserId) ?? null : null,
    raisedByRole: row.raisedByRole,
    raisedAt: row.raisedAt.toISOString(),
    description: row.description,
    immediateAction: row.immediateAction,
    laReferral: row.laReferral,
    laReference: row.laReference,
    laReferredAt: row.laReferredAt?.toISOString() ?? null,
    cqcNotified: row.cqcNotified,
    cqcReference: row.cqcReference,
    outcome: row.outcome,
    lessonsLearned: row.lessonsLearned,
    closedAt: row.closedAt?.toISOString() ?? null,
    reviewDate: row.reviewDate?.toISOString() ?? null,
    reviewOverdue:
      row.status !== SafeguardingStatus.CLOSED && !!row.reviewDate && dayStart(row.reviewDate) < dayStart(new Date()),
    reportedToManagerAt: row.reportedToManagerAt?.toISOString() ?? null,
    personSafe: row.personSafe,
    safetyMeasures: row.safetyMeasures,
    personWords: row.personWords,
    evidence: row.evidence,
    personWants: row.personWants,
    capacity: row.capacity,
    agencies: row.agencies,
    agenciesOther: row.agenciesOther,
    meetingHeld: row.meetingHeld,
    meetingDate: row.meetingDate?.toISOString() ?? null,
    protectionPlan: row.protectionPlan,
    checks,
    checkScore: checkScore(checks),
    alerts: safeguardingAlerts(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events: [...events]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map(e => mapEvent(e, names)),
  };
}

/** Plain-text fields copied as-is from the DTO (empty string clears). */
const TEXT_FIELDS = [
  'personDescription',
  'raisedByRole',
  'immediateAction',
  'laReference',
  'cqcReference',
  'outcome',
  'lessonsLearned',
  'personSafe',
  'safetyMeasures',
  'personWords',
  'evidence',
  'personWants',
  'capacity',
  'agenciesOther',
  'meetingHeld',
  'protectionPlan',
] as const;

/** Which timeline label a changed field belongs to. */
const FIELD_GROUP: Record<string, string> = {
  category: 'Concern',
  description: 'Concern',
  personDescription: 'Concern',
  raisedByRole: 'Concern',
  aboutServiceUserId: 'Concern',
  immediateAction: 'Immediate safety',
  reportedToManagerAt: 'Immediate safety',
  personSafe: 'Immediate safety',
  safetyMeasures: 'Immediate safety',
  riskLevel: 'Risk & referrals',
  laReferral: 'Risk & referrals',
  laReference: 'Risk & referrals',
  laReferredAt: 'Risk & referrals',
  cqcNotified: 'Risk & referrals',
  cqcReference: 'Risk & referrals',
  agencies: 'Multi-agency',
  agenciesOther: 'Multi-agency',
  meetingHeld: 'Multi-agency',
  meetingDate: 'Multi-agency',
  protectionPlan: 'Multi-agency',
  personWords: 'Voice of the person',
  evidence: 'Voice of the person',
  personWants: 'Voice of the person',
  capacity: 'Voice of the person',
  outcome: 'Outcome',
  lessonsLearned: 'Outcome',
  locationId: 'Branch',
};

@Injectable()
export class SafeguardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  /* ─── helpers ───────────────────────────────────────────────────────── */

  private parseDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  /**
   * Cases the actor may see: their branches' cases plus any they recorded themselves
   * (so a concern raised without a branch is never lost to its author). Company-wide users see all,
   * optionally narrowed by the header branch.
   */
  private scopeWhere(actor: RequestUser, requestedLocationId?: string): Prisma.SafeguardingCaseWhereInput {
    const scope = this.orgScope.fromRequestUser(actor);
    const ids = this.orgScope.resolveListLocationIds(scope, requestedLocationId);
    const where: Prisma.SafeguardingCaseWhereInput = { deletedAt: null };
    if (!ids) return where;
    if (scope.locationIds === null) {
      andWhereFragment(where, { locationId: { in: ids } });
      return where;
    }
    andWhereFragment(where, {
      OR: [...(ids.length ? [{ locationId: { in: ids } }] : []), { recordedById: actor.id }],
    });
    return where;
  }

  private async getInScope(actor: RequestUser, id: string, tx: Tx = this.prisma) {
    const row = await tx.safeguardingCase.findFirst({ where: { ...this.scopeWhere(actor), id } });
    if (!row) throw new NotFoundException('Safeguarding case not found');
    return row;
  }

  /** The service user must be in the actor's scope; returns their branch. */
  private async serviceUserBranch(actor: RequestUser, serviceUserId: string): Promise<string | null> {
    const su = await this.prisma.serviceUser.findFirst({
      where: { id: serviceUserId, deletedAt: null },
      select: { id: true, locationId: true },
    });
    if (!su) throw new NotFoundException('Service user not found');
    await this.orgScope.assertServiceUserInScope(this.orgScope.fromRequestUser(actor), serviceUserId);
    return su.locationId;
  }

  /** Validate a requested branch; default to the actor's only branch when none is given. */
  private resolveLocationId(actor: RequestUser, requested: string | null | undefined): string | null | undefined {
    const scope = this.orgScope.fromRequestUser(actor);
    if (requested) {
      this.orgScope.assertLocationAccess(scope, requested);
      return requested;
    }
    if (requested === undefined && scope.locationIds?.length === 1) return scope.locationIds[0];
    return requested;
  }

  private async assertLead(leadUserId: string | null | undefined) {
    if (!leadUserId) return;
    const u = await this.prisma.user.findFirst({ where: { id: leadUserId, deletedAt: null }, select: { id: true } });
    if (!u) throw new BadRequestException('Case lead not found');
  }

  private async nameMaps(rows: Array<CaseRow | PlainRow>): Promise<NameMaps> {
    const userIds = new Set<string>();
    const suIds = new Set<string>();
    const locIds = new Set<string>();
    for (const r of rows) {
      if (r.leadUserId) userIds.add(r.leadUserId);
      if (r.aboutServiceUserId) suIds.add(r.aboutServiceUserId);
      if (r.locationId) locIds.add(r.locationId);
      if ('events' in r && Array.isArray(r.events)) r.events.forEach(e => e.userId && userIds.add(e.userId));
    }
    const [users, sus, locs] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, firstName: true, lastName: true } })
        : [],
      suIds.size
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: [...suIds] } },
            select: { id: true, firstName: true, lastName: true, preferredName: true },
          })
        : [],
      locIds.size ? this.prisma.location.findMany({ where: { id: { in: [...locIds] } }, select: { id: true, name: true } }) : [],
    ]);
    return {
      users: new Map((users ?? []).map(u => [u.id, fullName(u)])),
      serviceUsers: new Map(
        (sus ?? []).map(s => [s.id, fullName({ firstName: s.preferredName || s.firstName, lastName: s.lastName })]),
      ),
      locations: new Map((locs ?? []).map(l => [l.id, l.name])),
    };
  }

  private async present(rows: Array<CaseRow | PlainRow>) {
    const names = await this.nameMaps(rows);
    return rows.map(r => mapCase(r, names));
  }

  private async presentOne(row: CaseRow | PlainRow) {
    const [data] = await this.present([row]);
    return data;
  }

  /* ─── reads ─────────────────────────────────────────────────────────── */

  async list(actor: RequestUser, query: ListSafeguardingQueryDto) {
    const where = this.scopeWhere(actor, query.locationId);
    andWhereFragment(where, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
      ...(query.aboutServiceUserId ? { aboutServiceUserId: query.aboutServiceUserId } : {}),
    });
    const search = query.search?.trim();
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      andWhereFragment(where, {
        OR: [
          { referenceNumber: contains },
          { personDescription: contains },
          { description: contains },
          { laReference: contains },
        ],
      });
    }
    const rows = await this.prisma.safeguardingCase.findMany({ where, orderBy: { createdAt: 'desc' } });
    return { data: await this.present(rows) };
  }

  /** Counts, attention list and records-audit score for the list page and dashboards. */
  async summary(actor: RequestUser, locationId?: string) {
    const rows = await this.prisma.safeguardingCase.findMany({
      where: this.scopeWhere(actor, locationId),
      orderBy: { raisedAt: 'desc' },
    });
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const byStatus: Record<string, number> = {};
    const byRisk: Record<string, number> = {};
    let open = 0;
    let highRisk = 0;
    let laPending = 0;
    let cqcPending = 0;
    let reviewsOverdue = 0;
    let noLead = 0;
    let newThisMonth = 0;
    let passed = 0;
    let of = 0;
    const alerts: Array<SafeguardingAlert & { caseId: string; referenceNumber: string }> = [];

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      byRisk[r.riskLevel] = (byRisk[r.riskLevel] ?? 0) + 1;
      if (r.raisedAt >= monthStart) newThisMonth++;
      const score = checkScore(safeguardingChecks(r, now));
      passed += score.passed;
      of += score.of;
      for (const a of safeguardingAlerts(r, now)) alerts.push({ ...a, caseId: r.id, referenceNumber: r.referenceNumber });
      if (r.status === SafeguardingStatus.CLOSED) continue;
      open++;
      if (r.riskLevel === SafeguardingRisk.HIGH) highRisk++;
      if (r.laReferral === SafeguardingReferralDecision.PENDING) laPending++;
      if (r.cqcNotified === SafeguardingReferralDecision.PENDING) cqcPending++;
      if (!r.leadUserId) noLead++;
      if (r.reviewDate && dayStart(r.reviewDate) < dayStart(now)) reviewsOverdue++;
    }
    alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));

    return {
      data: {
        total: rows.length,
        open,
        byStatus,
        byRisk,
        highRisk,
        laPending,
        cqcPending,
        reviewsOverdue,
        noLead,
        newThisMonth,
        auditPct: of ? Math.round((passed / of) * 100) : null,
        alerts,
      },
    };
  }

  async getById(actor: RequestUser, id: string) {
    const row = await this.prisma.safeguardingCase.findFirst({
      where: { ...this.scopeWhere(actor), id },
      include: { events: true },
    });
    if (!row) throw new NotFoundException('Safeguarding case not found');
    return { data: await this.presentOne(row) };
  }

  /** Office users who can lead a case (same pool as CRM owners). */
  async leads() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, userRoles: { some: {} } },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return { data: users.map(u => ({ id: u.id, name: fullName(u) || u.email })) };
  }

  /* ─── writes ────────────────────────────────────────────────────────── */

  async create(actor: RequestUser, dto: CreateSafeguardingDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const suBranch = dto.aboutServiceUserId ? await this.serviceUserBranch(actor, dto.aboutServiceUserId) : undefined;
    const locationId = dto.locationId
      ? this.resolveLocationId(actor, dto.locationId)
      : suBranch ?? this.resolveLocationId(actor, undefined) ?? null;
    await this.assertLead(dto.leadUserId);
    const raisedAt = this.parseDate(dto.raisedAt) ?? new Date();

    return this.prisma.$transaction(async tx => {
      const year = new Date().getFullYear();
      const seq = await tx.safeguardingNumberSequence.upsert({
        where: { year },
        create: { year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const referenceNumber = `SG-${year}-${String(seq.lastValue).padStart(4, '0')}`;

      const created = await tx.safeguardingCase.create({
        data: {
          referenceNumber,
          category: dto.category,
          riskLevel: dto.riskLevel ?? 'MEDIUM',
          aboutServiceUserId: dto.aboutServiceUserId ?? null,
          personDescription: dto.personDescription ?? null,
          locationId: locationId ?? null,
          handlerEmployeeId: dto.handlerEmployeeId ?? null,
          leadUserId: dto.leadUserId ?? null,
          raisedByRole: dto.raisedByRole ?? null,
          raisedAt,
          description: dto.description,
          immediateAction: dto.immediateAction ?? null,
          reviewDate: this.parseDate(dto.reviewDate) ?? null,
          laReferral: dto.laReferral ?? SafeguardingReferralDecision.PENDING,
          cqcNotified: dto.cqcNotified ?? SafeguardingReferralDecision.PENDING,
          recordedById: userId,
          events: { create: { action: 'Concern raised', userId } },
        },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_RAISED,
        eventType: AuditEventType.CREATE,
        recordType: 'SafeguardingCase',
        recordId: created.id,
        description: `Safeguarding concern ${referenceNumber} raised`,
        newValues: auditSnapshot({ referenceNumber, category: created.category, riskLevel: created.riskLevel }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Safeguarding concern raised', data: await this.presentOne(created) };
    });
  }

  async update(actor: RequestUser, id: string, dto: UpdateSafeguardingDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    const before = await this.getInScope(actor, id);
    const suBranch = dto.aboutServiceUserId ? await this.serviceUserBranch(actor, dto.aboutServiceUserId) : undefined;
    const locationId =
      dto.locationId === undefined ? undefined : this.resolveLocationId(actor, dto.locationId ?? null);
    if (dto.leadUserId !== undefined) await this.assertLead(dto.leadUserId);

    const data: Prisma.SafeguardingCaseUpdateInput = {};
    const changed = new Set<string>();
    const set = (key: string, value: unknown) => {
      (data as Record<string, unknown>)[key] = value;
      if (FIELD_GROUP[key]) changed.add(FIELD_GROUP[key]);
    };

    if (dto.category !== undefined) set('category', dto.category);
    if (dto.riskLevel !== undefined) set('riskLevel', dto.riskLevel);
    if (dto.description !== undefined) {
      if (!dto.description.trim()) throw new BadRequestException('A description is required');
      set('description', dto.description);
    }
    if (dto.laReferral !== undefined) set('laReferral', dto.laReferral);
    if (dto.cqcNotified !== undefined) set('cqcNotified', dto.cqcNotified);
    if (dto.handlerEmployeeId !== undefined) set('handlerEmployeeId', dto.handlerEmployeeId ?? null);
    for (const key of TEXT_FIELDS) {
      const v = (dto as Record<string, unknown>)[key];
      if (v !== undefined) set(key, typeof v === 'string' ? v.trim() || null : null);
    }
    if (dto.agencies !== undefined) {
      set('agencies', [...new Set(dto.agencies.map(a => a.trim()).filter(Boolean))]);
    }
    for (const key of ['laReferredAt', 'reportedToManagerAt', 'meetingDate'] as const) {
      const d = this.parseDate((dto as Record<string, string | null | undefined>)[key]);
      if (d !== undefined) set(key, d);
    }
    if (dto.aboutServiceUserId !== undefined) {
      set('aboutServiceUserId', dto.aboutServiceUserId ?? null);
      if (suBranch && locationId === undefined && !before.locationId) set('locationId', suBranch);
    }
    if (locationId !== undefined) set('locationId', locationId);

    const events: Prisma.SafeguardingEventCreateWithoutCaseInput[] = [];
    if (dto.leadUserId !== undefined && (dto.leadUserId ?? null) !== before.leadUserId) {
      data.leadUserId = dto.leadUserId ?? null;
      const lead = dto.leadUserId
        ? await this.prisma.user.findFirst({ where: { id: dto.leadUserId }, select: { firstName: true, lastName: true } })
        : null;
      events.push({ action: lead ? `Case lead: ${fullName(lead) ?? 'assigned'}` : 'Case lead removed', userId });
    }
    const reviewDate = this.parseDate(dto.reviewDate);
    if (reviewDate !== undefined && reviewDate?.getTime() !== before.reviewDate?.getTime()) {
      data.reviewDate = reviewDate;
      events.push({
        action: reviewDate ? `Review date set: ${reviewDate.toISOString().slice(0, 10)}` : 'Review date cleared',
        userId,
      });
    }
    if (changed.size) events.push({ action: 'Details updated', note: [...changed].join(', '), userId });

    return this.prisma.$transaction(async tx => {
      const updated = await tx.safeguardingCase.update({
        where: { id },
        data: { ...data, ...(events.length ? { events: { create: events } } : {}) },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_UPDATED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SafeguardingCase',
        recordId: id,
        description: `Safeguarding concern ${updated.referenceNumber} updated`,
        metadata: { sections: [...changed] },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Safeguarding concern updated', data: await this.presentOne(updated) };
    });
  }

  async transition(actor: RequestUser, id: string, dto: TransitionSafeguardingDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      const nextStatus = nextSafeguardingStatus(before.status, dto.action);
      if (!nextStatus) {
        throw new BadRequestException(`Cannot ${dto.action} a case that is ${before.status}`);
      }

      const data: Prisma.SafeguardingCaseUpdateInput = { status: nextStatus };

      if (dto.action === 'REFER') {
        data.laReferral = SafeguardingReferralDecision.MADE;
        if (!before.laReferredAt) data.laReferredAt = new Date();
      }

      if (dto.action === 'CLOSE') {
        const outcome = dto.outcome ?? before.outcome;
        if (!outcome) throw new BadRequestException('An outcome is required to close a case');
        if (
          before.laReferral === SafeguardingReferralDecision.PENDING ||
          before.cqcNotified === SafeguardingReferralDecision.PENDING
        ) {
          throw new BadRequestException(
            'Record the Local Authority and CQC referral decisions before closing',
          );
        }
        // An investigation that was started must be completed before the case closes.
        const investigation = await tx.safeguardingInvestigation.findUnique({
          where: { caseId: id },
          select: { investigationStatus: true },
        });
        if (investigation && investigation.investigationStatus !== 'COMPLETED') {
          throw new BadRequestException('Complete the investigation before closing the case');
        }
        data.outcome = outcome;
        if (dto.lessonsLearned !== undefined) data.lessonsLearned = dto.lessonsLearned;
        data.closedAt = new Date();
      }

      const label = safeguardingActionLabel(dto.action);
      const updated = await tx.safeguardingCase.update({
        where: { id },
        data: {
          ...data,
          events: { create: { action: label, note: dto.note ?? null, userId } },
        },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_STATUS_CHANGED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SafeguardingCase',
        recordId: id,
        description: `Safeguarding concern ${updated.referenceNumber}: ${label}`,
        oldValues: auditSnapshot({ status: before.status }),
        newValues: auditSnapshot({ status: updated.status }),
        metadata: { action: dto.action },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: `Case ${label.toLowerCase()}`, data: await this.presentOne(updated) };
    });
  }

  async addNote(actor: RequestUser, id: string, dto: SafeguardingNoteDto, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const existing = await this.getInScope(actor, id, tx);

      await tx.safeguardingEvent.create({
        data: { caseId: id, action: 'Note', note: dto.note, userId },
      });
      const updated = await tx.safeguardingCase.findFirstOrThrow({
        where: { id },
        include: { events: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_NOTE_ADDED,
        eventType: AuditEventType.UPDATE,
        recordType: 'SafeguardingCase',
        recordId: id,
        description: `Note added to safeguarding concern ${existing.referenceNumber}`,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Note added', data: await this.presentOne(updated) };
    });
  }

  async remove(actor: RequestUser, id: string, meta?: RequestAuditMeta) {
    const userId = actor.id;
    return this.prisma.$transaction(async tx => {
      const before = await this.getInScope(actor, id, tx);

      await tx.safeguardingCase.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SAFEGUARDING,
        action: AuditAction.SAFEGUARDING_DELETED,
        eventType: AuditEventType.DELETE,
        recordType: 'SafeguardingCase',
        recordId: id,
        description: `Safeguarding concern ${before.referenceNumber} deleted`,
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Safeguarding concern deleted', data: { id } };
    });
  }
}
