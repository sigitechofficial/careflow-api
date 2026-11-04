import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CarePlanVisitTaskLinkStatus as LinkStatus,
  Prisma,
  ServiceUserCarePlanLifecycleStatus as LifecycleStatus,
} from '@prisma/client';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { PrismaService } from '../prisma/prisma.service';
import { loadCarePlanFormFields } from './compose/compose-context.loader';
import { parsePublishedValuesJson } from '../scheduled-jobs-housekeeping/visit-care-plan-delivery.util';
import {
  buildTaskReconciliation,
  structuredCarePlanRequirements,
} from './care-plan-task-reconciliation.util';

const linkSelect = {
  id: true,
  serviceUserId: true,
  carePlanInstanceId: true,
  requirementKey: true,
  requirementLabel: true,
  status: true,
  reason: true,
  visitTaskAssignmentId: true,
  carePlanPublishedVersionId: true,
  linkedAt: true,
  linkedById: true,
  reviewedAt: true,
  reviewedById: true,
} satisfies Prisma.CarePlanVisitTaskLinkSelect;

/**
 * Phase 4A: managers link a published care plan (or one of its structured requirements) to visit
 * tasks the service user already has. Visit tasks themselves are never created, changed or deleted.
 */
@Injectable()
export class CarePlanTaskReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async getReconciliation(serviceUserId: string, carePathwayFormId: string) {
    const ctx = await this.loadPublishedContext(
      serviceUserId,
      carePathwayFormId,
    );
    if (!ctx) return { data: null };
    const [links, assignments] = await Promise.all([
      this.prisma.carePlanVisitTaskLink.findMany({
        where: { carePlanInstanceId: ctx.instance.id },
        orderBy: { linkedAt: 'asc' },
        select: linkSelect,
      }),
      this.prisma.serviceUserVisitTaskAssignment.findMany({
        where: { serviceUserId },
        orderBy: [{ medicationRoundCode: 'asc' }, { sortOrder: 'asc' }],
        select: {
          id: true,
          medicationRoundCode: true,
          dueTime: true,
          isActive: true,
          deletedAt: true,
          task: { select: { name: true } },
        },
      }),
    ]);
    const versionIds = [
      ...new Set(links.map((l) => l.carePlanPublishedVersionId)),
    ];
    const versions = versionIds.length
      ? await this.prisma.serviceUserCarePlanPublishedVersion.findMany({
          where: { id: { in: versionIds }, instanceId: ctx.instance.id },
          select: { id: true, versionNumber: true, valuesJson: true },
        })
      : [];
    const view = buildTaskReconciliation({
      requirements: ctx.requirements,
      links,
      assignments: assignments.map((a) => ({ ...a, taskName: a.task.name })),
      currentVersionId: ctx.version.id,
      currentValues: parsePublishedValuesJson(ctx.version.valuesJson),
      valuesByVersionId: new Map(
        versions.map((v) => [v.id, parsePublishedValuesJson(v.valuesJson)]),
      ),
      versionNumberById: new Map(versions.map((v) => [v.id, v.versionNumber])),
    });
    return {
      data: {
        instanceId: ctx.instance.id,
        carePathwayFormId,
        formName: ctx.formName,
        lifecycleStatus: ctx.instance.lifecycleStatus,
        publishedVersion: {
          id: ctx.version.id,
          versionNumber: ctx.version.versionNumber,
        },
        ...view,
      },
    };
  }

  /** Link an existing visit task of this service user to the plan or one structured requirement. */
  async link(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: { visitTaskAssignmentId: string; requirementKey?: string },
    meta?: RequestAuditMeta,
  ) {
    const ctx = await this.loadWritableContext(
      serviceUserId,
      carePathwayFormId,
    );
    const requirement = this.resolveRequirement(ctx, dto.requirementKey);
    // The task must belong to the same service user (never another person's task).
    const assignment =
      await this.prisma.serviceUserVisitTaskAssignment.findFirst({
        where: {
          id: dto.visitTaskAssignmentId,
          serviceUserId,
          deletedAt: null,
        },
        select: { id: true, task: { select: { name: true } } },
      });
    if (!assignment)
      throw new BadRequestException(
        'That visit task is not assigned to this service user.',
      );

    await this.inLockedTransaction(ctx.instance.id, async (tx) => {
      const existing = await tx.carePlanVisitTaskLink.findFirst({
        where: {
          carePlanInstanceId: ctx.instance.id,
          visitTaskAssignmentId: assignment.id,
          requirementKey: requirement.key,
        },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException(
          'This visit task is already linked to that requirement.',
        );
      const created = await tx.carePlanVisitTaskLink.create({
        data: {
          serviceUserId,
          carePlanInstanceId: ctx.instance.id,
          carePlanPublishedVersionId: ctx.version.id,
          visitTaskAssignmentId: assignment.id,
          requirementKey: requirement.key,
          requirementLabel: requirement.label,
          status: LinkStatus.LINKED,
          linkedById: userId,
        },
        select: linkSelect,
      });
      await this.log(
        tx,
        userId,
        AuditAction.CARE_PLAN_TASK_LINKED,
        ctx,
        created.id,
        null,
        {
          ...created,
          taskName: assignment.task.name,
        },
        meta,
      );
    });
    return this.getReconciliation(serviceUserId, carePathwayFormId);
  }

  /** Remove an incorrect link. The task is untouched; the audit log keeps the removed link. */
  async unlink(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    linkId: string,
    dto: { reason?: string },
    meta?: RequestAuditMeta,
  ) {
    const ctx = await this.loadWritableContext(
      serviceUserId,
      carePathwayFormId,
    );
    await this.inLockedTransaction(ctx.instance.id, async (tx) => {
      const link = await this.findLinkOrThrow(tx, ctx.instance.id, linkId);
      await tx.carePlanVisitTaskLink.delete({ where: { id: link.id } });
      await this.log(
        tx,
        userId,
        AuditAction.CARE_PLAN_TASK_UNLINKED,
        ctx,
        link.id,
        link,
        {
          removed: true,
          reason: dto.reason?.trim() || null,
        },
        meta,
      );
    });
    return this.getReconciliation(serviceUserId, carePathwayFormId);
  }

  /** Record that a structured requirement needs no visit task, with a mandatory reason. */
  async markNotApplicable(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    dto: { requirementKey: string; reason: string },
    meta?: RequestAuditMeta,
  ) {
    const reason = dto.reason?.trim() ?? '';
    if (reason.length < 3)
      throw new BadRequestException('A reason is required (min 3 characters)');
    const ctx = await this.loadWritableContext(
      serviceUserId,
      carePathwayFormId,
    );
    if (!dto.requirementKey)
      throw new BadRequestException('Choose the care plan requirement.');
    const requirement = this.resolveRequirement(ctx, dto.requirementKey);
    await this.inLockedTransaction(ctx.instance.id, async (tx) => {
      const existing = await tx.carePlanVisitTaskLink.findFirst({
        where: {
          carePlanInstanceId: ctx.instance.id,
          requirementKey: requirement.key,
          visitTaskAssignmentId: null,
        },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException(
          'This requirement is already marked not applicable.',
        );
      const created = await tx.carePlanVisitTaskLink.create({
        data: {
          serviceUserId,
          carePlanInstanceId: ctx.instance.id,
          carePlanPublishedVersionId: ctx.version.id,
          visitTaskAssignmentId: null,
          requirementKey: requirement.key,
          requirementLabel: requirement.label,
          status: LinkStatus.NOT_APPLICABLE,
          reason,
          linkedById: userId,
        },
        select: linkSelect,
      });
      await this.log(
        tx,
        userId,
        AuditAction.CARE_PLAN_TASK_NOT_APPLICABLE,
        ctx,
        created.id,
        null,
        created,
        meta,
      );
    });
    return this.getReconciliation(serviceUserId, carePathwayFormId);
  }

  /**
   * A manager confirms a link (or not-applicable decision) still holds for the current published
   * version. Links to a requirement that is no longer in the plan must be removed instead.
   */
  async markReviewed(
    userId: string,
    serviceUserId: string,
    carePathwayFormId: string,
    linkId: string,
    meta?: RequestAuditMeta,
  ) {
    const ctx = await this.loadWritableContext(
      serviceUserId,
      carePathwayFormId,
    );
    await this.inLockedTransaction(ctx.instance.id, async (tx) => {
      const link = await this.findLinkOrThrow(tx, ctx.instance.id, linkId);
      if (
        link.requirementKey &&
        !ctx.requirements.some((r) => r.key === link.requirementKey)
      ) {
        throw new BadRequestException(
          'That requirement is no longer in the published care plan. Unlink it instead.',
        );
      }
      if (link.visitTaskAssignmentId) {
        const active = await tx.serviceUserVisitTaskAssignment.findFirst({
          where: {
            id: link.visitTaskAssignmentId,
            serviceUserId,
            deletedAt: null,
            isActive: true,
          },
          select: { id: true },
        });
        if (!active)
          throw new BadRequestException(
            'The linked visit task is no longer active. Unlink it instead.',
          );
      }
      const updated = await tx.carePlanVisitTaskLink.update({
        where: { id: link.id },
        data: {
          status: link.visitTaskAssignmentId
            ? LinkStatus.LINKED
            : LinkStatus.NOT_APPLICABLE,
          carePlanPublishedVersionId: ctx.version.id,
          reviewedById: userId,
          reviewedAt: new Date(),
        },
        select: linkSelect,
      });
      await this.log(
        tx,
        userId,
        AuditAction.CARE_PLAN_TASK_REVIEWED,
        ctx,
        link.id,
        link,
        updated,
        meta,
      );
    });
    return this.getReconciliation(serviceUserId, carePathwayFormId);
  }

  private async loadPublishedContext(
    serviceUserId: string,
    carePathwayFormId: string,
  ) {
    const instance = await this.prisma.serviceUserCarePlanInstance.findUnique({
      where: {
        serviceUserId_carePathwayFormId: { serviceUserId, carePathwayFormId },
      },
      select: {
        id: true,
        serviceUserId: true,
        lifecycleStatus: true,
        publishedVersions: {
          where: { supersededAt: null },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, versionNumber: true, valuesJson: true },
        },
      },
    });
    const version = instance?.publishedVersions[0];
    if (!instance || !version) return null;
    const { formName, fields } = await loadCarePlanFormFields(
      this.prisma,
      carePathwayFormId,
    );
    return {
      instance,
      version,
      formName,
      carePathwayFormId,
      requirements: structuredCarePlanRequirements(fields, version.valuesJson),
    };
  }

  private async loadWritableContext(
    serviceUserId: string,
    carePathwayFormId: string,
  ) {
    const ctx = await this.loadPublishedContext(
      serviceUserId,
      carePathwayFormId,
    );
    if (!ctx)
      throw new BadRequestException(
        'Only a published care plan can be reconciled with visit tasks.',
      );
    if (ctx.instance.lifecycleStatus === LifecycleStatus.ARCHIVED) {
      throw new BadRequestException(
        'This care plan is archived; its task links are read-only.',
      );
    }
    return ctx;
  }

  private resolveRequirement(
    ctx: NonNullable<
      Awaited<
        ReturnType<CarePlanTaskReconciliationService['loadPublishedContext']>
      >
    >,
    requirementKey: string | undefined,
  ) {
    const key = requirementKey?.trim() ?? '';
    if (key === '') return { key: '', label: null };
    const req = ctx.requirements.find((r) => r.key === key);
    if (!req)
      throw new BadRequestException(
        'That requirement is not in the published care plan.',
      );
    return { key: req.key, label: req.label };
  }

  private async findLinkOrThrow(
    tx: Prisma.TransactionClient,
    instanceId: string,
    linkId: string,
  ) {
    const link = await tx.carePlanVisitTaskLink.findFirst({
      where: { id: linkId, carePlanInstanceId: instanceId },
      select: linkSelect,
    });
    if (!link) throw new NotFoundException('Care plan task link not found');
    return link;
  }

  /** Changes to one plan's links are serialised (row lock on the care plan instance). */
  private inLockedTransaction(
    instanceId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "service_users"."ServiceUserCarePlanInstance" WHERE "id" = ${instanceId}::uuid FOR UPDATE`;
        await fn(tx);
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException('This link already exists.');
        }
        throw error;
      });
  }

  private log(
    tx: Prisma.TransactionClient,
    userId: string,
    action: AuditAction,
    ctx: {
      instance: { id: string; serviceUserId: string };
      version: { id: string; versionNumber: number };
      carePathwayFormId: string;
    },
    linkId: string,
    oldValues: object | null,
    newValues: object,
    meta?: RequestAuditMeta,
  ) {
    return this.audit.logAudit({
      tx,
      userId,
      module: AuditModule.CARE_PLAN,
      action,
      recordType: 'CarePlanVisitTaskLink',
      recordId: linkId,
      ...(oldValues ? { oldValues: oldValues } : {}),
      newValues: newValues,
      metadata: {
        serviceUserId: ctx.instance.serviceUserId,
        carePathwayFormId: ctx.carePathwayFormId,
        carePlanInstanceId: ctx.instance.id,
        carePlanPublishedVersionId: ctx.version.id,
        publishedVersionNumber: ctx.version.versionNumber,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }
}
