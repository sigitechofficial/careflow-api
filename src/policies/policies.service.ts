import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PolicyApprovalDecision,
  PolicyApprovalKind,
  PolicyAudienceTargetType,
  PolicyDocumentSource,
  PolicyLinkModuleType,
  PolicyLinkScope,
  PolicyStatus,
  Prisma,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreatePolicyDto,
  CreatePolicyVersionDto,
  PolicyApplicabilityInputDto,
  PolicyAudienceInputDto,
  PolicyCommentsDto,
  PolicyLinkInputDto,
  PolicyListQueryDto,
  ApplicablePoliciesQueryDto,
  PublishPolicyDto,
  UpdatePolicyDto,
} from './dto/policy.dto';
import {
  POLICY_IN_PROGRESS_STATUSES,
  assertDraftEditable,
  formatVersionLabel,
  nextStatus,
  nextVersionNumbers,
} from './policy-status';
import {
  POLICY_UPLOAD_MIME,
  assertPolicyUploadFile,
  contentDisposition,
  copyStoredPolicyFile,
  deletePolicyVersionUploadDir,
  deleteStoredPolicyFile,
  newPolicyStorageRelativePath,
  policyStoragePathBelongsToVersion,
  resolveSafePolicyPath,
  writeStoredPolicyFile,
} from './policy-upload.util';
import { existsSync } from 'fs';
import {
  assertApplicabilityShape,
  assertAudienceShape,
  assertLinkScopeAllowed,
  assertLinkShape,
  findDuplicatePolicyLink,
  isIncompleteApplicabilityRow,
  isIncompleteAudienceRow,
  isIncompleteLinkRow,
  locationAclAllows,
  policyIsVisible,
  type PolicyApplicabilityRow,
  type PolicyAudienceRow,
  type PolicyLinkQuery,
  type PolicyLinkRow,
  type PolicyMatchContext,
} from './policy-targeting';

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PoliciesService {
  private readonly logger = new Logger(PoliciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private isUnrestricted(user: RequestUser): boolean {
    return user.assignedLocationIds == null;
  }

  private canMutateDocument(
    user: RequestUser,
    doc: { ownerId: string | null; createdById: string | null },
  ): boolean {
    if (this.isUnrestricted(user)) return true;
    return doc.ownerId === user.id || doc.createdById === user.id;
  }

  private visibilityWhere(user: RequestUser): Prisma.PolicyDocumentWhereInput {
    if (this.isUnrestricted(user)) return {};
    return {
      OR: [
        { status: { in: [PolicyStatus.PUBLISHED, PolicyStatus.ARCHIVED] } },
        { ownerId: user.id },
        { createdById: user.id },
      ],
    };
  }

  private toDateOnly(value?: string): Date | undefined {
    if (!value) return undefined;
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }

  private toIso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private isoDate(value: Date | string | null | undefined): string | null {
    const iso = this.toIso(value);
    return iso ? iso.slice(0, 10) : null;
  }

  private mapCategory(row: { id: string; name: string; code: string }) {
    return { id: row.id, name: row.name, code: row.code };
  }

  private mapVersion(
    row: {
      id: string;
      documentId: string;
      versionMajor: number;
      versionMinor: number;
      status: PolicyStatus;
      titleSnapshot: string;
      contentJson: Prisma.JsonValue;
      contentHtml: string | null;
      changeSummary: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      fileSize?: number | null;
      storagePath?: string | null;
      effectiveDate: Date | null;
      reviewDate: Date | null;
      acknowledgementRequired?: boolean;
      publishedAt: Date | null;
      publishedById: string | null;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      applicability?: Array<{
        id: string;
        organisationWide: boolean;
        locationId: string | null;
        serviceTypeCode: string | null;
      }>;
      audiences?: Array<{
        id: string;
        targetType: PolicyAudienceTargetType;
        roleId: string | null;
        jobTitleId: string | null;
        workAreaId: string | null;
        locationId: string | null;
      }>;
      links?: Array<{
        id: string;
        moduleType: PolicyLinkModuleType;
        scope: PolicyLinkScope;
        recordId: string | null;
        sectionKey: string | null;
        label: string | null;
      }>;
    },
  ) {
    return {
      id: row.id,
      documentId: row.documentId,
      versionMajor: row.versionMajor,
      versionMinor: row.versionMinor,
      versionLabel: formatVersionLabel(row.versionMajor, row.versionMinor),
      status: row.status,
      titleSnapshot: row.titleSnapshot,
      contentJson: row.contentJson,
      contentHtml: row.contentHtml,
      changeSummary: row.changeSummary,
      fileName: row.fileName ?? null,
      mimeType: row.mimeType ?? null,
      fileSize: row.fileSize ?? null,
      hasDocument: Boolean(row.storagePath),
      contentKind: row.storagePath ? 'UPLOAD' : 'EDITOR',
      effectiveDate: this.isoDate(row.effectiveDate),
      reviewDate: this.isoDate(row.reviewDate),
      acknowledgementRequired: row.acknowledgementRequired ?? false,
      publishedAt: this.toIso(row.publishedAt),
      publishedById: row.publishedById,
      archivedAt: this.toIso(row.archivedAt),
      createdAt: this.toIso(row.createdAt) ?? new Date(0).toISOString(),
      updatedAt: this.toIso(row.updatedAt) ?? new Date(0).toISOString(),
      applicability: (row.applicability ?? []).map((item) => ({
        id: item.id,
        organisationWide: item.organisationWide,
        locationId: item.locationId,
        serviceTypeCode: item.serviceTypeCode,
      })),
      audiences: (row.audiences ?? []).map((item) => ({
        id: item.id,
        targetType: item.targetType,
        roleId: item.roleId,
        jobTitleId: item.jobTitleId,
        workAreaId: item.workAreaId,
        locationId: item.locationId,
      })),
      links: (row.links ?? []).map((item) => ({
        id: item.id,
        moduleType: item.moduleType,
        scope: item.scope,
        recordId: item.recordId,
        sectionKey: item.sectionKey,
        label: item.label,
      })),
    };
  }

  private mapDocument(
    row: {
      id: string;
      reference: string;
      title: string;
      description: string | null;
      documentType: string;
      source: PolicyDocumentSource;
      primaryCategoryId: string;
      parentDocumentId: string | null;
      currentVersionId: string | null;
      status: PolicyStatus;
      isCatalogue: boolean;
      ownerId: string | null;
      reviewerId: string | null;
      approverId: string | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      createdById: string | null;
      primaryCategory?: { id: string; name: string; code: string } | null;
      tagLinks?: Array<{ tag: { id: string; name: string } }>;
    },
    version?: ReturnType<PoliciesService['mapVersion']> | null,
  ) {
    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      description: row.description,
      documentType: row.documentType,
      source: row.source,
      primaryCategoryId: row.primaryCategoryId,
      primaryCategory: row.primaryCategory ? this.mapCategory(row.primaryCategory) : null,
      tags: (row.tagLinks ?? []).map((link) => ({ id: link.tag.id, name: link.tag.name })),
      parentDocumentId: row.parentDocumentId,
      currentVersionId: row.currentVersionId,
      status: row.status,
      isCatalogue: row.isCatalogue,
      ownerId: row.ownerId,
      reviewerId: row.reviewerId,
      approverId: row.approverId,
      createdById: row.createdById,
      createdAt: this.toIso(row.createdAt) ?? new Date(0).toISOString(),
      updatedAt: this.toIso(row.updatedAt) ?? new Date(0).toISOString(),
      currentVersion: version ?? null,
    };
  }

  private readonly versionTargetingInclude = {
    applicability: true,
    audiences: true,
    links: true,
  } as const;

  private readonly documentDetailInclude = {
    primaryCategory: { select: { id: true, name: true, code: true } },
    tagLinks: { include: { tag: { select: { id: true, name: true } } } },
  } as const;

  private async resolveMatchContext(
    user: RequestUser,
    extras?: { locationId?: string; serviceTypeCode?: string },
  ): Promise<PolicyMatchContext> {
    const roles = user.roles.length
      ? await this.prisma.role.findMany({
          where: { name: { in: user.roles }, deletedAt: null },
          select: { id: true },
        })
      : [];

    const personal = await this.prisma.employeePersonalDetail.findFirst({
      where: {
        email: { equals: user.email, mode: 'insensitive' },
        employee: { deletedAt: null },
      },
      select: {
        employee: {
          select: { employment: { select: { jobTitleId: true, workAreaId: true } } },
        },
      },
    });

    return {
      assignedLocationIds: user.assignedLocationIds ?? null,
      roleIds: roles.map((role) => role.id),
      jobTitleId: personal?.employee?.employment?.jobTitleId ?? null,
      workAreaId: personal?.employee?.employment?.workAreaId ?? null,
      serviceTypeCode: extras?.serviceTypeCode ?? null,
      locationId: extras?.locationId ?? null,
    };
  }

  private targetingRows(version: {
    applicability?: PolicyApplicabilityRow[];
    audiences?: PolicyAudienceRow[];
    links?: Array<PolicyLinkRow & { label?: string | null }>;
  }) {
    return {
      applicability: version.applicability ?? [],
      audience: version.audiences ?? [],
      links: (version.links ?? []).map((link) => ({
        moduleType: link.moduleType,
        scope: link.scope,
        recordId: link.recordId,
        sectionKey: link.sectionKey,
      })),
    };
  }

  private isAuthorOf(
    user: RequestUser,
    doc: { ownerId: string | null; createdById: string | null },
  ): boolean {
    return doc.ownerId === user.id || doc.createdById === user.id;
  }

  private async assertPublishedVisible(
    user: RequestUser,
    doc: { ownerId: string | null; createdById: string | null },
    version: {
      status: PolicyStatus;
      applicability?: PolicyApplicabilityRow[];
      audiences?: PolicyAudienceRow[];
      links?: Array<PolicyLinkRow>;
    } | null,
    ctx: PolicyMatchContext,
    linkQuery?: PolicyLinkQuery | null,
    requireServiceContext = false,
  ) {
    if (!version) return;
    if (this.isAuthorOf(user, doc) && version.status !== PolicyStatus.PUBLISHED) return;
    if (this.isUnrestricted(user) && !linkQuery?.moduleType && !requireServiceContext) return;
    if (
      version.status === PolicyStatus.PUBLISHED ||
      version.status === PolicyStatus.ARCHIVED ||
      requireServiceContext
    ) {
      const targeting = this.targetingRows(version);
      if (
        !policyIsVisible({
          applicability: targeting.applicability,
          audience: targeting.audience,
          links: targeting.links,
          ctx,
          linkQuery,
          requireServiceContext,
        })
      ) {
        throw new NotFoundException('Policy not found');
      }
    }
  }

  private async loadConfiguredServiceTypes(): Promise<string[]> {
    const profile = await this.prisma.companyProfile.findFirst({
      select: { careServiceTypes: true },
    });
    return profile?.careServiceTypes ?? [];
  }

  private async validateApplicability(
    user: RequestUser,
    rows: PolicyApplicabilityInputDto[] | undefined,
    options: { allowIncomplete?: boolean } = {},
  ): Promise<PolicyApplicabilityRow[]> {
    const allowIncomplete = options.allowIncomplete === true;
    const source = rows?.length
      ? rows
      : this.isUnrestricted(user)
        ? [{ organisationWide: true as const }]
        : allowIncomplete
          ? []
          : null;
    if (!source) {
      throw new BadRequestException('Branch-scoped users must specify location applicability');
    }
    const orgTypes = await this.loadConfiguredServiceTypes();
    const result: PolicyApplicabilityRow[] = [];

    for (const row of source) {
      const shape: PolicyApplicabilityRow = {
        organisationWide: row.organisationWide,
        locationId: row.locationId ?? null,
        serviceTypeCode: row.serviceTypeCode?.trim() ? row.serviceTypeCode.trim().toUpperCase() : null,
      };
      const error = assertApplicabilityShape(shape);
      if (error) {
        if (allowIncomplete && isIncompleteApplicabilityRow(shape)) {
          result.push(shape);
          continue;
        }
        throw new BadRequestException(error);
      }

      if (shape.organisationWide && !this.isUnrestricted(user)) {
        throw new ForbiddenException('Branch-scoped users cannot create organisation-wide policies');
      }

      if (shape.locationId) {
        const location = await this.prisma.location.findFirst({
          where: { id: shape.locationId, deletedAt: null },
        });
        if (!location) throw new BadRequestException('Location not found');
        if (!locationAclAllows(user.assignedLocationIds, shape.locationId)) {
          throw new ForbiddenException('Cannot target a location outside your branch access');
        }
      }

      if (shape.serviceTypeCode) {
        if (shape.serviceTypeCode === 'CARE_HOME') {
          throw new BadRequestException('Use RESIDENTIAL for care home, not CARE_HOME');
        }
        const lookup = await this.prisma.serviceUserCareType.findFirst({
          where: { code: shape.serviceTypeCode, isActive: true },
        });
        if (!lookup) throw new BadRequestException('Invalid service type');
        if (!orgTypes.length) {
          throw new BadRequestException('Organisation care service types are not configured');
        }
        if (!orgTypes.includes(shape.serviceTypeCode)) {
          throw new BadRequestException('Service type is not configured for this organisation');
        }
      }

      if (!shape.organisationWide && !shape.locationId && shape.serviceTypeCode && !this.isUnrestricted(user)) {
        throw new ForbiddenException(
          'Branch-scoped users cannot target a service type across the whole organisation',
        );
      }

      result.push(shape);
    }
    return result;
  }

  private async validateAudiences(
    user: RequestUser,
    rows: PolicyAudienceInputDto[] | undefined,
    options: { allowIncomplete?: boolean } = {},
  ): Promise<PolicyAudienceRow[]> {
    if (!rows?.length) return [];
    const result: PolicyAudienceRow[] = [];
    for (const row of rows) {
      const shape: PolicyAudienceRow = {
        targetType: row.targetType,
        roleId: row.roleId ?? null,
        jobTitleId: row.jobTitleId ?? null,
        workAreaId: row.workAreaId ?? null,
        locationId: row.locationId ?? null,
      };
      const error = assertAudienceShape(shape);
      if (error) {
        if (options.allowIncomplete && isIncompleteAudienceRow(shape)) {
          result.push(shape);
          continue;
        }
        throw new BadRequestException(error);
      }

      if (shape.roleId) {
        const role = await this.prisma.role.findFirst({ where: { id: shape.roleId, deletedAt: null } });
        if (!role) throw new BadRequestException('Role not found');
      }
      if (shape.jobTitleId) {
        const title = await this.prisma.jobTitle.findFirst({
          where: { id: shape.jobTitleId, deletedAt: null },
        });
        if (!title) throw new BadRequestException('Job title not found');
      }
      if (shape.workAreaId) {
        const area = await this.prisma.workArea.findFirst({
          where: { id: shape.workAreaId, deletedAt: null },
        });
        if (!area) throw new BadRequestException('Work area not found');
      }
      if (shape.locationId) {
        const location = await this.prisma.location.findFirst({
          where: { id: shape.locationId, deletedAt: null },
        });
        if (!location) throw new BadRequestException('Location not found');
        if (!locationAclAllows(user.assignedLocationIds, shape.locationId)) {
          throw new ForbiddenException('Cannot target a location outside your branch access');
        }
      }
      result.push(shape);
    }
    return result;
  }

  private normalizeLinkRow(
    row: PolicyLinkInputDto,
  ): PolicyLinkRow & { label: string | null } {
    const shape: PolicyLinkRow & { label: string | null } = {
      moduleType: row.moduleType,
      scope: row.scope,
      recordId: row.recordId ?? null,
      sectionKey: row.sectionKey?.trim() || null,
      label: row.label?.trim() || null,
    };
    if (shape.scope === PolicyLinkScope.MODULE) {
      shape.recordId = null;
      shape.sectionKey = null;
    } else if (shape.scope === PolicyLinkScope.FORM_TEMPLATE || shape.scope === PolicyLinkScope.RECORD) {
      shape.sectionKey = null;
    }
    return shape;
  }

  private async validateLinks(
    _user: RequestUser,
    rows: PolicyLinkInputDto[] | undefined,
    options: { allowIncomplete?: boolean } = {},
  ): Promise<Array<PolicyLinkRow & { label: string | null }>> {
    if (!rows?.length) return [];
    const result: Array<PolicyLinkRow & { label: string | null }> = [];
    for (const row of rows) {
      const shape = this.normalizeLinkRow(row);
      const scopeError = assertLinkScopeAllowed(shape);
      if (scopeError) throw new BadRequestException(scopeError);
      const error = assertLinkShape(shape);
      if (error) {
        if (options.allowIncomplete && isIncompleteLinkRow(shape)) {
          result.push(shape);
          continue;
        }
        throw new BadRequestException(error);
      }
      await this.assertLinkTargetExists(shape);
      result.push(shape);
    }
    if (findDuplicatePolicyLink(result)) {
      throw new BadRequestException('Duplicate CareFlow links are not allowed');
    }
    return result;
  }

  private async resolveLinkQuery(query: ApplicablePoliciesQueryDto): Promise<PolicyLinkQuery | null> {
    if (!query.moduleType) return null;
    const linkQuery: PolicyLinkQuery = {
      moduleType: query.moduleType,
      scope: query.scope,
      recordId: query.recordId,
      sectionKey: query.sectionKey,
    };
    if (!query.recordId) return linkQuery;

    if (query.moduleType === PolicyLinkModuleType.CARE_PLAN) {
      const instance = await this.prisma.serviceUserCarePlanInstance.findFirst({
        where: { id: query.recordId },
        select: { carePathwayFormId: true },
      });
      if (instance) {
        linkQuery.formTemplateId = instance.carePathwayFormId;
      } else {
        const form = await this.prisma.carePathwayForm.findFirst({
          where: { id: query.recordId },
          select: { id: true },
        });
        if (form) linkQuery.formTemplateId = form.id;
      }
    }

    if (query.moduleType === PolicyLinkModuleType.TRAINING) {
      linkQuery.formTemplateId = query.recordId;
    }

    if (query.moduleType === PolicyLinkModuleType.INITIAL_ASSESSMENT) {
      const submission = await this.prisma.initialAssessmentSubmission.findFirst({
        where: { id: query.recordId, deletedAt: null },
        select: { templateId: true },
      });
      if (submission) linkQuery.formTemplateId = submission.templateId;
    }

    return linkQuery;
  }

  private async assertLinkTargetExists(link: PolicyLinkRow) {
    if (!link.recordId) return;
    if (link.scope === PolicyLinkScope.MODULE) return;

    if (link.moduleType === PolicyLinkModuleType.CARE_PLAN) {
      if (link.scope === PolicyLinkScope.FORM_TEMPLATE) {
        const form = await this.prisma.carePathwayForm.findFirst({ where: { id: link.recordId } });
        if (!form) throw new BadRequestException('Care plan form template not found');
        return;
      }
      if (link.scope === PolicyLinkScope.RECORD) {
        const instance = await this.prisma.serviceUserCarePlanInstance.findFirst({
          where: { id: link.recordId },
        });
        if (!instance) throw new BadRequestException('Care plan record not found');
        return;
      }
    }

    if (link.moduleType === PolicyLinkModuleType.INCIDENT && link.scope === PolicyLinkScope.RECORD) {
      const incident = await this.prisma.incident.findFirst({
        where: { id: link.recordId, deletedAt: null },
      });
      if (!incident) throw new BadRequestException('Incident record not found');
      return;
    }

    if (link.moduleType === PolicyLinkModuleType.MEDICATION && link.scope === PolicyLinkScope.RECORD) {
      const medication = await this.prisma.serviceUserMedication.findFirst({
        where: { id: link.recordId },
      });
      if (!medication) throw new BadRequestException('Medication record not found');
      return;
    }

    if (
      (link.moduleType === PolicyLinkModuleType.EMPLOYEE || link.moduleType === PolicyLinkModuleType.HR) &&
      link.scope === PolicyLinkScope.RECORD
    ) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: link.recordId, deletedAt: null },
      });
      if (!employee) throw new BadRequestException('Employee record not found');
      return;
    }

    if (link.moduleType === PolicyLinkModuleType.VISIT && link.scope === PolicyLinkScope.RECORD) {
      const visit = await this.prisma.serviceUserVisitPlan.findFirst({ where: { id: link.recordId } });
      if (!visit) throw new BadRequestException('Visit plan record not found');
      return;
    }

    if (
      link.moduleType === PolicyLinkModuleType.TRAINING &&
      (link.scope === PolicyLinkScope.FORM_TEMPLATE || link.scope === PolicyLinkScope.RECORD)
    ) {
      const course = await this.prisma.learningCourse.findFirst({
        where: { id: link.recordId, deletedAt: null },
      });
      if (!course) throw new BadRequestException('Learning course not found');
      return;
    }

    if (link.moduleType === PolicyLinkModuleType.INITIAL_ASSESSMENT && link.scope === PolicyLinkScope.RECORD) {
      const submission = await this.prisma.initialAssessmentSubmission.findFirst({
        where: { id: link.recordId, deletedAt: null },
      });
      if (submission) return;
      const assessment = await this.prisma.serviceUserInitialAssessment.findFirst({
        where: { id: link.recordId },
      });
      if (!assessment) throw new BadRequestException('Initial assessment record not found');
    }
  }

  private async writeTargeting(
    tx: Prisma.TransactionClient,
    versionId: string,
    userId: string,
    applicability: PolicyApplicabilityRow[],
    audiences: PolicyAudienceRow[],
    links: Array<PolicyLinkRow & { label?: string | null }>,
  ) {
    await tx.policyApplicability.deleteMany({ where: { versionId } });
    await tx.policyAudience.deleteMany({ where: { versionId } });
    await tx.policyLink.deleteMany({ where: { versionId } });

    if (applicability.length) {
      await tx.policyApplicability.createMany({
        data: applicability.map((row) => ({
          versionId,
          organisationWide: row.organisationWide,
          locationId: row.locationId,
          serviceTypeCode: row.serviceTypeCode,
        })),
      });
    }
    if (audiences.length) {
      await tx.policyAudience.createMany({
        data: audiences.map((row) => ({
          versionId,
          targetType: row.targetType,
          roleId: row.roleId,
          jobTitleId: row.jobTitleId,
          workAreaId: row.workAreaId,
          locationId: row.locationId,
        })),
      });
    }
    if (links.length) {
      await tx.policyLink.createMany({
        data: links.map((row) => ({
          versionId,
          moduleType: row.moduleType,
          scope: row.scope,
          recordId: row.recordId,
          sectionKey: row.sectionKey,
          label: row.label ?? null,
          createdById: userId,
        })),
      });
    }
  }

  private async replaceDocumentTags(tx: Prisma.TransactionClient, documentId: string, tagIds?: string[]) {
    if (tagIds === undefined) return;
    for (const tagId of tagIds) {
      const tag = await tx.policyTag.findFirst({ where: { id: tagId, deletedAt: null } });
      if (!tag) throw new BadRequestException('Policy tag not found');
    }
    await tx.policyTagLink.deleteMany({ where: { documentId } });
    if (tagIds.length) {
      await tx.policyTagLink.createMany({
        data: tagIds.map((tagId) => ({ documentId, tagId })),
      });
    }
  }

  private async requireCategory(db: Db, id: string) {
    const category = await db.policyCategory.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new BadRequestException('Category not found');
    return category;
  }

  private async requireDocument(user: RequestUser, id: string, forMutate = false) {
    const row = await this.prisma.policyDocument.findFirst({
      where: { id, deletedAt: null, ...this.visibilityWhere(user) },
      include: this.documentDetailInclude,
    });
    if (!row) throw new NotFoundException('Policy not found');
    if (forMutate && !this.canMutateDocument(user, row)) {
      throw new ForbiddenException('Insufficient location scope to modify this policy');
    }
    return row;
  }

  private async findInProgressVersion(documentId: string) {
    return this.prisma.policyVersion.findFirst({
      where: { documentId, status: { in: POLICY_IN_PROGRESS_STATUSES } },
      orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
    });
  }

  private async loadVersionById(documentId: string, versionId: string) {
    const version = await this.prisma.policyVersion.findFirst({
      where: { id: versionId, documentId },
      include: this.versionTargetingInclude,
    });
    if (!version) throw new NotFoundException('Policy version not found');
    return version;
  }

  private async loadCurrentVersion(row: { id: string; currentVersionId: string | null }) {
    if (row.currentVersionId) {
      const current = await this.prisma.policyVersion.findFirst({
        where: { id: row.currentVersionId, documentId: row.id },
        include: this.versionTargetingInclude,
      });
      if (current) return current;
    }
    return this.prisma.policyVersion.findFirst({
      where: { documentId: row.id },
      orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
      include: this.versionTargetingInclude,
    });
  }

  async list(user: RequestUser, query: PolicyListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const ctx = await this.resolveMatchContext(user, {
      locationId: query.locationId,
      serviceTypeCode: query.serviceTypeCode,
    });
    const reviewDateFilter =
      query.reviewDateFrom || query.reviewDateTo
        ? {
            versions: {
              some: {
                status: { in: [...POLICY_IN_PROGRESS_STATUSES, PolicyStatus.PUBLISHED] },
                reviewDate: {
                  ...(query.reviewDateFrom ? { gte: this.toDateOnly(query.reviewDateFrom) } : {}),
                  ...(query.reviewDateTo ? { lte: this.toDateOnly(query.reviewDateTo) } : {}),
                },
              },
            },
          }
        : {};

    const where: Prisma.PolicyDocumentWhereInput = {
      deletedAt: null,
      isCatalogue: false,
      ...this.visibilityWhere(user),
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { primaryCategoryId: query.categoryId } : {}),
      ...(query.documentType ? { documentType: query.documentType } : {}),
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...reviewDateFilter,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { versions: { some: { contentHtml: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    const applyVisibility = !this.isUnrestricted(user) || query.locationId || query.serviceTypeCode;
    const rows = await this.prisma.policyDocument.findMany({
      where,
      include: this.documentDetailInclude,
      orderBy: { updatedAt: 'desc' },
      ...(applyVisibility ? {} : { skip: (page - 1) * limit, take: limit }),
    });
    const totalUnfiltered = applyVisibility ? rows.length : await this.prisma.policyDocument.count({ where });

    const versionIds = rows.map((r) => r.currentVersionId).filter((id): id is string => !!id);
    const versions = versionIds.length
      ? await this.prisma.policyVersion.findMany({
          where: { id: { in: versionIds } },
          include: this.versionTargetingInclude,
        })
      : [];
    const versionById = new Map(versions.map((v) => [v.id, v]));

    const mapped = rows
      .map((row) => {
        const version = row.currentVersionId ? versionById.get(row.currentVersionId) : undefined;
        return { row, version, mapped: this.mapDocument(row, version ? this.mapVersion(version) : null) };
      })
      .filter(({ row, version }) => {
        if (!applyVisibility) return true;
        if (this.isAuthorOf(user, row)) return true;
        if (!version) return false;
        if (version.status !== PolicyStatus.PUBLISHED && version.status !== PolicyStatus.ARCHIVED) {
          return false;
        }
        const targeting = this.targetingRows(version);
        return policyIsVisible({
          applicability: targeting.applicability,
          audience: targeting.audience,
          links: targeting.links,
          ctx,
          requireServiceContext: !!query.serviceTypeCode,
        });
      });

    const total = applyVisibility ? mapped.length : totalUnfiltered;
    const pageRows = applyVisibility ? mapped.slice((page - 1) * limit, (page - 1) * limit + limit) : mapped;

    return {
      data: pageRows.map((item) => item.mapped),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async listApplicable(user: RequestUser, query: ApplicablePoliciesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const ctx = await this.resolveMatchContext(user, {
      locationId: query.locationId,
      serviceTypeCode: query.serviceTypeCode,
    });
    if (query.locationId && !locationAclAllows(user.assignedLocationIds, query.locationId)) {
      return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
    }

    const rows = await this.prisma.policyDocument.findMany({
      where: {
        deletedAt: null,
        isCatalogue: false,
        status: PolicyStatus.PUBLISHED,
      },
      include: this.documentDetailInclude,
      orderBy: { title: 'asc' },
    });
    const versionIds = rows.map((r) => r.currentVersionId).filter((id): id is string => !!id);
    const versions = versionIds.length
      ? await this.prisma.policyVersion.findMany({
          where: { id: { in: versionIds }, status: PolicyStatus.PUBLISHED },
          include: this.versionTargetingInclude,
        })
      : [];
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const linkQuery = await this.resolveLinkQuery(query);

    const visible = rows
      .map((row) => {
        const version = row.currentVersionId ? versionById.get(row.currentVersionId) : undefined;
        return { row, version };
      })
      .filter(({ version }) => {
        if (!version) return false;
        const targeting = this.targetingRows(version);
        return policyIsVisible({
          applicability: targeting.applicability,
          audience: targeting.audience,
          links: targeting.links,
          ctx,
          linkQuery,
          requireServiceContext: true,
        });
      })
      .map(({ row, version }) => this.mapDocument(row, version ? this.mapVersion(version) : null));

    return {
      data: visible.slice((page - 1) * limit, (page - 1) * limit + limit),
      meta: buildPaginationMeta({ page, limit, total: visible.length }),
    };
  }

  async getById(user: RequestUser, id: string) {
    const row = await this.requireDocument(user, id);
    const version = await this.loadCurrentVersion(row);
    const ctx = await this.resolveMatchContext(user);
    await this.assertPublishedVisible(user, row, version, ctx);
    return this.mapDocument(row, version ? this.mapVersion(version) : null);
  }

  async create(user: RequestUser, dto: CreatePolicyDto, meta?: RequestAuditMeta) {
    this.assertSupportedSource(dto.source);
    if (dto.effectiveDate && dto.reviewDate && dto.reviewDate < dto.effectiveDate) {
      throw new BadRequestException('Review date cannot be before effective date');
    }
    const reference = dto.reference.trim();
    const clash = await this.prisma.policyDocument.findFirst({ where: { reference } });
    if (clash) throw new ConflictException('Policy reference already exists');

    await this.requireCategory(this.prisma, dto.primaryCategoryId);
    if (dto.parentDocumentId) {
      const parent = await this.prisma.policyDocument.findFirst({
        where: { id: dto.parentDocumentId, deletedAt: null },
      });
      if (!parent) throw new BadRequestException('Parent policy not found');
    }

    const applicability = await this.validateApplicability(user, dto.applicability, { allowIncomplete: true });
    const audiences = await this.validateAudiences(user, dto.audiences, { allowIncomplete: true });
    const links = await this.validateLinks(user, dto.links, { allowIncomplete: true });

    let result: Awaited<ReturnType<PoliciesService['createTransaction']>>;
    try {
      result = await this.createTransaction(user, dto, reference, applicability, audiences, links);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Policy reference already exists');
      }
      throw err;
    }

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_created',
      recordType: 'PolicyDocument',
      recordId: result.document.id,
      newValues: {
        id: result.document.id,
        reference: result.document.reference,
        status: result.document.status,
        version: formatVersionLabel(1, 0),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapDocument(result.document, this.mapVersion(result.version));
  }

  async update(user: RequestUser, id: string, dto: UpdatePolicyDto, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const working = await this.findInProgressVersion(document.id);
    if (!working) throw new BadRequestException('No editable version found');
    assertDraftEditable(working.status);

    this.assertSupportedSource(dto.source);
    if (dto.effectiveDate && dto.reviewDate && dto.reviewDate < dto.effectiveDate) {
      throw new BadRequestException('Review date cannot be before effective date');
    }
    if (dto.primaryCategoryId) {
      await this.requireCategory(this.prisma, dto.primaryCategoryId);
    }
    if (dto.reference && dto.reference.trim() !== document.reference) {
      const clash = await this.prisma.policyDocument.findFirst({
        where: { reference: dto.reference.trim() },
      });
      if (clash) throw new ConflictException('Policy reference already exists');
    }

    const title = dto.title?.trim() ?? document.title;
    const applicability =
      dto.applicability !== undefined
        ? await this.validateApplicability(user, dto.applicability, { allowIncomplete: true })
        : undefined;
    const audiences =
      dto.audiences !== undefined
        ? await this.validateAudiences(user, dto.audiences, { allowIncomplete: true })
        : undefined;
    const links =
      dto.links !== undefined ? await this.validateLinks(user, dto.links, { allowIncomplete: true }) : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedDoc = await tx.policyDocument.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title } : {}),
          ...(dto.reference !== undefined ? { reference: dto.reference.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
          ...(dto.documentType !== undefined ? { documentType: dto.documentType } : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          ...(dto.primaryCategoryId !== undefined ? { primaryCategoryId: dto.primaryCategoryId } : {}),
          ...(dto.parentDocumentId !== undefined ? { parentDocumentId: dto.parentDocumentId } : {}),
          ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
          ...(dto.reviewerId !== undefined ? { reviewerId: dto.reviewerId } : {}),
          ...(dto.approverId !== undefined ? { approverId: dto.approverId } : {}),
          updatedById: user.id,
        },
        include: this.documentDetailInclude,
      });

      const switchToEditor = dto.source === PolicyDocumentSource.EDITOR && Boolean(working.storagePath);
      const updatedVersion = await tx.policyVersion.update({
        where: { id: working.id },
        data: {
          titleSnapshot: title,
          ...(dto.contentJson !== undefined
            ? { contentJson: dto.contentJson as Prisma.InputJsonValue }
            : {}),
          ...(dto.contentHtml !== undefined ? { contentHtml: dto.contentHtml } : {}),
          ...(dto.effectiveDate !== undefined ? { effectiveDate: this.toDateOnly(dto.effectiveDate) ?? null } : {}),
          ...(dto.reviewDate !== undefined ? { reviewDate: this.toDateOnly(dto.reviewDate) ?? null } : {}),
          ...(dto.acknowledgementRequired !== undefined ? { acknowledgementRequired: dto.acknowledgementRequired } : {}),
          ...(switchToEditor
            ? { fileName: null, mimeType: null, fileSize: null, storagePath: null }
            : {}),
        },
        include: this.versionTargetingInclude,
      });

      if (applicability || audiences || links) {
        await this.writeTargeting(
          tx,
          working.id,
          user.id,
          applicability ?? this.targetingRows(updatedVersion).applicability,
          audiences ?? this.targetingRows(updatedVersion).audience,
          links ?? this.targetingRows(updatedVersion).links,
        );
      }
      await this.replaceDocumentTags(tx, id, dto.tagIds);

      const version = await tx.policyVersion.findFirst({
        where: { id: working.id },
        include: this.versionTargetingInclude,
      });
      const documentWithTags = await tx.policyDocument.findFirst({
        where: { id },
        include: this.documentDetailInclude,
      });
      return { document: documentWithTags ?? updatedDoc, version: version ?? updatedVersion };
    });

    if (dto.source === PolicyDocumentSource.EDITOR && working.storagePath) {
      await this.deleteDraftFileIfSafe(working);
    }

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_draft_updated',
      recordType: 'PolicyDocument',
      recordId: id,
      newValues: { id, status: result.document.status, versionId: result.version.id },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapDocument(result.document, this.mapVersion(result.version));
  }

  async submitForReview(user: RequestUser, id: string, dto: PolicyCommentsDto, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const working = await this.findInProgressVersion(document.id);
    if (!working) throw new BadRequestException('No draft version found');
    nextStatus(working.status, 'submit');
    const version = await this.loadVersionById(document.id, working.id);
    this.assertReadyForReview(document, version);

    const result = await this.setWorkingStatus(document.id, working.id, PolicyStatus.IN_REVIEW, user.id);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_submitted_for_review',
      recordType: 'PolicyDocument',
      recordId: id,
      metadata: dto.comments ? { comments: dto.comments } : undefined,
      newValues: { status: PolicyStatus.IN_REVIEW, versionId: working.id },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return result;
  }

  async requestChanges(user: RequestUser, id: string, dto: PolicyCommentsDto, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const working = await this.findInProgressVersion(document.id);
    if (!working) throw new BadRequestException('No version under review');
    nextStatus(working.status, 'request_changes');

    await this.prisma.policyApproval.create({
      data: {
        versionId: working.id,
        kind: PolicyApprovalKind.REVIEW,
        decision: PolicyApprovalDecision.CHANGES_REQUESTED,
        comments: dto.comments ?? null,
        actorId: user.id,
      },
    });

    const result = await this.setWorkingStatus(document.id, working.id, PolicyStatus.DRAFT, user.id);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_changes_requested',
      recordType: 'PolicyDocument',
      recordId: id,
      metadata: dto.comments ? { comments: dto.comments } : undefined,
      newValues: { status: PolicyStatus.DRAFT, versionId: working.id },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return result;
  }

  async approve(user: RequestUser, id: string, dto: PolicyCommentsDto, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const working = await this.findInProgressVersion(document.id);
    if (!working) throw new BadRequestException('No version under review');
    nextStatus(working.status, 'approve');

    await this.prisma.policyApproval.create({
      data: {
        versionId: working.id,
        kind: PolicyApprovalKind.APPROVAL,
        decision: PolicyApprovalDecision.APPROVED,
        comments: dto.comments ?? null,
        actorId: user.id,
      },
    });

    const result = await this.setWorkingStatus(document.id, working.id, PolicyStatus.APPROVED, user.id);
    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_approved',
      recordType: 'PolicyDocument',
      recordId: id,
      metadata: dto.comments ? { comments: dto.comments } : undefined,
      newValues: { status: PolicyStatus.APPROVED, versionId: working.id },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return result;
  }

  async publish(user: RequestUser, id: string, dto: PublishPolicyDto, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const working = await this.findInProgressVersion(document.id);
    if (!working) throw new BadRequestException('No approved version available to publish');
    nextStatus(working.status, 'publish');

    const result = await this.prisma.$transaction(
      async (tx) => {
      const approved = await tx.policyVersion.findFirst({
        where: { id: working.id, documentId: id, status: PolicyStatus.APPROVED },
      });
      if (!approved) {
        throw new BadRequestException('Version is no longer APPROVED');
      }

      await tx.policyVersion.updateMany({
        where: { documentId: id, status: PolicyStatus.PUBLISHED },
        data: { status: PolicyStatus.SUPERSEDED },
      });

      const published = await tx.policyVersion.update({
        where: { id: approved.id },
        data: {
          status: PolicyStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById: user.id,
          changeSummary: dto.changeSummary ?? approved.changeSummary,
          titleSnapshot: document.title,
        },
      });

      const stillPublished = await tx.policyVersion.count({
        where: { documentId: id, status: PolicyStatus.PUBLISHED },
      });
      if (stillPublished !== 1) {
        throw new BadRequestException('Publish aborted: expected exactly one PUBLISHED version');
      }

      const updatedDoc = await tx.policyDocument.update({
        where: { id },
        data: {
          status: PolicyStatus.PUBLISHED,
          currentVersionId: published.id,
          updatedById: user.id,
        },
        include: this.documentDetailInclude,
      });

      const publishedFull = await tx.policyVersion.findFirst({
        where: { id: published.id },
        include: this.versionTargetingInclude,
      });

      return { document: updatedDoc, version: publishedFull ?? published };
    },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_published',
      recordType: 'PolicyDocument',
      recordId: id,
      newValues: {
        status: PolicyStatus.PUBLISHED,
        currentVersionId: result.version.id,
        version: formatVersionLabel(result.version.versionMajor, result.version.versionMinor),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapDocument(result.document, this.mapVersion(result.version));
  }

  async archive(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    if (document.status === PolicyStatus.ARCHIVED) {
      throw new BadRequestException('Policy is already archived');
    }
    if (document.status === PolicyStatus.IN_REVIEW) {
      throw new BadRequestException('Request changes or complete review before archiving');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const inProgress = await tx.policyVersion.findFirst({
        where: { documentId: id, status: { in: POLICY_IN_PROGRESS_STATUSES } },
      });
      if (inProgress) {
        await tx.policyVersion.update({
          where: { id: inProgress.id },
          data: { status: PolicyStatus.ARCHIVED, archivedAt: now },
        });
      }
      const published = await tx.policyVersion.findMany({
        where: { documentId: id, status: PolicyStatus.PUBLISHED },
      });
      for (const version of published) {
        await tx.policyVersion.update({
          where: { id: version.id },
          data: { status: PolicyStatus.ARCHIVED, archivedAt: now },
        });
      }

      const updatedDoc = await tx.policyDocument.update({
        where: { id },
        data: {
          status: PolicyStatus.ARCHIVED,
          isActive: false,
          updatedById: user.id,
        },
        include: this.documentDetailInclude,
      });

      const current = updatedDoc.currentVersionId
        ? await tx.policyVersion.findFirst({
            where: { id: updatedDoc.currentVersionId },
            include: this.versionTargetingInclude,
          })
        : null;
      return { document: updatedDoc, version: current };
    });

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_archived',
      recordType: 'PolicyDocument',
      recordId: id,
      newValues: { status: PolicyStatus.ARCHIVED },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapDocument(result.document, result.version ? this.mapVersion(result.version) : null);
  }

  async deleteDraftDocument(user: RequestUser, id: string, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const versions = await this.prisma.policyVersion.findMany({
      where: { documentId: document.id },
      orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
    });

    const neverPublishedDraft =
      document.status === PolicyStatus.DRAFT &&
      versions.length > 0 &&
      versions.every((version) => version.status === PolicyStatus.DRAFT);

    if (!neverPublishedDraft) {
      throw new BadRequestException(
        'Only draft policies that have never been published can be permanently deleted',
      );
    }

    const working =
      versions.find((version) => version.id === document.currentVersionId) ?? versions[0];
    const auditValues = {
      policyId: document.id,
      reference: document.reference,
      title: document.title,
      version: working
        ? formatVersionLabel(working.versionMajor, working.versionMinor)
        : null,
      actor: { id: user.id },
    };

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_deleted',
      recordType: 'PolicyDocument',
      recordId: document.id,
      newValues: auditValues,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    await this.prisma.policyDocument.delete({ where: { id: document.id } });

    for (const version of versions) {
      if (
        version.storagePath &&
        !policyStoragePathBelongsToVersion(version.storagePath, document.id, version.id)
      ) {
        this.logger.warn(
          `Skipped unexpected storage path while deleting policy ${document.id} version ${version.id}`,
        );
        continue;
      }
      try {
        deletePolicyVersionUploadDir(document.id, version.id);
      } catch (err) {
        this.logger.warn(
          `Policy ${document.id} was deleted but file cleanup failed for version ${version.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { id: document.id, deleted: true as const };
  }

  async listVersions(user: RequestUser, id: string) {
    const document = await this.requireDocument(user, id);
    const rows = await this.prisma.policyVersion.findMany({
      where: { documentId: document.id },
      include: this.versionTargetingInclude,
      orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
    });
    return { data: rows.map((row) => this.mapVersion(row)) };
  }

  async getVersion(user: RequestUser, id: string, versionId: string) {
    const document = await this.requireDocument(user, id);
    const version = await this.loadVersionById(document.id, versionId);
    return this.mapVersion(version);
  }

  async createVersion(user: RequestUser, id: string, dto: CreatePolicyVersionDto, meta?: RequestAuditMeta) {
    const document = await this.requireDocument(user, id, true);
    const existingInProgress = await this.findInProgressVersion(document.id);
    if (existingInProgress) {
      throw new BadRequestException('A draft, in-review, or approved version already exists');
    }

    const source = await this.prisma.policyVersion.findFirst({
      where: {
        documentId: id,
        status: { in: [PolicyStatus.PUBLISHED, PolicyStatus.ARCHIVED] },
      },
      orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
    });
    if (!source || source.status !== PolicyStatus.PUBLISHED) {
      throw new BadRequestException('A published version is required before creating a new version');
    }

    const bump = dto.bump ?? 'minor';
    const nums = nextVersionNumbers(source.versionMajor, source.versionMinor, bump);
    const reusePreviousContent = dto.reusePreviousContent !== false;

    let version: Awaited<ReturnType<PoliciesService['createVersionRow']>>;
    try {
      version = await this.createVersionRow(
        user,
        id,
        document.title,
        source,
        nums,
        dto.changeSummary,
        reusePreviousContent,
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('That version number already exists');
      }
      throw err;
    }

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_version_created',
      recordType: 'PolicyVersion',
      recordId: version.id,
      newValues: {
        documentId: id,
        version: formatVersionLabel(version.versionMajor, version.versionMinor),
        bump,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapVersion(version);
  }

  private assertSupportedSource(source?: PolicyDocumentSource) {
    if (source === PolicyDocumentSource.CATALOGUE) {
      throw new BadRequestException('Catalogue import is not available in this phase');
    }
  }

  private assertReadyForReview(
    document: { title: string; reference: string; primaryCategoryId: string },
    version: {
      storagePath?: string | null;
      contentHtml?: string | null;
      contentJson?: Prisma.JsonValue;
      applicability?: Array<{
        organisationWide: boolean;
        locationId: string | null;
        serviceTypeCode: string | null;
      }>;
      audiences?: Array<{
        targetType: PolicyAudienceTargetType;
        roleId: string | null;
        jobTitleId: string | null;
        workAreaId: string | null;
        locationId: string | null;
      }>;
      links?: Array<{
        moduleType: PolicyLinkModuleType;
        scope: PolicyLinkScope;
        recordId: string | null;
        sectionKey: string | null;
      }>;
    },
  ) {
    if (!document.title.trim() || !document.reference.trim() || !document.primaryCategoryId) {
      throw new BadRequestException('Complete the policy title, reference, and category before submitting');
    }
    if (!this.hasVersionBody(version)) {
      throw new BadRequestException('Add policy content or upload a document before submitting');
    }
    const applicability = version.applicability ?? [];
    if (!applicability.length) {
      throw new BadRequestException('Add applicability before submitting');
    }
    for (const row of applicability) {
      const error = assertApplicabilityShape({
        organisationWide: row.organisationWide,
        locationId: row.locationId,
        serviceTypeCode: row.serviceTypeCode,
      });
      if (error) throw new BadRequestException('Complete applicability before submitting');
    }
    for (const row of version.audiences ?? []) {
      const error = assertAudienceShape({
        targetType: row.targetType,
        roleId: row.roleId,
        jobTitleId: row.jobTitleId,
        workAreaId: row.workAreaId,
        locationId: row.locationId,
      });
      if (error) throw new BadRequestException('Complete audience before submitting');
    }
    for (const row of version.links ?? []) {
      const error = assertLinkShape({
        moduleType: row.moduleType,
        scope: row.scope,
        recordId: row.recordId,
        sectionKey: row.sectionKey,
      });
      if (error) throw new BadRequestException('Complete CareFlow links before submitting');
    }
  }

  private hasVersionBody(version: {
    storagePath?: string | null;
    contentHtml?: string | null;
    contentJson?: Prisma.JsonValue;
  }): boolean {
    if (version.storagePath) return true;
    if (typeof version.contentHtml === 'string') {
      const text = version.contentHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
      if (text) return true;
    }
    if (version.contentJson && typeof version.contentJson === 'object' && !Array.isArray(version.contentJson)) {
      const json = version.contentJson as Record<string, unknown>;
      if (typeof json.text === 'string' && json.text.trim()) return true;
    }
    return false;
  }

  private async deleteDraftFileIfSafe(version: {
    id: string;
    status: PolicyStatus;
    storagePath?: string | null;
  }): Promise<void> {
    if (version.status !== PolicyStatus.DRAFT || !version.storagePath) return;
    const remaining = await this.prisma.policyVersion.count({
      where: { storagePath: version.storagePath },
    });
    if (remaining > 0) return;
    deleteStoredPolicyFile(version.storagePath);
  }

  async uploadVersionDocument(
    user: RequestUser,
    id: string,
    versionId: string,
    file: Express.Multer.File | undefined,
    meta?: RequestAuditMeta,
  ) {
    const document = await this.requireDocument(user, id, true);
    const version = await this.loadVersionById(document.id, versionId);
    assertDraftEditable(version.status);
    const parsed = assertPolicyUploadFile(file);
    const relative = newPolicyStorageRelativePath(document.id, version.id, parsed.kind.ext);
    writeStoredPolicyFile(relative, parsed.buffer);
    const previousPath = version.storagePath;
    const replaced = Boolean(previousPath);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const next = await tx.policyVersion.update({
          where: { id: version.id },
          data: {
            fileName: parsed.originalName,
            mimeType: parsed.kind.mime,
            fileSize: parsed.buffer.length,
            storagePath: relative,
            contentJson: Prisma.JsonNull,
            contentHtml: null,
          },
          include: this.versionTargetingInclude,
        });
        await tx.policyDocument.update({
          where: { id: document.id },
          data: { source: PolicyDocumentSource.UPLOAD, updatedById: user.id },
        });
        return next;
      });

      if (previousPath && previousPath !== relative) {
        await this.deleteDraftFileIfSafe({ ...version, storagePath: previousPath });
      }

      await this.audit.logAudit({
        userId: user.id,
        module: AuditModule.POLICY,
        action: replaced ? 'policy_document_replaced' : 'policy_document_uploaded',
        recordType: 'PolicyVersion',
        recordId: version.id,
        newValues: {
          documentId: document.id,
          versionId: version.id,
          fileName: parsed.originalName,
          mimeType: parsed.kind.mime,
          fileSize: parsed.buffer.length,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return this.mapVersion(updated);
    } catch (err) {
      deleteStoredPolicyFile(relative);
      throw err;
    }
  }

  async removeVersionDocument(
    user: RequestUser,
    id: string,
    versionId: string,
    meta?: RequestAuditMeta,
  ) {
    const document = await this.requireDocument(user, id, true);
    const version = await this.loadVersionById(document.id, versionId);
    assertDraftEditable(version.status);
    if (!version.storagePath) {
      throw new BadRequestException('This version has no uploaded document');
    }

    const snapshot = {
      fileName: version.fileName,
      mimeType: version.mimeType,
      fileSize: version.fileSize,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.policyVersion.update({
        where: { id: version.id },
        data: { fileName: null, mimeType: null, fileSize: null, storagePath: null },
        include: this.versionTargetingInclude,
      });
      await tx.policyDocument.update({
        where: { id: document.id },
        data: { source: PolicyDocumentSource.EDITOR, updatedById: user.id },
      });
      return next;
    });

    await this.deleteDraftFileIfSafe(version);

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.POLICY,
      action: 'policy_document_removed',
      recordType: 'PolicyVersion',
      recordId: version.id,
      newValues: {
        documentId: document.id,
        versionId: version.id,
        fileName: snapshot.fileName,
        mimeType: snapshot.mimeType,
        fileSize: snapshot.fileSize,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.mapVersion(updated);
  }

  async getVersionDocumentForDownload(
    user: RequestUser,
    id: string,
    versionId: string,
    disposition?: string,
  ) {
    const document = await this.requireDocument(user, id);
    const version = await this.loadVersionById(document.id, versionId);
    const current = await this.loadCurrentVersion(document);
    const ctx = await this.resolveMatchContext(user);
    await this.assertPublishedVisible(user, document, current, ctx);

    if (
      POLICY_IN_PROGRESS_STATUSES.includes(version.status) &&
      !this.isAuthorOf(user, document) &&
      !this.isUnrestricted(user)
    ) {
      throw new NotFoundException('Policy not found');
    }

    if (!version.storagePath || !version.fileName || !version.mimeType) {
      throw new NotFoundException('Policy document file not found');
    }

    const absolutePath = resolveSafePolicyPath(version.storagePath);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException('Policy document file not found');
    }

    const inline = disposition === 'inline' && version.mimeType === POLICY_UPLOAD_MIME.pdf;
    return {
      absolutePath,
      fileName: version.fileName,
      mimeType: version.mimeType,
      contentDisposition: contentDisposition(version.fileName, inline),
    };
  }

  private createVersionRow(
    user: RequestUser,
    documentId: string,
    title: string,
    source: {
      id: string;
      contentJson: Prisma.JsonValue;
      contentHtml: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      fileSize?: number | null;
      storagePath?: string | null;
      effectiveDate: Date | null;
      reviewDate: Date | null;
      acknowledgementRequired?: boolean;
    },
    nums: { versionMajor: number; versionMinor: number },
    changeSummary?: string,
    reusePreviousContent = true,
  ) {
    let copiedPath: string | null = null;
    return this.prisma
      .$transaction(async (tx) => {
        const created = await tx.policyVersion.create({
          data: {
            documentId,
            versionMajor: nums.versionMajor,
            versionMinor: nums.versionMinor,
            status: PolicyStatus.DRAFT,
            titleSnapshot: title,
            contentJson: reusePreviousContent
              ? source.contentJson === null
                ? Prisma.JsonNull
                : source.contentJson
              : Prisma.JsonNull,
            contentHtml: reusePreviousContent ? source.contentHtml : null,
            changeSummary: changeSummary ?? null,
            effectiveDate: source.effectiveDate,
            reviewDate: source.reviewDate,
            // A new version must be read again, so carry the requirement forward.
            acknowledgementRequired: source.acknowledgementRequired ?? false,
          },
        });

        if (reusePreviousContent && source.storagePath) {
          const ext = source.storagePath.includes('.')
            ? source.storagePath.slice(source.storagePath.lastIndexOf('.'))
            : '.bin';
          copiedPath = newPolicyStorageRelativePath(documentId, created.id, ext);
          copyStoredPolicyFile(source.storagePath, copiedPath);
          await tx.policyVersion.update({
            where: { id: created.id },
            data: {
              fileName: source.fileName ?? null,
              mimeType: source.mimeType ?? null,
              fileSize: source.fileSize ?? null,
              storagePath: copiedPath,
            },
          });
        }

        const sourceFull = await tx.policyVersion.findFirst({
          where: { id: source.id },
          include: this.versionTargetingInclude,
        });
        if (sourceFull) {
          await this.writeTargeting(
            tx,
            created.id,
            user.id,
            sourceFull.applicability,
            sourceFull.audiences,
            sourceFull.links,
          );
        }

        await tx.policyDocument.update({
          where: { id: documentId },
          data: { updatedById: user.id },
        });
        return tx.policyVersion.findFirstOrThrow({
          where: { id: created.id },
          include: this.versionTargetingInclude,
        });
      })
      .catch((err: unknown) => {
        if (copiedPath) deleteStoredPolicyFile(copiedPath);
        throw err;
      });
  }

  private createTransaction(
    user: RequestUser,
    dto: CreatePolicyDto,
    reference: string,
    applicability: PolicyApplicabilityRow[],
    audiences: PolicyAudienceRow[],
    links: Array<PolicyLinkRow & { label?: string | null }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.policyDocument.create({
        data: {
          title: dto.title.trim(),
          reference,
          description: dto.description?.trim() || null,
          documentType: dto.documentType,
          source: dto.source ?? PolicyDocumentSource.EDITOR,
          primaryCategoryId: dto.primaryCategoryId,
          parentDocumentId: dto.parentDocumentId ?? null,
          status: PolicyStatus.DRAFT,
          ownerId: dto.ownerId ?? user.id,
          reviewerId: dto.reviewerId ?? null,
          approverId: dto.approverId ?? null,
          createdById: user.id,
          updatedById: user.id,
        },
        include: this.documentDetailInclude,
      });

      const version = await tx.policyVersion.create({
        data: {
          documentId: document.id,
          versionMajor: 1,
          versionMinor: 0,
          status: PolicyStatus.DRAFT,
          titleSnapshot: document.title,
          contentJson: dto.contentJson === undefined ? undefined : (dto.contentJson as Prisma.InputJsonValue),
          contentHtml: dto.contentHtml ?? null,
          effectiveDate: this.toDateOnly(dto.effectiveDate) ?? null,
          reviewDate: this.toDateOnly(dto.reviewDate) ?? null,
          acknowledgementRequired: dto.acknowledgementRequired ?? true,
        },
      });

      await this.writeTargeting(tx, version.id, user.id, applicability, audiences, links);
      await this.replaceDocumentTags(tx, document.id, dto.tagIds);

      const updated = await tx.policyDocument.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
        include: this.documentDetailInclude,
      });
      const versionFull = await tx.policyVersion.findFirstOrThrow({
        where: { id: version.id },
        include: this.versionTargetingInclude,
      });

      return { document: updated, version: versionFull };
    });
  }

  private async setWorkingStatus(
    documentId: string,
    versionId: string,
    status: PolicyStatus,
    userId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const version = await tx.policyVersion.update({
        where: { id: versionId },
        data: { status },
      });
      const published = await tx.policyVersion.findFirst({
        where: { documentId, status: PolicyStatus.PUBLISHED },
      });
      const document = await tx.policyDocument.update({
        where: { id: documentId },
        data: {
          status: published ? PolicyStatus.PUBLISHED : status,
          updatedById: userId,
        },
        include: this.documentDetailInclude,
      });
      const versionFull = await tx.policyVersion.findFirst({
        where: { id: versionId },
        include: this.versionTargetingInclude,
      });
      return { document, version: versionFull ?? version };
    });
    return this.mapDocument(result.document, this.mapVersion(result.version));
  }
}
