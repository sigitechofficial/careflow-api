import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { renderHtmlToPdfBuffer } from '../common/utils/html-to-pdf.util';
import { safeUploadPath } from '../common/utils/upload-path.util';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { PoliciesService } from './policies.service';
import { PolicyLibraryService } from './policy-library.service';
import {
  POLICY_KIND_LABELS,
  exportDate,
  exportFileName,
  policyExportDocx,
  policyExportHtml,
  policyPdfFooter,
  type PolicyExportModel,
} from './policy-export.util';

export type PolicyExportFormat = 'pdf' | 'docx';
export const POLICY_EXPORT_FORMATS: readonly PolicyExportFormat[] = ['pdf', 'docx'];

const STATUS_WORDS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved, not yet published',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export type PolicyExportFile = { buffer: Buffer; fileName: string; contentType: string };

/**
 * Policies to download as PDF or Word: your own (any version you may see) and ready-made ones from the library.
 * The same model feeds both formats (policy-export.util.ts), matching the admin app's print page.
 */
@Injectable()
export class PolicyExportService {
  private readonly logger = new Logger(PolicyExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PoliciesService,
    private readonly library: PolicyLibraryService,
    @Optional() private readonly orgSettings?: OrganisationGeneralSettingsService,
  ) {}

  /** One of your policies: the version asked for, else its current version. Uploaded documents are downloaded as they are. */
  async exportPolicy(user: RequestUser, id: string, format: PolicyExportFormat, versionId?: string): Promise<PolicyExportFile> {
    const doc = (await this.policies.getById(user, id)) as unknown as PolicyDocRow;
    const version = (versionId ? await this.policies.getVersion(user, id, versionId) : doc.currentVersion) as unknown as PolicyVersionRow | null;
    if (!version) throw new BadRequestException('This policy has no version to download yet.');
    if (version.hasDocument || version.contentKind === 'UPLOAD') {
      throw new BadRequestException('This policy is an uploaded document: use Download on the policy to get it as it was uploaded.');
    }
    const isDraft = version.status !== 'PUBLISHED';
    const kind = POLICY_KIND_LABELS[doc.documentType] ?? 'Policy';
    const tz = await this.timeZone();
    const model = await this.base(user, {
      kindLabel: kind,
      reference: doc.reference,
      title: doc.title,
      summary: doc.description || null,
      notice: isDraft ? { tone: 'draft', text: `Draft. This version (${version.versionLabel}) is not published. Do not use it as the current policy.` } : null,
      watermark: isDraft ? 'DRAFT' : null,
      details: [
        ['Reference', doc.reference],
        ['Version', version.versionLabel],
        ['Status', STATUS_WORDS[version.status] ?? version.status],
        ['Effective date', exportDate(version.effectiveDate, tz)],
        ['Review date', exportDate(version.reviewDate, tz)],
        ['Published', exportDate(version.publishedAt, tz)],
        ['Category', doc.primaryCategory?.name ?? '—'],
        ['Type', kind],
      ],
      contentHtml: version.contentHtml?.trim() || '<p>This version has no text yet.</p>',
      appendix: null,
      footer: `${doc.reference} · ${doc.title} · ${version.versionLabel}${isDraft ? ' · DRAFT' : ''}`,
      timeZone: tz,
    });
    return this.render(model, format, [doc.reference, doc.title, version.versionLabel, isDraft ? 'DRAFT' : '']);
  }

  /** A ready-made policy from the library, with the organisation's name filled in (as the reader shows it). */
  async exportLibraryPolicy(user: RequestUser, id: string, format: PolicyExportFormat): Promise<PolicyExportFile> {
    const { data: p } = (await this.library.get(id)) as unknown as { data: LibraryRow };
    const kind = POLICY_KIND_LABELS[p.documentType] ?? 'Policy';
    const tz = await this.timeZone();
    const model = await this.base(user, {
      kindLabel: kind,
      reference: p.reference,
      title: p.title,
      summary: p.summary || null,
      notice: {
        tone: 'info',
        text: p.adoptedPolicyId
          ? `Ready-made ${kind.toLowerCase()} from the CareFlow policy library (revision ${p.revision}). Your organisation has adopted it: its own copy in Policies is the version staff follow.`
          : `Ready-made ${kind.toLowerCase()} from the CareFlow policy library (revision ${p.revision}). It is not your organisation’s policy until it is adopted, reviewed and published.`,
      },
      watermark: null,
      details: [
        ['Reference', p.reference],
        ['Revision', String(p.revision)],
        ['Category', p.category?.name ?? '—'],
        ['Type', kind],
        ['Researched', exportDate(p.researchedOn, tz)],
        ['Review', `Every ${p.reviewFrequencyMonths} months`],
      ],
      contentHtml: p.contentHtml?.trim() || '<p>No text.</p>',
      appendix: p.regulatoryBasis?.length
        ? { heading: 'Legislation and guidance', items: p.regulatoryBasis.map((r) => ({ text: r.source, url: r.url || null })) }
        : null,
      footer: `${p.reference} · ${p.title} · ready-made revision ${p.revision}`,
      timeZone: tz,
    });
    return this.render(model, format, [p.reference, p.title, 'ready-made']);
  }

  private async render(model: PolicyExportModel, format: PolicyExportFormat, nameParts: string[]): Promise<PolicyExportFile> {
    if (format === 'docx') {
      return {
        buffer: await policyExportDocx(model),
        fileName: exportFileName(nameParts, 'docx'),
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
    }
    const buffer = await renderHtmlToPdfBuffer(policyExportHtml(model), {
      format: 'A4',
      preferCSSPageSize: false,
      footerTemplate: policyPdfFooter(model),
      margin: { top: '18mm', right: '17mm', bottom: '20mm', left: '17mm' },
    });
    return { buffer, fileName: exportFileName(nameParts, 'pdf'), contentType: 'application/pdf' };
  }

  /** The parts every document shares: the organisation, its logo, who printed it and when. */
  private async base(
    user: RequestUser,
    rest: Omit<PolicyExportModel, 'organisation' | 'logo' | 'printedBy' | 'printedAt'>,
  ): Promise<PolicyExportModel> {
    const [profile, me] = await Promise.all([
      this.prisma.companyProfile
        .findFirst({ select: { displayName: true, companyName: true, displayLogoUrl: true, companyLogoUrl: true } })
        .catch(() => null),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { firstName: true, lastName: true, email: true } }).catch(() => null),
    ]);
    return {
      ...rest,
      organisation: profile?.displayName || profile?.companyName || '',
      logo: await this.logo(profile?.displayLogoUrl || profile?.companyLogoUrl || null),
      printedBy: [me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.email || '',
      printedAt: new Date(),
    };
  }

  /** The organisation's logo from the uploads folder (PNG or JPEG only); none when missing or another type. */
  private async logo(url: string | null): Promise<PolicyExportModel['logo']> {
    const path = safeUploadPath(url);
    if (!path) return null;
    try {
      const data = await readFile(path);
      if (data.readUInt32BE(0) === 0x89504e47) return { data, type: 'png' };
      if (data[0] === 0xff && data[1] === 0xd8) return { data, type: 'jpg' };
      return null;
    } catch (e) {
      this.logger.warn(`Policy export: logo not read (${e instanceof Error ? e.name : 'error'})`);
      return null;
    }
  }

  private async timeZone(): Promise<string> {
    return (await this.orgSettings?.getOperationalTimezone().catch(() => null)) || 'Europe/London';
  }
}

type PolicyVersionRow = {
  id: string;
  status: string;
  versionLabel: string;
  contentHtml: string | null;
  hasDocument: boolean;
  contentKind: string;
  effectiveDate: string | null;
  reviewDate: string | null;
  publishedAt: string | null;
};
type PolicyDocRow = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  documentType: string;
  primaryCategory: { name: string } | null;
  currentVersion: PolicyVersionRow | null;
};
type LibraryRow = {
  reference: string;
  title: string;
  summary: string;
  documentType: string;
  category: { name: string } | null;
  revision: number;
  researchedOn: string;
  reviewFrequencyMonths: number;
  regulatoryBasis: Array<{ source: string; url: string }>;
  adoptedPolicyId: string | null;
  contentHtml: string;
};
