import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CqcNotification,
  CqcNotificationPolicySource,
  CqcNotificationStatus,
  PolicyStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { applicabilityMatches } from '../policies/policy-targeting';
import { CqcNotificationsService } from './cqc-notifications.service';
import {
  catalogueReference,
  policiesForCqcForm,
  suggestedPolicyRefs,
  versionLabel,
} from './cqc-notification-policies.util';

/** An organisation policy as offered or shown on a notification. */
export type PolicyOption = {
  policyDocumentId: string;
  reference: string;
  title: string;
  version: string | null;
  reviewDate: string | null;
  reviewOverdue: boolean;
};

type OwnPolicy = PolicyOption & {
  libraryDocumentId: string | null;
  versionId: string | null;
};

const OPEN: CqcNotificationStatus[] = [
  CqcNotificationStatus.DRAFT,
  CqcNotificationStatus.READY,
];

/**
 * Governance → CQC notifications → supporting policies. Staff attach the organisation's published
 * policies that cover what happened, so the notification can say "we have this policy for it".
 * Suggestions come from the notification type (cqc-notification-policies.util.ts) and only offer
 * published policies that apply to the notification's branch.
 */
@Injectable()
export class CqcNotificationPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: CqcNotificationsService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Attached, suggested, and suggested-but-not-adopted policies for one notification. */
  async overview(user: RequestUser, id: string) {
    const n = await this.notifications.requireVisible(user, id);
    const attached = await this.attached(n);
    const attachedIds = new Set(attached.map((a) => a.policyDocumentId));
    const refs = suggestedPolicyRefs(n.type, n.details);
    const catalogue = await this.prisma.policyDocument.findMany({
      where: {
        isCatalogue: true,
        deletedAt: null,
        reference: { in: refs.map(catalogueReference) },
      },
      select: { id: true, reference: true, title: true },
    });
    const own = await this.ownPolicies(n.locationId, {
      libraryDocumentId: { in: catalogue.map((c) => c.id) },
    });
    // Copies adopted but not published yet (they cannot be attached).
    const drafts = await this.prisma.policyDocument.findMany({
      where: {
        isCatalogue: false,
        deletedAt: null,
        status: { not: PolicyStatus.PUBLISHED },
        libraryDocumentId: { in: catalogue.map((c) => c.id) },
      },
      select: { libraryDocumentId: true, status: true },
    });
    const suggested: PolicyOption[] = [];
    const notAdopted: Array<{
      libraryReference: string;
      title: string;
      adoptedStatus: PolicyStatus | null;
    }> = [];
    for (const ref of refs) {
      const cat = catalogue.find(
        (c) => c.reference === catalogueReference(ref),
      );
      if (!cat) continue;
      const mine = own.filter((p) => p.libraryDocumentId === cat.id);
      if (mine.length) {
        for (const p of mine)
          if (!attachedIds.has(p.policyDocumentId))
            suggested.push(this.option(p));
        continue;
      }
      notAdopted.push({
        libraryReference: ref,
        title: cat.title,
        adoptedStatus:
          drafts.find((d) => d.libraryDocumentId === cat.id)?.status ?? null,
      });
    }
    return {
      data: {
        editable: OPEN.includes(n.status),
        attached,
        suggested,
        notAdopted,
        cqcFormText: policiesForCqcForm(attached),
      },
    };
  }

  /** Published policies that apply to the notification's branch, by title or reference. */
  async search(user: RequestUser, id: string, q?: string) {
    const n = await this.notifications.requireVisible(user, id);
    const text = q?.trim();
    const own = await this.ownPolicies(
      n.locationId,
      text
        ? {
            OR: [
              { title: { contains: text, mode: 'insensitive' } },
              { reference: { contains: text, mode: 'insensitive' } },
            ],
          }
        : {},
      30,
    );
    const attached = new Set(
      (
        await this.prisma.cqcNotificationPolicy.findMany({
          where: { notificationId: n.id },
          select: { policyDocumentId: true },
        })
      ).map((a) => a.policyDocumentId),
    );
    return {
      data: own
        .filter((p) => !attached.has(p.policyDocumentId))
        .map((p) => this.option(p)),
    };
  }

  async add(
    user: RequestUser,
    id: string,
    policyDocumentId: string,
    source: CqcNotificationPolicySource,
    meta?: RequestAuditMeta,
  ) {
    const n = await this.requireEditable(user, id);
    const [policy] = await this.ownPolicies(n.locationId, {
      id: policyDocumentId,
    });
    if (!policy)
      throw new BadRequestException(
        'Only published policies that apply to this branch can be attached',
      );
    try {
      await this.prisma.cqcNotificationPolicy.create({
        data: {
          notificationId: n.id,
          policyDocumentId: policy.policyDocumentId,
          policyVersionId: policy.versionId,
          referenceSnapshot: policy.reference,
          titleSnapshot: policy.title,
          versionLabel: policy.version,
          source,
          addedById: user.id,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('This policy is already attached');
      throw e;
    }
    await this.log(
      user,
      AuditAction.CQC_NOTIFICATION_POLICY_ADDED,
      n.id,
      `Policy attached: ${policy.reference} ${policy.title}`,
      meta,
    );
    return this.overview(user, id);
  }

  async remove(
    user: RequestUser,
    id: string,
    policyDocumentId: string,
    meta?: RequestAuditMeta,
  ) {
    const n = await this.requireEditable(user, id);
    const row = await this.prisma.cqcNotificationPolicy.findUnique({
      where: {
        notificationId_policyDocumentId: {
          notificationId: n.id,
          policyDocumentId,
        },
      },
    });
    if (!row) throw new NotFoundException('Policy not attached');
    await this.prisma.cqcNotificationPolicy.delete({ where: { id: row.id } });
    await this.log(
      user,
      AuditAction.CQC_NOTIFICATION_POLICY_REMOVED,
      n.id,
      `Policy removed: ${row.referenceSnapshot} ${row.titleSnapshot}`,
      meta,
    );
    return this.overview(user, id);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async requireEditable(user: RequestUser, id: string) {
    const n = await this.notifications.requireVisible(user, id);
    if (!OPEN.includes(n.status))
      throw new BadRequestException(
        'Policies can only be changed while the notification is a draft or ready',
      );
    return n;
  }

  /** Attached policies as attached (snapshot), with the current review date of the live policy. */
  private async attached(n: CqcNotification) {
    const rows = await this.prisma.cqcNotificationPolicy.findMany({
      where: { notificationId: n.id },
      orderBy: { addedAt: 'asc' },
    });
    const versions = await this.prisma.policyVersion.findMany({
      where: {
        id: {
          in: rows.map((r) => r.policyVersionId).filter(Boolean) as string[],
        },
      },
      select: { id: true, reviewDate: true },
    });
    const now = Date.now();
    return rows.map((r) => {
      const review =
        versions.find((v) => v.id === r.policyVersionId)?.reviewDate ?? null;
      return {
        policyDocumentId: r.policyDocumentId,
        reference: r.referenceSnapshot,
        title: r.titleSnapshot,
        version: r.versionLabel,
        reviewDate: review ? review.toISOString().slice(0, 10) : null,
        reviewOverdue: Boolean(review && review.getTime() < now),
        source: r.source,
        addedAt: r.addedAt.toISOString(),
      };
    });
  }

  /** The organisation's published policies (current version) that apply to the branch. */
  private async ownPolicies(
    locationId: string,
    where: Prisma.PolicyDocumentWhereInput,
    take = 200,
  ): Promise<OwnPolicy[]> {
    const docs = await this.prisma.policyDocument.findMany({
      where: {
        AND: [
          {
            isCatalogue: false,
            deletedAt: null,
            isActive: true,
            status: PolicyStatus.PUBLISHED,
            currentVersionId: { not: null },
          },
          where,
        ],
      },
      orderBy: { title: 'asc' },
      take,
      select: {
        id: true,
        reference: true,
        title: true,
        currentVersionId: true,
        libraryDocumentId: true,
      },
    });
    const versions = await this.prisma.policyVersion.findMany({
      where: { id: { in: docs.map((d) => d.currentVersionId!) } },
      select: {
        id: true,
        versionMajor: true,
        versionMinor: true,
        reviewDate: true,
        applicability: {
          select: {
            organisationWide: true,
            locationId: true,
            serviceTypeCode: true,
          },
        },
      },
    });
    const now = Date.now();
    return docs.flatMap((d) => {
      const v = versions.find((x) => x.id === d.currentVersionId);
      if (!v) return [];
      const applies = applicabilityMatches(v.applicability, {
        assignedLocationIds: null,
        roleIds: [],
        jobTitleId: null,
        workAreaId: null,
        locationId,
      });
      if (!applies) return [];
      return [
        {
          policyDocumentId: d.id,
          reference: d.reference,
          title: d.title,
          version: versionLabel(v.versionMajor, v.versionMinor),
          versionId: v.id,
          reviewDate: v.reviewDate
            ? v.reviewDate.toISOString().slice(0, 10)
            : null,
          reviewOverdue: Boolean(v.reviewDate && v.reviewDate.getTime() < now),
          libraryDocumentId: d.libraryDocumentId,
        },
      ];
    });
  }

  private option(p: OwnPolicy): PolicyOption {
    return {
      policyDocumentId: p.policyDocumentId,
      reference: p.reference,
      title: p.title,
      version: p.version,
      reviewDate: p.reviewDate,
      reviewOverdue: p.reviewOverdue,
    };
  }

  private async log(
    user: RequestUser,
    action: AuditAction,
    recordId: string,
    description: string,
    meta?: RequestAuditMeta,
  ) {
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_NOTIFICATIONS,
      action,
      recordType: 'CqcNotification',
      recordId,
      description,
      ...meta,
    });
  }
}
