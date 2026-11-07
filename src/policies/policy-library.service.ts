import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PolicyAudienceTargetType,
  PolicyDocumentSource,
  PolicyLinkModuleType,
  PolicyLinkScope,
  PolicyStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PoliciesService } from './policies.service';
import type { CreatePolicyDto, UpdatePolicyDto } from './dto/policy.dto';
import { POLICY_IN_PROGRESS_STATUSES } from './policy-status';

/** Policy stored on a catalogue document's version (prisma/seed-lib/policy-library.ts). */
type LibraryPolicy = {
  reference: string;
  revision: number;
  revisionNote?: string;
  title: string;
  summary: string;
  keyPoints: { intro: string; points: string[] };
  reviewFrequencyMonths: number;
  acknowledgementRequired: boolean;
  audience: string[];
  moduleLinks: string[];
  relatedReferences: string[];
  regulatoryBasis: Array<{ source: string; url: string }>;
  sections: Array<{ heading: string; subsections?: Array<{ heading: string }> }>;
};

type LibraryContent = { type: 'library'; version: 2; researchedOn: string; wordCount: number; policy: LibraryPolicy };

function libraryContent(value: Prisma.JsonValue | null | undefined): LibraryContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return v.type === 'library' && v.version === 2 && v.policy && typeof v.policy === 'object'
    ? (v as unknown as LibraryContent)
    : null;
}

type AdoptedCopy = { policyId: string; libraryRevision: number | null };

const ORGANISATION_TOKEN = '{{organisation}}';
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Most policies can be adopted in one go, but not the whole library by accident. */
const MAX_ADOPT = 50;

const catalogueSelect = {
  id: true,
  title: true,
  description: true,
  documentType: true,
  primaryCategoryId: true,
  currentVersionId: true,
  primaryCategory: { select: { id: true, name: true, code: true, displayOrder: true } },
} satisfies Prisma.PolicyDocumentSelect;

/**
 * Policies → Ready-made policies: complete policies (catalogue documents) an organisation adopts
 * as its own DRAFT policies. `{{organisation}}` in the text becomes the organisation's name from the
 * company profile. Adopting goes through PoliciesService.create, so references, category,
 * audiences, page links and the audit trail work exactly as for a policy written from scratch.
 */
@Injectable()
export class PolicyLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PoliciesService,
  ) {}

  async list() {
    const docs = await this.prisma.policyDocument.findMany({
      where: { isCatalogue: true, deletedAt: null, isActive: true },
      orderBy: { reference: 'asc' },
      select: catalogueSelect,
    });
    const contentById = await this.contentByVersion(docs.map((d) => d.currentVersionId));
    const titleByRef = new Map(
      docs.flatMap((d) => {
        const c = contentById.get(d.currentVersionId ?? '');
        return c ? [[c.policy.reference, d.title] as const] : [];
      }),
    );
    const adopted = await this.adoptedCopies(
      docs.map((d) => ({ id: d.id, reference: contentById.get(d.currentVersionId ?? '')?.policy.reference })),
    );
    return {
      data: docs.flatMap((d) => {
        const content = contentById.get(d.currentVersionId ?? '');
        return content ? [this.summaryOf(d, content, adopted, titleByRef)] : [];
      }),
    };
  }

  /** One policy with its full text, the organisation's name filled in. */
  async get(id: string) {
    const doc = await this.prisma.policyDocument.findFirst({
      where: { id, isCatalogue: true, deletedAt: null, isActive: true },
      select: catalogueSelect,
    });
    const version = doc?.currentVersionId
      ? await this.prisma.policyVersion.findUnique({
          where: { id: doc.currentVersionId },
          select: { contentJson: true, contentHtml: true },
        })
      : null;
    const content = libraryContent(version?.contentJson);
    if (!doc || !version || !content) throw new NotFoundException('Policy not found in the library');
    const related = await this.prisma.policyDocument.findMany({
      where: { isCatalogue: true, deletedAt: null, reference: { in: content.policy.relatedReferences.map((r) => `LIB-${r}`) } },
      select: { reference: true, title: true },
    });
    const titleByRef = new Map(related.map((r) => [r.reference.replace(/^LIB-/, ''), r.title]));
    const adopted = await this.adoptedCopies([{ id: doc.id, reference: content.policy.reference }]);
    return {
      data: {
        ...this.summaryOf(doc, content, adopted, titleByRef),
        contentHtml: await this.withOrganisationName(version.contentHtml ?? ''),
      },
    };
  }

  /**
   * Adopt policies as drafts. Each keeps the library reference (e.g. POL-SG-001); one already
   * adopted, or whose reference is already used, is skipped and reported.
   */
  async adopt(user: RequestUser, ids: string[], meta?: RequestAuditMeta) {
    const unique = [...new Set(ids)];
    if (!unique.length) throw new BadRequestException('Choose at least one policy');
    if (unique.length > MAX_ADOPT) throw new BadRequestException(`Adopt at most ${MAX_ADOPT} policies at a time`);
    const docs = await this.prisma.policyDocument.findMany({
      where: { id: { in: unique }, isCatalogue: true, deletedAt: null, isActive: true },
      select: catalogueSelect,
    });
    if (docs.length !== unique.length) throw new BadRequestException('Some policies were not found in the library');

    const [versions, roles, organisationName] = await Promise.all([
      this.prisma.policyVersion.findMany({
        where: { id: { in: docs.map((d) => d.currentVersionId).filter((v): v is string => Boolean(v)) } },
        select: { id: true, contentJson: true, contentHtml: true },
      }),
      this.prisma.role.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, name: true } }),
      this.organisationName(),
    ]);
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const roleId = new Map(roles.map((r) => [r.name, r.id]));
    const alreadyAdopted = await this.adoptedCopies(
      docs.map((d) => ({ id: d.id, reference: libraryContent(versionById.get(d.currentVersionId ?? '')?.contentJson)?.policy.reference })),
    );

    const created: Array<{ libraryId: string; policyId: string; reference: string; title: string }> = [];
    const skipped: Array<{ libraryId: string; reference: string; title: string; reason: string }> = [];
    for (const doc of docs) {
      const version = versionById.get(doc.currentVersionId ?? '');
      const content = libraryContent(version?.contentJson);
      if (!version || !content) {
        skipped.push({ libraryId: doc.id, reference: '', title: doc.title, reason: 'The policy has no content' });
        continue;
      }
      const p = content.policy;
      if (alreadyAdopted.has(doc.id)) {
        skipped.push({ libraryId: doc.id, reference: p.reference, title: doc.title, reason: 'Already adopted' });
        continue;
      }
      const html = this.fillOrganisation(version.contentHtml ?? '', organisationName);
      const audiences = p.audience.includes('ALL_EMPLOYEES')
        ? [{ targetType: PolicyAudienceTargetType.ALL_EMPLOYEES }]
        : p.audience
            .map((name) => roleId.get(name))
            .filter((id): id is string => Boolean(id))
            .map((id) => ({ targetType: PolicyAudienceTargetType.ROLE, roleId: id }));
      const dto = {
        title: doc.title,
        reference: p.reference,
        documentType: doc.documentType,
        primaryCategoryId: doc.primaryCategoryId,
        description: doc.description ?? undefined,
        contentHtml: html,
        // The editor works from the HTML; libraryReference ties the draft back to the library.
        contentJson: { type: 'text', version: 1, text: html, libraryReference: p.reference, researchedOn: content.researchedOn },
        applicability: [{ organisationWide: true }],
        audiences: audiences.length ? audiences : [{ targetType: PolicyAudienceTargetType.ALL_EMPLOYEES }],
        links: p.moduleLinks.map((m) => ({ moduleType: m as PolicyLinkModuleType, scope: PolicyLinkScope.MODULE })),
      } as unknown as CreatePolicyDto;
      try {
        const policy = (await this.policies.create(user, dto, meta)) as { id: string };
        await this.prisma.$transaction([
          this.prisma.policyVersion.updateMany({
            where: { documentId: policy.id },
            data: { acknowledgementRequired: p.acknowledgementRequired },
          }),
          this.prisma.policyDocument.update({
            where: { id: policy.id },
            data: { libraryDocumentId: doc.id, libraryRevision: p.revision },
          }),
        ]);
        created.push({ libraryId: doc.id, policyId: policy.id, reference: p.reference, title: doc.title });
      } catch (err) {
        skipped.push({
          libraryId: doc.id,
          reference: p.reference,
          title: doc.title,
          reason: err instanceof Error ? err.message : 'Could not create the draft',
        });
      }
    }
    return {
      message: `${created.length} draft polic${created.length === 1 ? 'y' : 'ies'} created`,
      data: { created, skipped },
    };
  }

  /** The ready-made policy an organisation's policy was adopted from, and whether it has been updated since. */
  async forPolicy(policyId: string) {
    const target = await this.prisma.policyDocument.findFirst({
      where: { id: policyId, isCatalogue: false, deletedAt: null },
      select: { libraryDocumentId: true, libraryRevision: true },
    });
    if (!target?.libraryDocumentId) return { data: null };
    const library = await this.loadCatalogue(target.libraryDocumentId);
    if (!library) return { data: null };
    const p = library.content.policy;
    const adoptedRevision = target.libraryRevision ?? 1;
    return {
      data: {
        libraryId: library.doc.id,
        reference: p.reference,
        title: library.doc.title,
        adoptedRevision,
        currentRevision: p.revision,
        revisionNote: p.revisionNote ?? null,
        updateAvailable: adoptedRevision < p.revision,
      },
    };
  }

  /**
   * Bring an adopted policy up to the latest ready-made revision. The update goes into a draft so it
   * is reviewed, approved and published as usual: a new major version when the policy is published
   * (staff acknowledge it again), or the existing draft. The previous text stays in the version history.
   */
  async applyUpdate(user: RequestUser, policyId: string, meta?: RequestAuditMeta) {
    const target = await this.prisma.policyDocument.findFirst({
      where: { id: policyId, isCatalogue: false, deletedAt: null },
      select: { id: true, libraryDocumentId: true, libraryRevision: true },
    });
    if (!target?.libraryDocumentId) throw new NotFoundException('This policy was not adopted from the ready-made policies');
    const library = await this.loadCatalogue(target.libraryDocumentId);
    if (!library) throw new NotFoundException('The ready-made policy is no longer available');
    const p = library.content.policy;
    if (p.revision <= (target.libraryRevision ?? 1)) {
      throw new BadRequestException('This policy is already based on the latest ready-made version');
    }

    const inProgress = await this.prisma.policyVersion.findFirst({
      where: { documentId: target.id, status: { in: POLICY_IN_PROGRESS_STATUSES } },
      select: { status: true },
    });
    if (inProgress && inProgress.status !== PolicyStatus.DRAFT) {
      throw new BadRequestException(
        'A version of this policy is in review or approved. Publish it, or request changes to return it to draft, before applying the update.',
      );
    }
    const changeSummary = `Updated to ready-made policy revision ${p.revision}${p.revisionNote ? `: ${p.revisionNote}` : ''}`;
    if (!inProgress) {
      await this.policies.createVersion(user, target.id, { bump: 'major', changeSummary, reusePreviousContent: true }, meta);
    }
    const html = this.fillOrganisation(library.version.contentHtml ?? '', await this.organisationName());
    await this.policies.update(
      user,
      target.id,
      {
        source: PolicyDocumentSource.EDITOR,
        contentHtml: html,
        contentJson: { type: 'text', version: 1, text: html, libraryReference: p.reference, libraryRevision: p.revision },
      } as unknown as UpdatePolicyDto,
      meta,
    );
    await this.prisma.policyDocument.update({ where: { id: target.id }, data: { libraryRevision: p.revision } });
    return {
      message: `The draft now has ready-made revision ${p.revision}. Review the changes, then send it for review.`,
      data: { policyId: target.id, revision: p.revision },
    };
  }

  private async loadCatalogue(id: string) {
    const doc = await this.prisma.policyDocument.findFirst({
      where: { id, isCatalogue: true, deletedAt: null, isActive: true },
      select: catalogueSelect,
    });
    const version = doc?.currentVersionId
      ? await this.prisma.policyVersion.findUnique({
          where: { id: doc.currentVersionId },
          select: { contentJson: true, contentHtml: true },
        })
      : null;
    const content = libraryContent(version?.contentJson);
    return doc && version && content ? { doc, version, content } : null;
  }

  private summaryOf(
    d: Prisma.PolicyDocumentGetPayload<{ select: typeof catalogueSelect }>,
    content: LibraryContent,
    adopted: Map<string, AdoptedCopy>,
    titleByRef: Map<string, string>,
  ) {
    const p = content.policy;
    const copy = adopted.get(d.id);
    return {
      id: d.id,
      reference: p.reference,
      title: d.title,
      summary: d.description ?? p.summary,
      documentType: d.documentType,
      category: d.primaryCategory,
      researchedOn: content.researchedOn,
      wordCount: content.wordCount,
      revision: p.revision,
      revisionNote: p.revisionNote ?? null,
      keyPoints: p.keyPoints,
      reviewFrequencyMonths: p.reviewFrequencyMonths,
      acknowledgementRequired: p.acknowledgementRequired,
      audience: p.audience,
      moduleLinks: p.moduleLinks,
      sectionHeadings: p.sections.map((s) => s.heading),
      regulatoryBasis: p.regulatoryBasis,
      related: p.relatedReferences.map((r) => ({ reference: r, title: titleByRef.get(r) ?? null })),
      adoptedPolicyId: copy?.policyId ?? null,
      adoptedRevision: copy?.libraryRevision ?? null,
      updateAvailable: Boolean(copy && (copy.libraryRevision ?? 1) < p.revision),
    };
  }

  private async contentByVersion(versionIds: Array<string | null>) {
    const versions = await this.prisma.policyVersion.findMany({
      where: { id: { in: versionIds.filter((v): v is string => Boolean(v)) } },
      select: { id: true, contentJson: true },
    });
    const map = new Map<string, LibraryContent>();
    for (const v of versions) {
      const c = libraryContent(v.contentJson);
      if (c) map.set(v.id, c);
    }
    return map;
  }

  private async organisationName(): Promise<string> {
    const profile = await this.prisma.companyProfile.findFirst({ select: { companyName: true } });
    return profile?.companyName?.trim() || 'the organisation';
  }

  private fillOrganisation(html: string, name: string) {
    return html.split(ORGANISATION_TOKEN).join(escapeHtml(name));
  }

  private async withOrganisationName(html: string) {
    return this.fillOrganisation(html, await this.organisationName());
  }

  /**
   * Catalogue document id → the organisation's policy adopted from it. Linked by libraryDocumentId;
   * a policy adopted before that link existed is found by its library reference.
   */
  private async adoptedCopies(catalogue: Array<{ id: string; reference?: string }>): Promise<Map<string, AdoptedCopy>> {
    if (!catalogue.length) return new Map();
    const linked = await this.prisma.policyDocument.findMany({
      where: { libraryDocumentId: { in: catalogue.map((c) => c.id) }, isCatalogue: false, deletedAt: null },
      select: { id: true, libraryDocumentId: true, libraryRevision: true },
    });
    const map = new Map<string, AdoptedCopy>(
      linked.map((d) => [d.libraryDocumentId!, { policyId: d.id, libraryRevision: d.libraryRevision }]),
    );
    const unlinked = catalogue.filter((c) => !map.has(c.id) && c.reference);
    if (unlinked.length) {
      const byReference = await this.prisma.policyDocument.findMany({
        where: { reference: { in: unlinked.map((c) => c.reference!) }, isCatalogue: false, deletedAt: null },
        select: { id: true, reference: true, libraryRevision: true },
      });
      const idByRef = new Map(unlinked.map((c) => [c.reference!, c.id]));
      for (const d of byReference) map.set(idByRef.get(d.reference)!, { policyId: d.id, libraryRevision: d.libraryRevision });
    }
    return map;
  }
}
