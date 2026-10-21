import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PolicyAcknowledgementStatus, PolicyStatus } from '@prisma/client';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import {
  applicabilityMatches,
  audienceMatches,
  type PolicyApplicabilityRow,
  type PolicyAudienceRow,
  type PolicyMatchContext,
} from './policy-targeting';
import { formatVersionLabel } from './policy-status';

/** A member of staff who can be asked to read policies (active employee with a sign-in). */
type StaffMember = {
  userId: string;
  employeeId: string;
  name: string;
  ctx: PolicyMatchContext;
};

type RequiredVersion = {
  id: string;
  documentId: string;
  versionMajor: number;
  versionMinor: number;
  titleSnapshot: string;
  publishedAt: Date | null;
  reviewDate: Date | null;
  applicability: PolicyApplicabilityRow[];
  audiences: PolicyAudienceRow[];
  document: { id: string; reference: string; title: string; documentType: string; primaryCategory: { name: string } | null };
};

const DONE = PolicyAcknowledgementStatus.ACKNOWLEDGED;

/**
 * Policy read-and-acknowledge ("read and sign"), as in Access Policies & Procedures:
 * when a policy version that requires acknowledgement is published, everyone in its
 * audience must confirm they have read and understood that version. A new version
 * needs a fresh acknowledgement.
 *
 * Who must read a version is worked out from the same applicability + audience rules
 * that decide who can see it (policy-targeting.ts), evaluated per member of staff.
 */
@Injectable()
export class PolicyAcknowledgementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /* ── Audience resolution ─────────────────────────────────────────────── */

  /** Active staff with a sign-in, each with the context the targeting rules need. */
  private async staff(): Promise<StaffMember[]> {
    const employees = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true, email: true } },
        employment: {
          select: {
            jobTitleId: true,
            workAreaId: true,
            locationId: true,
            baseLocationId: true,
            floorLocations: { select: { locationId: true } },
          },
        },
      },
    });
    const emails = employees
      .map((e) => e.personalDetail?.email?.trim().toLowerCase())
      .filter((e): e is string => !!e);
    if (!emails.length) return [];
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true, email: { in: emails, mode: 'insensitive' } },
      select: { id: true, email: true, userRoles: { select: { roleId: true } } },
    });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

    const out: StaffMember[] = [];
    for (const e of employees) {
      const email = e.personalDetail?.email?.trim().toLowerCase();
      const user = email ? byEmail.get(email) : undefined;
      if (!user) continue;
      const emp = e.employment;
      const locations = [
        emp?.locationId,
        emp?.baseLocationId,
        ...(emp?.floorLocations ?? []).map((f) => f.locationId),
      ].filter((id): id is string => !!id);
      out.push({
        userId: user.id,
        employeeId: e.id,
        name: [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ') || user.email,
        ctx: {
          // Staff with no branch on their employment are treated as organisation-wide.
          assignedLocationIds: locations.length ? [...new Set(locations)] : null,
          roleIds: user.userRoles.map((r) => r.roleId),
          jobTitleId: emp?.jobTitleId ?? null,
          workAreaId: emp?.workAreaId ?? null,
          serviceTypeCode: null,
          locationId: null,
        },
      });
    }
    return out;
  }

  /** Published policies whose current version requires acknowledgement. */
  private async requiredVersions(documentId?: string): Promise<RequiredVersion[]> {
    const docs = await this.prisma.policyDocument.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        status: PolicyStatus.PUBLISHED,
        currentVersionId: { not: null },
        ...(documentId ? { id: documentId } : {}),
      },
      select: { currentVersionId: true },
    });
    const ids = docs.map((d) => d.currentVersionId).filter((id): id is string => !!id);
    if (!ids.length) return [];
    const versions = await this.prisma.policyVersion.findMany({
      where: { id: { in: ids }, status: PolicyStatus.PUBLISHED, acknowledgementRequired: true },
      select: {
        id: true,
        documentId: true,
        versionMajor: true,
        versionMinor: true,
        titleSnapshot: true,
        publishedAt: true,
        reviewDate: true,
        applicability: { select: { organisationWide: true, locationId: true, serviceTypeCode: true } },
        audiences: { select: { targetType: true, roleId: true, jobTitleId: true, workAreaId: true, locationId: true } },
        document: {
          select: {
            id: true,
            reference: true,
            title: true,
            documentType: true,
            primaryCategory: { select: { name: true } },
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
    });
    return versions as unknown as RequiredVersion[];
  }

  private appliesTo(version: RequiredVersion, ctx: PolicyMatchContext): boolean {
    return applicabilityMatches(version.applicability, ctx) && audienceMatches(version.audiences, ctx);
  }

  private versionSummary(v: RequiredVersion) {
    return {
      documentId: v.documentId,
      versionId: v.id,
      reference: v.document.reference,
      title: v.document.title || v.titleSnapshot,
      documentType: v.document.documentType,
      category: v.document.primaryCategory?.name ?? null,
      versionLabel: formatVersionLabel(v.versionMajor, v.versionMinor),
      publishedAt: v.publishedAt?.toISOString() ?? null,
      reviewDate: v.reviewDate ? v.reviewDate.toISOString().slice(0, 10) : null,
    };
  }

  /* ── Staff: what I need to read ──────────────────────────────────────── */

  async mine(user: RequestUser) {
    const me = (await this.staff()).find((s) => s.userId === user.id);
    const ctx: PolicyMatchContext = me?.ctx ?? {
      assignedLocationIds: user.assignedLocationIds ?? null,
      roleIds: (
        await this.prisma.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } })
      ).map((r) => r.roleId),
      jobTitleId: null,
      workAreaId: null,
      serviceTypeCode: null,
      locationId: null,
    };
    const versions = (await this.requiredVersions()).filter((v) => this.appliesTo(v, ctx));
    const acks = versions.length
      ? await this.prisma.policyAcknowledgement.findMany({
          where: { userId: user.id, versionId: { in: versions.map((v) => v.id) } },
          select: { versionId: true, status: true, viewedAt: true, acknowledgedAt: true },
        })
      : [];
    const byVersion = new Map(acks.map((a) => [a.versionId, a]));
    const items = versions.map((v) => {
      const a = byVersion.get(v.id);
      return {
        ...this.versionSummary(v),
        status: a?.status ?? PolicyAcknowledgementStatus.PENDING,
        viewedAt: a?.viewedAt?.toISOString() ?? null,
        acknowledgedAt: a?.acknowledgedAt?.toISOString() ?? null,
      };
    });
    items.sort((x, y) => Number(x.status === DONE) - Number(y.status === DONE));
    return {
      data: {
        total: items.length,
        outstanding: items.filter((i) => i.status !== DONE).length,
        items,
      },
    };
  }

  private async assertRequiredFor(user: RequestUser, versionId: string): Promise<RequiredVersion> {
    const version = await this.prisma.policyVersion.findUnique({
      where: { id: versionId },
      select: { documentId: true },
    });
    if (!version) throw new NotFoundException('Policy version not found');
    const [current] = await this.requiredVersions(version.documentId);
    if (!current || current.id !== versionId) {
      throw new BadRequestException('Only the current published version of a policy that needs acknowledgement can be acknowledged');
    }
    const me = (await this.staff()).find((s) => s.userId === user.id);
    if (me && !this.appliesTo(current, me.ctx)) {
      throw new BadRequestException('This policy is not assigned to you');
    }
    return current;
  }

  async markViewed(user: RequestUser, versionId: string) {
    await this.assertRequiredFor(user, versionId);
    const now = new Date();
    const existing = await this.prisma.policyAcknowledgement.findUnique({
      where: { versionId_userId: { versionId, userId: user.id } },
    });
    if (existing?.status === DONE || existing?.viewedAt) return { data: { status: existing.status } };
    const row = await this.prisma.policyAcknowledgement.upsert({
      where: { versionId_userId: { versionId, userId: user.id } },
      create: { versionId, userId: user.id, status: PolicyAcknowledgementStatus.VIEWED, viewedAt: now },
      update: { status: PolicyAcknowledgementStatus.VIEWED, viewedAt: now },
    });
    return { data: { status: row.status } };
  }

  async acknowledge(user: RequestUser, versionId: string, meta?: { ipAddress?: string | null; userAgent?: string | null }) {
    const version = await this.assertRequiredFor(user, versionId);
    const now = new Date();
    const existing = await this.prisma.policyAcknowledgement.findUnique({
      where: { versionId_userId: { versionId, userId: user.id } },
    });
    if (existing?.status === DONE) {
      return { data: { status: existing.status, acknowledgedAt: existing.acknowledgedAt?.toISOString() ?? null } };
    }
    const evidence = {
      versionLabel: formatVersionLabel(version.versionMajor, version.versionMinor),
      statement: 'I have read and understood this policy.',
      ipAddress: meta?.ipAddress ?? null,
      userAgent: meta?.userAgent ?? null,
    };
    const row = await this.prisma.policyAcknowledgement.upsert({
      where: { versionId_userId: { versionId, userId: user.id } },
      create: {
        versionId,
        userId: user.id,
        status: DONE,
        viewedAt: now,
        acknowledgedAt: now,
        metadata: evidence,
      },
      update: {
        status: DONE,
        viewedAt: existing?.viewedAt ?? now,
        acknowledgedAt: now,
        metadata: evidence,
      },
    });
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_acknowledged',
      recordType: 'PolicyVersion',
      recordId: versionId,
      newValues: { documentId: version.documentId, ...evidence },
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    return { data: { status: row.status, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null } };
  }

  /* ── Managers: who has read what ─────────────────────────────────────── */

  /** Staff who must read one policy's current version, with their status. */
  async forDocument(documentId: string) {
    const [version] = await this.requiredVersions(documentId);
    if (!version) {
      return { data: { required: false, total: 0, acknowledged: 0, viewed: 0, pending: 0, staff: [] as unknown[] } };
    }
    const audience = (await this.staff()).filter((s) => this.appliesTo(version, s.ctx));
    const acks = await this.prisma.policyAcknowledgement.findMany({
      where: { versionId: version.id, userId: { in: audience.map((s) => s.userId) } },
      select: { userId: true, status: true, viewedAt: true, acknowledgedAt: true },
    });
    const byUser = new Map(acks.map((a) => [a.userId, a]));
    const staff = audience
      .map((s) => {
        const a = byUser.get(s.userId);
        return {
          employeeId: s.employeeId,
          userId: s.userId,
          name: s.name,
          status: a?.status ?? PolicyAcknowledgementStatus.PENDING,
          viewedAt: a?.viewedAt?.toISOString() ?? null,
          acknowledgedAt: a?.acknowledgedAt?.toISOString() ?? null,
        };
      })
      .sort((x, y) => Number(x.status === DONE) - Number(y.status === DONE) || x.name.localeCompare(y.name));
    const acknowledged = staff.filter((s) => s.status === DONE).length;
    return {
      data: {
        required: true,
        ...this.versionSummary(version),
        total: staff.length,
        acknowledged,
        viewed: staff.filter((s) => s.status === PolicyAcknowledgementStatus.VIEWED).length,
        pending: staff.length - acknowledged,
        staff,
      },
    };
  }

  /** Organisation-wide read-and-sign compliance, per policy and per member of staff. */
  async summary() {
    const [versions, staff] = await Promise.all([this.requiredVersions(), this.staff()]);
    const acks = versions.length
      ? await this.prisma.policyAcknowledgement.findMany({
          where: { versionId: { in: versions.map((v) => v.id) }, status: DONE },
          select: { versionId: true, userId: true },
        })
      : [];
    const done = new Set(acks.map((a) => `${a.versionId}:${a.userId}`));
    const outstandingByStaff = new Map<string, { name: string; employeeId: string; outstanding: number }>();
    let required = 0;
    let acknowledged = 0;
    const policies = versions.map((v) => {
      const audience = staff.filter((s) => this.appliesTo(v, s.ctx));
      let signed = 0;
      for (const s of audience) {
        if (done.has(`${v.id}:${s.userId}`)) signed += 1;
        else {
          const row = outstandingByStaff.get(s.userId) ?? { name: s.name, employeeId: s.employeeId, outstanding: 0 };
          row.outstanding += 1;
          outstandingByStaff.set(s.userId, row);
        }
      }
      required += audience.length;
      acknowledged += signed;
      return {
        ...this.versionSummary(v),
        audience: audience.length,
        acknowledged: signed,
        pct: audience.length ? Math.round((signed / audience.length) * 100) : null,
      };
    });
    policies.sort((x, y) => (x.pct ?? 101) - (y.pct ?? 101));
    const staffOutstanding = [...outstandingByStaff.values()].sort((x, y) => y.outstanding - x.outstanding);
    return {
      data: {
        policiesRequiringAcknowledgement: versions.length,
        staffInScope: staff.length,
        required,
        acknowledged,
        pct: required ? Math.round((acknowledged / required) * 100) : null,
        staffWithOutstanding: staffOutstanding.length,
        policies,
        staffOutstanding: staffOutstanding.slice(0, 50),
      },
    };
  }
}
