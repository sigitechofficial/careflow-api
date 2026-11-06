import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'fs';
import { PolicyAcknowledgementStatus, PolicyStatus, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { sanitizeOptionalRichTextHtml } from '../common/utils/rich-text-html.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  POLICY_ACKNOWLEDGEMENT_CHANNEL,
  POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
  acknowledgementClockStart,
  acknowledgementDueAt,
  buildEmployeeMatchContext,
  employeeInManagerScope,
  employmentBranchIds,
  identityRoleNameForRbacLevel,
  resolveAcknowledgementState,
  summariseAcknowledgementStates,
  type AckRow,
  type AckVersionRow,
  type AcknowledgementState,
  type PolicyAcknowledgementChannel,
} from './policy-acknowledgement-rules';
import { formatVersionLabel } from './policy-status';
import { policyIsVisible, type PolicyMatchContext } from './policy-targeting';
import { contentDisposition, POLICY_UPLOAD_MIME, resolveSafePolicyPath } from './policy-upload.util';

const employeeSelect = {
  id: true,
  createdAt: true,
  personalDetail: { select: { firstName: true, lastName: true, email: true } },
  employment: {
    select: {
      roleId: true,
      jobTitleId: true,
      workAreaId: true,
      locationId: true,
      baseLocationId: true,
      startDate: true,
      floorLocations: { select: { locationId: true } },
      rbacLevel: { select: { name: true } },
      jobTitle: { select: { name: true } },
      location: { select: { name: true } },
      baseLocation: { select: { name: true } },
    },
  },
} satisfies Prisma.EmployeeSelect;

type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

/** An active employee with the policy match context built from their employment. */
export type AcknowledgementSubject = {
  employeeId: string;
  name: string;
  email: string | null;
  branchIds: string[];
  branchName: string | null;
  jobTitle: string | null;
  startedAt: Date;
  /** Active web user account with the same email (receives in-app notifications). */
  linkedUserId: string | null;
  ctx: PolicyMatchContext;
};

const requiredVersionInclude = {
  applicability: true,
  audiences: true,
  document: {
    select: {
      id: true,
      reference: true,
      title: true,
      currentVersionId: true,
      primaryCategory: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PolicyVersionInclude;

export type RequiredVersion = Prisma.PolicyVersionGetPayload<{ include: typeof requiredVersionInclude }>;

/** An acknowledgement row as loaded for status and reminders. */
export type LoadedAck = AckRow & { employeeId: string; metadata: Prisma.JsonValue | null; updatedAt: Date };

/** A staff member who still has to acknowledge the current published version of a policy. */
export type OutstandingAcknowledgement = {
  version: RequiredVersion;
  subject: AcknowledgementSubject;
  state: AcknowledgementState;
  /** This employee's row for the current version, when one exists. */
  row: LoadedAck | null;
};

type Actor = {
  channel: PolicyAcknowledgementChannel;
  /** Web user account that acted (null in the Employee App). */
  userId: string | null;
  /** Employee portal account id, for the audit trail of Employee App actions. */
  portalAccountId?: string | null;
};

type MyPolicyItem = Awaited<ReturnType<PolicyAcknowledgementsService['requiredItemsForSubject']>>[number];

const ACTIVE_EMPLOYEE_WHERE = { deletedAt: null, isActive: true } satisfies Prisma.EmployeeWhereInput;

const NO_EMPLOYEE_MESSAGE =
  'Your account is not linked to an employee record (no active employee has your email address), so there are no policies for you to acknowledge.';

@Injectable()
export class PolicyAcknowledgementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Subjects (employees) and their match context
  // ---------------------------------------------------------------------------

  /** Active employee whose personal email matches the signed-in user (as resolveMatchContext does). */
  async findEmployeeIdForUser(user: RequestUser): Promise<string | null> {
    if (user.accountKind === 'employee' && user.employeeId) return user.employeeId;
    if (!user.email) return null;
    const personal = await this.prisma.employeePersonalDetail.findFirst({
      where: {
        email: { equals: user.email, mode: 'insensitive' },
        employee: ACTIVE_EMPLOYEE_WHERE,
      },
      select: { employeeId: true },
    });
    return personal?.employeeId ?? null;
  }

  private async loadSubject(employeeId: string): Promise<AcknowledgementSubject | null> {
    const row = await this.prisma.employee.findFirst({
      where: { id: employeeId, ...ACTIVE_EMPLOYEE_WHERE },
      select: employeeSelect,
    });
    if (!row) return null;
    const [subject] = await this.toSubjects([row]);
    return subject ?? null;
  }

  private async loadAllSubjects(): Promise<AcknowledgementSubject[]> {
    const rows = await this.prisma.employee.findMany({
      where: ACTIVE_EMPLOYEE_WHERE,
      select: employeeSelect,
    });
    return this.toSubjects(rows);
  }

  /**
   * Identity roles for each employee: the role implied by the employment RBAC level plus the roles
   * of a linked User account (same email). PolicyAudience ROLE rows reference identity roles.
   */
  private async toSubjects(rows: EmployeeRow[]): Promise<AcknowledgementSubject[]> {
    if (!rows.length) return [];
    const emails = [
      ...new Set(
        rows
          .map((row) => row.personalDetail?.email?.trim().toLowerCase())
          .filter((email): email is string => !!email),
      ),
    ];
    const rbacRoleNames = [
      ...new Set(
        rows
          .map((row) => identityRoleNameForRbacLevel(row.employment?.rbacLevel?.name))
          .filter((name): name is string => !!name),
      ),
    ];

    const [users, roles] = await Promise.all([
      emails.length
        ? this.prisma.user.findMany({
            where: {
              deletedAt: null,
              isActive: true,
              // Office users are few; for a whole-workforce load read them all instead of a huge OR.
              ...(emails.length <= 50
                ? { OR: emails.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) }
                : {}),
            },
            select: { id: true, email: true, userRoles: { select: { roleId: true } } },
          })
        : Promise.resolve([]),
      rbacRoleNames.length
        ? this.prisma.role.findMany({
            where: { name: { in: rbacRoleNames }, deletedAt: null },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const userRolesByEmail = new Map<string, string[]>();
    const userIdByEmail = new Map<string, string>();
    for (const user of users) {
      const key = user.email.trim().toLowerCase();
      userRolesByEmail.set(key, user.userRoles.map((ur) => ur.roleId));
      userIdByEmail.set(key, user.id);
    }
    const roleIdByName = new Map(roles.map((role) => [role.name, role.id]));

    return rows.map((row) => {
      const employment = row.employment;
      const email = row.personalDetail?.email?.trim() || null;
      const identityRoleIds = [...(email ? userRolesByEmail.get(email.toLowerCase()) ?? [] : [])];
      const rbacRoleName = identityRoleNameForRbacLevel(employment?.rbacLevel?.name);
      const rbacRoleId = rbacRoleName ? roleIdByName.get(rbacRoleName) : undefined;
      if (rbacRoleId) identityRoleIds.push(rbacRoleId);

      const name = [row.personalDetail?.firstName, row.personalDetail?.lastName]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ');
      return {
        employeeId: row.id,
        name: name || 'Unnamed employee',
        email,
        branchIds: employmentBranchIds(employment),
        branchName: employment?.location?.name ?? employment?.baseLocation?.name ?? null,
        jobTitle: employment?.jobTitle?.name ?? null,
        startedAt: employment?.startDate ?? row.createdAt,
        linkedUserId: email ? userIdByEmail.get(email.toLowerCase()) ?? null : null,
        ctx: buildEmployeeMatchContext({ employment, identityRoleIds }),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Required versions
  // ---------------------------------------------------------------------------

  /** Current PUBLISHED versions that need acknowledging (staff policies only, never catalogue). */
  private async loadRequiredVersions(documentId?: string): Promise<RequiredVersion[]> {
    return this.prisma.policyVersion.findMany({
      where: {
        status: PolicyStatus.PUBLISHED,
        acknowledgementRequired: true,
        ...(documentId ? { documentId } : {}),
        document: { deletedAt: null, isCatalogue: false },
      },
      include: requiredVersionInclude,
      orderBy: { titleSnapshot: 'asc' },
    });
  }

  private appliesTo(version: RequiredVersion, subject: AcknowledgementSubject): boolean {
    return policyIsVisible({
      applicability: version.applicability,
      audience: version.audiences,
      ctx: subject.ctx,
      requireServiceContext: false,
    });
  }

  /** Every version of the given documents (for minor-version carry-over and the due-date clock). */
  private async loadVersionFamilies(documentIds: string[]): Promise<Map<string, AckVersionRow[]>> {
    const families = new Map<string, AckVersionRow[]>();
    if (!documentIds.length) return families;
    const rows = await this.prisma.policyVersion.findMany({
      where: { documentId: { in: documentIds }, publishedAt: { not: null } },
      select: {
        id: true,
        documentId: true,
        versionMajor: true,
        versionMinor: true,
        publishedAt: true,
        acknowledgementRequired: true,
      },
    });
    for (const row of rows) {
      const list = families.get(row.documentId) ?? [];
      list.push(row);
      families.set(row.documentId, list);
    }
    return families;
  }

  private async loadAcknowledgements(
    versionIds: string[],
    employeeIds?: string[],
  ): Promise<Map<string, LoadedAck[]>> {
    const byEmployee = new Map<string, LoadedAck[]>();
    if (!versionIds.length) return byEmployee;
    const rows = await this.prisma.policyAcknowledgement.findMany({
      where: {
        versionId: { in: versionIds },
        ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      },
      select: {
        id: true,
        versionId: true,
        employeeId: true,
        status: true,
        viewedAt: true,
        acknowledgedAt: true,
        metadata: true,
        updatedAt: true,
      },
    });
    for (const row of rows) {
      const list = byEmployee.get(row.employeeId) ?? [];
      list.push(row);
      byEmployee.set(row.employeeId, list);
    }
    return byEmployee;
  }

  private stateFor(
    version: RequiredVersion,
    family: AckVersionRow[],
    acknowledgements: AckRow[],
    subject: AcknowledgementSubject,
    now: Date,
  ): AcknowledgementState {
    const familyIds = new Set(family.map((v) => v.id));
    return resolveAcknowledgementState({
      current: version,
      versions: family,
      acknowledgements: acknowledgements.filter((row) => row.versionId === version.id || familyIds.has(row.versionId)),
      employeeStartedAt: subject.startedAt,
      now,
    });
  }

  private iso(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
  }

  private mapState(state: AcknowledgementState) {
    return {
      status: state.status,
      viewedAt: this.iso(state.viewedAt),
      acknowledgedAt: this.iso(state.acknowledgedAt),
      dueAt: this.iso(state.dueAt),
      overdue: state.overdue,
    };
  }

  // ---------------------------------------------------------------------------
  // Staff: my policies
  // ---------------------------------------------------------------------------

  private async requiredItemsForSubject(subject: AcknowledgementSubject, now = new Date()) {
    const versions = (await this.loadRequiredVersions()).filter((version) => this.appliesTo(version, subject));
    const families = await this.loadVersionFamilies(versions.map((v) => v.documentId));
    const allVersionIds = [...new Set([...families.values()].flat().map((v) => v.id).concat(versions.map((v) => v.id)))];
    const acks = (await this.loadAcknowledgements(allVersionIds, [subject.employeeId])).get(subject.employeeId) ?? [];

    return versions.map((version) => {
      const state = this.stateFor(version, families.get(version.documentId) ?? [], acks, subject, now);
      return {
        documentId: version.documentId,
        versionId: version.id,
        reference: version.document.reference,
        title: version.document.title,
        category: version.document.primaryCategory?.name ?? null,
        versionLabel: formatVersionLabel(version.versionMajor, version.versionMinor),
        publishedAt: this.iso(version.publishedAt),
        ...this.mapState(state),
      };
    });
  }

  private sortItems<T extends { status: PolicyAcknowledgementStatus; overdue: boolean; dueAt: string | null; title: string }>(
    items: T[],
  ): T[] {
    const rank = (item: T) =>
      item.status === PolicyAcknowledgementStatus.ACKNOWLEDGED ? 2 : item.overdue ? 0 : 1;
    return [...items].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.dueAt ?? '').localeCompare(b.dueAt ?? '') ||
        a.title.localeCompare(b.title),
    );
  }

  private countItems(items: Array<{ status: PolicyAcknowledgementStatus; overdue: boolean }>) {
    const acknowledged = items.filter((item) => item.status === PolicyAcknowledgementStatus.ACKNOWLEDGED).length;
    return {
      total: items.length,
      acknowledged,
      outstanding: items.length - acknowledged,
      viewed: items.filter((item) => item.status === PolicyAcknowledgementStatus.VIEWED).length,
      overdue: items.filter((item) => item.overdue).length,
    };
  }

  async listForEmployee(employeeId: string) {
    const subject = await this.loadSubject(employeeId);
    if (!subject) {
      return {
        data: {
          employeeLinked: false,
          reason: NO_EMPLOYEE_MESSAGE,
          dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
          counts: this.countItems([]),
          items: [] as MyPolicyItem[],
        },
      };
    }
    const items = this.sortItems(await this.requiredItemsForSubject(subject));
    return {
      data: {
        employeeLinked: true,
        reason: null,
        dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
        counts: this.countItems(items),
        items,
      },
    };
  }

  async listForUser(user: RequestUser) {
    const employeeId = await this.findEmployeeIdForUser(user);
    if (!employeeId) {
      return {
        data: {
          employeeLinked: false,
          reason: NO_EMPLOYEE_MESSAGE,
          dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
          counts: this.countItems([]),
          items: [] as MyPolicyItem[],
        },
      };
    }
    return this.listForEmployee(employeeId);
  }

  // ---------------------------------------------------------------------------
  // Staff: one policy (status, viewed, acknowledge)
  // ---------------------------------------------------------------------------

  /** Published, visible to the employee; required = needs acknowledging by this employee. */
  private async resolveForSubject(subject: AcknowledgementSubject, documentId: string) {
    const document = await this.prisma.policyDocument.findFirst({
      where: { id: documentId, deletedAt: null, isCatalogue: false },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Policy not found');

    const version = await this.prisma.policyVersion.findFirst({
      where: { documentId, status: PolicyStatus.PUBLISHED },
      include: requiredVersionInclude,
    });
    if (!version || !this.appliesTo(version, subject)) {
      return { version: null, visible: false, required: false, state: null };
    }
    if (!version.acknowledgementRequired) {
      return { version, visible: true, required: false, state: null };
    }
    const families = await this.loadVersionFamilies([documentId]);
    const family = families.get(documentId) ?? [];
    const acks =
      (await this.loadAcknowledgements(
        [...new Set([version.id, ...family.map((v) => v.id)])],
        [subject.employeeId],
      )).get(subject.employeeId) ?? [];
    const state = this.stateFor(version, family, acks, subject, new Date());
    return { version, visible: true, required: true, state };
  }

  private statusPayload(
    documentId: string,
    resolved: Awaited<ReturnType<PolicyAcknowledgementsService['resolveForSubject']>>,
  ) {
    const version = resolved.version;
    return {
      documentId,
      versionId: version?.id ?? null,
      versionLabel: version ? formatVersionLabel(version.versionMajor, version.versionMinor) : null,
      required: resolved.required,
      dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
      ...(resolved.state
        ? this.mapState(resolved.state)
        : { status: null, viewedAt: null, acknowledgedAt: null, dueAt: null, overdue: false }),
    };
  }

  /** Records VIEWED on the current version unless the policy is already acknowledged. */
  private async markViewed(
    subject: AcknowledgementSubject,
    resolved: Awaited<ReturnType<PolicyAcknowledgementsService['resolveForSubject']>>,
    actor: Actor,
  ) {
    if (!resolved.required || !resolved.version || !resolved.state) return resolved;
    if (resolved.state.status !== PolicyAcknowledgementStatus.PENDING) return resolved;
    const now = new Date();
    await this.prisma.policyAcknowledgement.upsert({
      where: { versionId_employeeId: { versionId: resolved.version.id, employeeId: subject.employeeId } },
      create: {
        versionId: resolved.version.id,
        employeeId: subject.employeeId,
        userId: actor.userId,
        status: PolicyAcknowledgementStatus.VIEWED,
        viewedAt: now,
        channel: actor.channel,
      },
      update: { viewedAt: now, status: PolicyAcknowledgementStatus.VIEWED, channel: actor.channel },
    });
    return {
      ...resolved,
      state: { ...resolved.state, status: PolicyAcknowledgementStatus.VIEWED, viewedAt: now },
    };
  }

  private async acknowledge(
    subject: AcknowledgementSubject,
    documentId: string,
    actor: Actor,
    meta?: RequestAuditMeta,
  ) {
    const resolved = await this.resolveForSubject(subject, documentId);
    if (!resolved.required || !resolved.version || !resolved.state) {
      throw new BadRequestException('You do not need to acknowledge this policy');
    }
    if (resolved.state.status === PolicyAcknowledgementStatus.ACKNOWLEDGED) {
      return { data: this.statusPayload(documentId, resolved), message: 'Policy already acknowledged' };
    }

    const version = resolved.version;
    const now = new Date();
    const row = await this.prisma.policyAcknowledgement.upsert({
      where: { versionId_employeeId: { versionId: version.id, employeeId: subject.employeeId } },
      create: {
        versionId: version.id,
        employeeId: subject.employeeId,
        userId: actor.userId,
        status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
        viewedAt: resolved.state.viewedAt ?? now,
        acknowledgedAt: now,
        channel: actor.channel,
      },
      update: {
        status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
        viewedAt: resolved.state.viewedAt ?? now,
        acknowledgedAt: now,
        channel: actor.channel,
        ...(actor.userId ? { userId: actor.userId } : {}),
      },
    });

    const versionLabel = formatVersionLabel(version.versionMajor, version.versionMinor);
    await this.audit.logAudit({
      userId: actor.userId ?? undefined,
      module: AuditModule.POLICY,
      action: 'policy_acknowledged',
      recordType: 'PolicyAcknowledgement',
      recordId: row.id,
      description: `${subject.name} acknowledged ${version.document.reference} ${version.document.title} (${versionLabel})`,
      newValues: {
        status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
        acknowledgedAt: now.toISOString(),
      },
      metadata: {
        employeeId: subject.employeeId,
        documentId,
        versionId: version.id,
        version: versionLabel,
        channel: actor.channel,
        ...(actor.portalAccountId ? { employeePortalAccountId: actor.portalAccountId } : {}),
        dueAt: this.iso(resolved.state.dueAt),
        overdue: resolved.state.overdue,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      data: this.statusPayload(documentId, {
        ...resolved,
        state: {
          ...resolved.state,
          status: PolicyAcknowledgementStatus.ACKNOWLEDGED,
          viewedAt: resolved.state.viewedAt ?? now,
          acknowledgedAt: now,
          acknowledgedVersionId: version.id,
          overdue: false,
        },
      }),
      message: 'Policy acknowledged',
    };
  }

  private async requireSubjectForUser(user: RequestUser): Promise<AcknowledgementSubject> {
    const employeeId = await this.findEmployeeIdForUser(user);
    const subject = employeeId ? await this.loadSubject(employeeId) : null;
    if (!subject) throw new BadRequestException(NO_EMPLOYEE_MESSAGE);
    return subject;
  }

  private async requireSubject(employeeId: string): Promise<AcknowledgementSubject> {
    const subject = await this.loadSubject(employeeId);
    if (!subject) throw new NotFoundException('Employee not found');
    return subject;
  }

  /** Web: record that the signed-in user opened the policy. Not-required policies are a no-op. */
  async recordViewedForUser(user: RequestUser, documentId: string) {
    const employeeId = await this.findEmployeeIdForUser(user);
    const subject = employeeId ? await this.loadSubject(employeeId) : null;
    if (!subject) {
      return {
        data: {
          documentId,
          versionId: null,
          versionLabel: null,
          required: false,
          dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
          status: null,
          viewedAt: null,
          acknowledgedAt: null,
          dueAt: null,
          overdue: false,
        },
      };
    }
    const resolved = await this.resolveForSubject(subject, documentId);
    const updated = await this.markViewed(subject, resolved, {
      channel: POLICY_ACKNOWLEDGEMENT_CHANNEL.WEB,
      userId: user.id,
    });
    return { data: this.statusPayload(documentId, updated) };
  }

  async acknowledgeForUser(user: RequestUser, documentId: string, meta?: RequestAuditMeta) {
    const subject = await this.requireSubjectForUser(user);
    return this.acknowledge(
      subject,
      documentId,
      { channel: POLICY_ACKNOWLEDGEMENT_CHANNEL.WEB, userId: user.id },
      meta,
    );
  }

  /** Employee App: the policy content plus my status; records VIEWED. */
  async getForEmployee(employeeId: string, documentId: string, portalAccountId?: string) {
    const subject = await this.requireSubject(employeeId);
    const resolved = await this.resolveForSubject(subject, documentId);
    if (!resolved.visible || !resolved.version) throw new NotFoundException('Policy not found');
    const updated = await this.markViewed(subject, resolved, {
      channel: POLICY_ACKNOWLEDGEMENT_CHANNEL.EMPLOYEE_APP,
      userId: null,
      portalAccountId,
    });
    const version = resolved.version;
    const isUpload = Boolean(version.storagePath);
    return {
      data: {
        documentId,
        versionId: version.id,
        reference: version.document.reference,
        title: version.document.title,
        category: version.document.primaryCategory?.name ?? null,
        versionLabel: formatVersionLabel(version.versionMajor, version.versionMinor),
        publishedAt: this.iso(version.publishedAt),
        effectiveDate: version.effectiveDate ? version.effectiveDate.toISOString().slice(0, 10) : null,
        contentKind: isUpload ? 'UPLOAD' : 'EDITOR',
        // Sanitised again on the way out: carers' devices render it, and rows saved before save-time
        // sanitising may hold anything.
        contentHtml: isUpload ? null : sanitizeOptionalRichTextHtml(version.contentHtml),
        file: isUpload
          ? {
              fileName: version.fileName,
              mimeType: version.mimeType,
              fileSize: version.fileSize,
              downloadPath: `employee-app/policies/${documentId}/document`,
            }
          : null,
        contentNote: isUpload
          ? 'This policy is an uploaded document. Download it to read it before you acknowledge.'
          : null,
        acknowledgement: this.statusPayload(documentId, updated),
      },
    };
  }

  /** Employee App: the uploaded file of the current published version, when the policy applies to me. */
  async getDocumentFileForEmployee(employeeId: string, documentId: string) {
    const subject = await this.requireSubject(employeeId);
    const resolved = await this.resolveForSubject(subject, documentId);
    const version = resolved.version;
    if (!resolved.visible || !version) throw new NotFoundException('Policy not found');
    if (!version.storagePath || !version.fileName || !version.mimeType) {
      throw new NotFoundException('Policy document file not found');
    }
    const absolutePath = resolveSafePolicyPath(version.storagePath);
    if (!existsSync(absolutePath)) throw new NotFoundException('Policy document file not found');
    return {
      absolutePath,
      fileName: version.fileName,
      mimeType: version.mimeType,
      contentDisposition: contentDisposition(version.fileName, version.mimeType === POLICY_UPLOAD_MIME.pdf),
    };
  }

  async acknowledgeForEmployee(
    employeeId: string,
    documentId: string,
    meta?: RequestAuditMeta,
    portalAccountId?: string,
  ) {
    const subject = await this.requireSubject(employeeId);
    return this.acknowledge(
      subject,
      documentId,
      { channel: POLICY_ACKNOWLEDGEMENT_CHANNEL.EMPLOYEE_APP, userId: null, portalAccountId },
      meta,
    );
  }

  // ---------------------------------------------------------------------------
  // Managers
  // ---------------------------------------------------------------------------

  /** Staff acknowledgements for the current published version, within the manager's branch scope. */
  async documentReport(user: RequestUser, documentId: string) {
    const document = await this.prisma.policyDocument.findFirst({
      where: { id: documentId, deletedAt: null, isCatalogue: false },
      select: { id: true, reference: true, title: true },
    });
    if (!document) throw new NotFoundException('Policy not found');

    const published = await this.prisma.policyVersion.findFirst({
      where: { documentId, status: PolicyStatus.PUBLISHED },
      include: requiredVersionInclude,
    });
    const base = {
      documentId,
      reference: document.reference,
      title: document.title,
      versionId: published?.id ?? null,
      versionLabel: published ? formatVersionLabel(published.versionMajor, published.versionMinor) : null,
      publishedAt: this.iso(published?.publishedAt),
      acknowledgementRequired: Boolean(published?.acknowledgementRequired),
      dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
      branchScoped: user.assignedLocationIds != null,
    };
    if (!published || !published.acknowledgementRequired) {
      return { data: { ...base, totals: summariseAcknowledgementStates([]), rows: [] } };
    }

    const subjects = (await this.loadAllSubjects()).filter(
      (subject) =>
        employeeInManagerScope(user.assignedLocationIds, subject.branchIds) && this.appliesTo(published, subject),
    );
    const family = (await this.loadVersionFamilies([documentId])).get(documentId) ?? [];
    const acks = await this.loadAcknowledgements(
      [...new Set([published.id, ...family.map((v) => v.id)])],
      subjects.map((s) => s.employeeId),
    );
    const now = new Date();
    const rows = subjects
      .map((subject) => {
        const state = this.stateFor(published, family, acks.get(subject.employeeId) ?? [], subject, now);
        return {
          employeeId: subject.employeeId,
          name: subject.name,
          branch: subject.branchName,
          jobTitle: subject.jobTitle,
          ...this.mapState(state),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return { data: { ...base, totals: summariseAcknowledgementStates(rows), rows } };
  }

  /** Per published policy needing acknowledgement: required / acknowledged / overdue (manager branch scope). */
  async summary(user: RequestUser) {
    const versions = await this.loadRequiredVersions();
    if (!versions.length) return { data: [] };
    const subjects = (await this.loadAllSubjects()).filter((subject) =>
      employeeInManagerScope(user.assignedLocationIds, subject.branchIds),
    );
    const families = await this.loadVersionFamilies(versions.map((v) => v.documentId));
    const allVersionIds = [
      ...new Set([...families.values()].flat().map((v) => v.id).concat(versions.map((v) => v.id))),
    ];
    const acks = await this.loadAcknowledgements(allVersionIds, subjects.map((s) => s.employeeId));
    const now = new Date();

    const data = versions.map((version) => {
      const family = families.get(version.documentId) ?? [];
      const states = subjects
        .filter((subject) => this.appliesTo(version, subject))
        .map((subject) => this.stateFor(version, family, acks.get(subject.employeeId) ?? [], subject, now));
      const totals = summariseAcknowledgementStates(states);
      return {
        documentId: version.documentId,
        versionId: version.id,
        reference: version.document.reference,
        title: version.document.title,
        versionLabel: formatVersionLabel(version.versionMajor, version.versionMinor),
        required: totals.required,
        acknowledged: totals.acknowledged,
        overdue: totals.overdue,
      };
    });
    return { data };
  }

  // ---------------------------------------------------------------------------
  // Notifications and reminders (see PolicyAcknowledgementNotificationsService)
  // ---------------------------------------------------------------------------

  /**
   * Every in-scope active employee who still has to acknowledge the current published version of
   * each policy needing acknowledgement (minor-version carry-over respected), with their row.
   */
  async collectOutstanding(opts: { documentId?: string; now?: Date } = {}): Promise<OutstandingAcknowledgement[]> {
    const now = opts.now ?? new Date();
    const versions = await this.loadRequiredVersions(opts.documentId);
    if (!versions.length) return [];
    const subjects = await this.loadAllSubjects();
    const families = await this.loadVersionFamilies(versions.map((v) => v.documentId));
    const allVersionIds = [
      ...new Set([...families.values()].flat().map((v) => v.id).concat(versions.map((v) => v.id))),
    ];
    const acks = await this.loadAcknowledgements(allVersionIds);
    const out: OutstandingAcknowledgement[] = [];
    for (const version of versions) {
      const family = families.get(version.documentId) ?? [];
      for (const subject of subjects) {
        if (!this.appliesTo(version, subject)) continue;
        const rows = acks.get(subject.employeeId) ?? [];
        const state = this.stateFor(version, family, rows, subject, now);
        if (state.status === PolicyAcknowledgementStatus.ACKNOWLEDGED) continue;
        out.push({ version, subject, state, row: rows.find((r) => r.versionId === version.id) ?? null });
      }
    }
    return out;
  }

  /**
   * Publish dialog: for the working (unpublished) version, how many active staff would need to read
   * and acknowledge it if it were published now, and by when. Organisation-wide (publishing is).
   */
  async publishPreview(documentId: string, now = new Date()) {
    const document = await this.prisma.policyDocument.findFirst({
      where: { id: documentId, deletedAt: null, isCatalogue: false },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Policy not found');
    const working = await this.prisma.policyVersion.findFirst({
      where: { documentId, status: { in: [PolicyStatus.DRAFT, PolicyStatus.IN_REVIEW, PolicyStatus.APPROVED] } },
      orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
      include: requiredVersionInclude,
    });
    const base = {
      documentId,
      versionId: working?.id ?? null,
      versionLabel: working ? formatVersionLabel(working.versionMajor, working.versionMinor) : null,
      acknowledgementRequired: Boolean(working?.acknowledgementRequired),
      dueWithinDays: POLICY_ACKNOWLEDGEMENT_DUE_DAYS,
    };
    if (!working || !working.acknowledgementRequired) {
      return { data: { ...base, inScope: 0, staffCount: 0, alreadyAcknowledged: 0, dueAt: null } };
    }

    // As if published now: earlier published minors of the same major still count.
    const candidate: RequiredVersion = { ...working, publishedAt: now };
    const subjects = (await this.loadAllSubjects()).filter((subject) => this.appliesTo(candidate, subject));
    const family = ((await this.loadVersionFamilies([documentId])).get(documentId) ?? []).filter(
      (v) => v.id !== candidate.id,
    );
    const acks = await this.loadAcknowledgements(
      family.map((v) => v.id),
      subjects.map((s) => s.employeeId),
    );
    let alreadyAcknowledged = 0;
    for (const subject of subjects) {
      const state = this.stateFor(candidate, family, acks.get(subject.employeeId) ?? [], subject, now);
      if (state.status === PolicyAcknowledgementStatus.ACKNOWLEDGED) alreadyAcknowledged += 1;
    }
    const dueAt = acknowledgementDueAt(acknowledgementClockStart(candidate, family));
    return {
      data: {
        ...base,
        inScope: subjects.length,
        staffCount: subjects.length - alreadyAcknowledged,
        alreadyAcknowledged,
        dueAt: this.iso(dueAt),
      },
    };
  }
}
