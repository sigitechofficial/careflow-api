import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CqcMockActionStatus,
  CqcMockInspectionStatus,
  PolicyStatus,
  Prisma,
} from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import type { OrgScope } from '../common/org-scope/org-scope.types';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { contentDisposition } from '../policies/policy-upload.util';
import { formatVersionLabel } from '../policies/policy-status';
import { PoliciesService } from '../policies/policies.service';
import { PolicyExportService } from '../policies/policy-export.service';
import { CqcEvidenceService } from '../cqc-evidence/cqc-evidence.service';
import { CqcFrameworkService } from '../cqc-evidence/cqc-framework.service';
import { buildEvidenceCsv } from '../cqc-evidence/cqc-evidence-export.util';
import { resolveSafeCqcEvidencePath } from '../cqc-evidence/cqc-evidence-upload.util';
import { CqcMockInspectionPoliciesService } from '../cqc-mock-inspection/cqc-mock-inspection-policies.service';
import {
  parseScoringRules,
  type InspectionResult,
} from '../cqc-mock-inspection/cqc-mock-inspection-scoring.util';
import type { EvidencePackQueryDto } from './dto/cqc-evidence-pack.dto';
import {
  buildEvidencePackPdf,
  type EvidencePack,
  type PackLatestInspection,
  type PackMockAction,
  type PackMockScore,
  type PackPolicy,
} from './cqc-evidence-pack-pdf.util';

/** The most the attached files of one ZIP may add up to. */
export const PACK_FILES_LIMIT_BYTES = 300 * 1024 * 1024;
const MB = 1024 * 1024;

/** Letters, digits and dashes, for folder and file names in the ZIP. */
export function packSlug(value: string, max = 50): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '') || 'item'
  );
}

/** A file name safe in a ZIP on every system (keeps the extension). */
export function safeFileName(name: string): string {
  const ext = extname(name)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const base = name.slice(0, name.length - extname(name).length);
  const clean = [...base]
    .map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch))
    .join('')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
  return `${clean || 'file'}${ext.length > 1 ? ext : ''}`;
}

type PackFile = { path: string; data: Buffer };

/** "2.3": the key question's place in the framework, then the statement's place in it (as the framework lists them). */
export function statementNumber(
  framework: {
    keyQuestions: Array<{ code: string; statements: Array<{ id: string }> }>;
  },
  s: { id: string; keyQuestionCode: string },
): string {
  const k = framework.keyQuestions.findIndex(
    (q) => q.code === s.keyQuestionCode,
  );
  if (k < 0) return '';
  const n = framework.keyQuestions[k].statements.findIndex(
    (x) => x.id === s.id,
  );
  return n < 0 ? `${k + 1}` : `${k + 1}.${n + 1}`;
}

/**
 * CQC evidence pack for an inspector: the current evidence for every quality statement (or one key question, or one
 * statement), the published policies behind each statement, and the latest mock inspection score and open actions.
 * As one PDF, or a ZIP with that PDF, the files attached to the evidence, the policies and a CSV.
 *
 * Visibility follows each source: evidence as CQC evidence shows it (branch scope, survey result access), policies as
 * the policy library shows them to this user (only with policies.read), mock inspections by branch scope.
 */
@Injectable()
export class CqcEvidencePackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly evidence: CqcEvidenceService,
    private readonly framework: CqcFrameworkService,
    private readonly policies: PoliciesService,
    private readonly policyExports: PolicyExportService,
    private readonly statementPolicies: CqcMockInspectionPoliciesService,
  ) {}

  async download(
    user: RequestUser,
    query: EvidencePackQueryDto,
    meta?: RequestAuditMeta,
    now: Date = new Date(),
  ) {
    const framework = await this.framework.active();
    let statements = framework.statements;
    let scopeTitle = 'All quality statements';
    let slug = 'all-statements';
    if (query.statementId) {
      statements = statements.filter((s) => s.id === query.statementId);
      if (!statements.length)
        throw new NotFoundException('Quality statement not found');
      scopeTitle = `${statements[0].keyQuestionTitle}: ${statements[0].title}`;
      slug = packSlug(statements[0].code);
    } else if (query.keyQuestionCode) {
      statements = statements.filter(
        (s) => s.keyQuestionCode === query.keyQuestionCode,
      );
      if (!statements.length)
        throw new NotFoundException('Key question not found');
      scopeTitle = `${statements[0].keyQuestionTitle}: every quality statement`;
      slug = packSlug(statements[0].keyQuestionCode);
    }

    const zip = query.format === 'zip';
    const withFiles = zip && query.includeFiles !== false;
    const withPolicies =
      query.includePolicies !== false &&
      user.permissions.includes('policies.read');
    const scope = this.evidence.scopeOf(user);

    const { pack: base, rows } = await this.evidence.buildExportPack(
      user,
      framework,
      statements,
      query.locationId,
      scopeTitle,
      now,
    );

    // Attached files: checked against the limit before anything is read.
    const attachments = withFiles
      ? rows.flatMap((r) => r.attachments.map((a) => ({ evidence: r, a })))
      : [];
    const totalBytes = attachments.reduce((n, x) => n + x.a.sizeBytes, 0);
    if (totalBytes > PACK_FILES_LIMIT_BYTES) {
      throw new BadRequestException(
        `The attached files add up to ${Math.ceil(totalBytes / MB)} MB, more than the ${PACK_FILES_LIMIT_BYTES / MB} MB a pack can hold. Choose one key question, or leave out the files.`,
      );
    }
    const evidenceFolder = new Map(
      rows.map((r) => [
        r.id,
        `evidence-files/${packSlug(r.title, 40)}-${r.id.slice(0, 8)}`,
      ]),
    );

    const ids = statements.map((s) => s.id);
    const [policies, mock] = await Promise.all([
      withPolicies
        ? this.policiesFor(user, statements, now)
        : Promise.resolve(new Map<string, PackPolicy[]>()),
      this.mockFor(scope, ids, query.locationId, now),
    ]);

    const pack: EvidencePack = {
      ...base,
      format: query.format,
      includesFiles: withFiles,
      includesPolicies: withPolicies,
      latestInspection: mock.latest,
      statements: base.statements.map((s, i) => ({
        ...s,
        keyQuestionCode: statements[i].keyQuestionCode,
        number: statementNumber(framework, statements[i]),
        evidence: s.evidence.map((e) => ({
          ...e,
          filesFolder:
            withFiles && e.attachments.length
              ? (evidenceFolder.get(e.id) ?? null)
              : null,
        })),
        policies: policies.get(s.id!) ?? [],
        mock: mock.scores.get(s.id!) ?? null,
        actions: mock.actions.get(s.id!) ?? [],
      })),
    };

    const stamp = now.toISOString().slice(0, 10);
    const name = `cqc-evidence-pack-${slug}${base.branchName ? `-${packSlug(base.branchName, 30)}` : ''}-${stamp}`;
    const pdf = await buildEvidencePackPdf(pack);
    let buffer = pdf;
    const notes: string[] = [];
    let fileCount = 0;
    let policyFileCount = 0;
    if (zip) {
      const files: PackFile[] = [];
      for (const { evidence, a } of attachments) {
        const absolute = resolveSafeCqcEvidencePath(a.storagePath);
        if (!existsSync(absolute)) {
          notes.push(
            `Not found, so not included: ${a.fileName} (evidence "${evidence.title}")`,
          );
          continue;
        }
        files.push({
          path: `${evidenceFolder.get(evidence.id)}/${safeFileName(a.fileName)}`,
          data: readFileSync(absolute),
        });
        fileCount += 1;
      }
      const uniquePolicies = new Map<string, PackPolicy>();
      for (const list of policies.values())
        for (const p of list) uniquePolicies.set(p.policyId, p);
      for (const p of uniquePolicies.values()) {
        try {
          files.push(await this.policyFile(user, p));
          policyFileCount += 1;
        } catch {
          notes.push(
            `Could not add the policy ${p.reference} ${p.title}: download it from Policies.`,
          );
        }
      }
      buffer = await buildPackZip(
        name,
        pdf,
        buildEvidenceCsv(base),
        files,
        notes,
        pack,
      );
    }

    await this.audit.logAudit({
      userId: user.id,
      module: AuditModule.CQC_EVIDENCE,
      action: AuditAction.CQC_EVIDENCE_EXPORTED,
      recordType: 'CqcEvidence',
      recordId: query.statementId ?? null,
      metadata: {
        kind: 'evidence-pack',
        format: query.format,
        statementId: query.statementId ?? null,
        keyQuestionCode: query.keyQuestionCode ?? null,
        locationId: query.locationId ?? null,
        evidenceCount: rows.length,
        fileCount,
        policyCount: new Set(
          [...policies.values()].flat().map((p) => p.policyId),
        ).size,
        policyFileCount,
      },
      ...meta,
    });

    const fileName = `${name}.${query.format}`;
    return {
      buffer,
      fileName,
      contentType: zip ? 'application/zip' : 'application/pdf',
      disposition: contentDisposition(fileName, false),
    };
  }

  // ─── Policies ─────────────────────────────────────────────────────────────

  /**
   * Statement id → the organisation's published policies behind it (from the mock inspection library's links),
   * only those this user may open. Drafts, policies in review and archived ones are left out.
   */
  async policiesFor(
    user: RequestUser,
    statements: Array<{ id: string; code: string }>,
    now: Date,
  ): Promise<Map<string, PackPolicy[]>> {
    const { data: byStatement } = await this.statementPolicies.byStatement();
    const adoptedIds = [
      ...new Set(
        statements.flatMap((s) =>
          (byStatement[s.code] ?? []).flatMap((p) =>
            p.adoptedPolicyId ? [p.adoptedPolicyId] : [],
          ),
        ),
      ),
    ];
    if (!adoptedIds.length) return new Map();
    const docs = await this.prisma.policyDocument.findMany({
      where: {
        id: { in: adoptedIds },
        deletedAt: null,
        status: { not: PolicyStatus.ARCHIVED },
      },
      select: {
        id: true,
        reference: true,
        title: true,
        documentType: true,
        versions: {
          where: { status: PolicyStatus.PUBLISHED },
          orderBy: [{ versionMajor: 'desc' }, { versionMinor: 'desc' }],
          take: 1,
          select: {
            id: true,
            versionMajor: true,
            versionMinor: true,
            publishedAt: true,
            reviewDate: true,
            storagePath: true,
            fileName: true,
          },
        },
      },
    });
    const visible = new Map<string, PackPolicy>();
    for (const d of docs) {
      const v = d.versions[0];
      if (!v) continue;
      try {
        await this.policies.getById(user, d.id);
      } catch {
        continue; // not for this user (audience or branch)
      }
      visible.set(d.id, {
        policyId: d.id,
        versionId: v.id,
        reference: d.reference,
        title: d.title,
        documentType: d.documentType,
        versionLabel: formatVersionLabel(v.versionMajor, v.versionMinor),
        publishedAt: v.publishedAt,
        reviewDate: v.reviewDate,
        reviewOverdue: Boolean(
          v.reviewDate && v.reviewDate.getTime() < now.getTime(),
        ),
        uploaded: Boolean(v.storagePath && v.fileName),
        uploadedFileName: v.fileName,
      });
    }
    const out = new Map<string, PackPolicy[]>();
    for (const s of statements) {
      const list = (byStatement[s.code] ?? []).flatMap((p) => {
        const hit = p.adoptedPolicyId
          ? visible.get(p.adoptedPolicyId)
          : undefined;
        return hit ? [hit] : [];
      });
      if (list.length) out.set(s.id, list);
    }
    return out;
  }

  /** The published policy as a file for the ZIP: an uploaded document as it was uploaded, otherwise a PDF. */
  private async policyFile(
    user: RequestUser,
    p: PackPolicy,
  ): Promise<PackFile> {
    const label = `${p.reference} ${p.title} ${p.versionLabel}`;
    if (p.uploaded) {
      const file = await this.policies.getVersionDocumentForDownload(
        user,
        p.policyId,
        p.versionId,
      );
      const ext = extname(p.uploadedFileName ?? '') || '.pdf';
      return {
        path: `policies/${safeFileName(`${label}${ext}`)}`,
        data: readFileSync(file.absolutePath),
      };
    }
    const file = await this.policyExports.exportPolicy(
      user,
      p.policyId,
      'pdf',
      p.versionId,
    );
    return {
      path: `policies/${safeFileName(`${label}.pdf`)}`,
      data: file.buffer,
    };
  }

  // ─── Mock inspections ─────────────────────────────────────────────────────

  /**
   * The latest completed mock inspection score for each statement, the open improvement actions, and the latest
   * completed inspection. Inspections of the chosen branch and whole-organisation ones (all the user may see when no
   * branch is chosen).
   */
  async mockFor(
    scope: OrgScope,
    statementIds: string[],
    locationId: string | undefined,
    now: Date,
  ) {
    const where: Prisma.CqcMockInspectionWhereInput[] = [];
    if (scope.locationIds !== null) {
      where.push({
        OR: [{ locationId: { in: scope.locationIds } }, { locationId: null }],
      });
    }
    if (locationId) where.push({ OR: [{ locationId }, { locationId: null }] });

    const [inspections, actionRows] = await Promise.all([
      this.prisma.cqcMockInspection.findMany({
        where: {
          AND: [...where, { status: CqcMockInspectionStatus.COMPLETED }],
        },
        orderBy: { completedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          locationId: true,
          completedAt: true,
          result: true,
          frameworkVersion: { select: { scoringRules: true } },
          statements: {
            where: { score: { not: null } },
            select: { statementId: true, score: true },
          },
        },
      }),
      this.prisma.cqcMockInspectionAction.findMany({
        where: {
          status: CqcMockActionStatus.OPEN,
          statementId: { in: statementIds },
          inspection: {
            AND: [
              ...where,
              { status: { not: CqcMockInspectionStatus.CANCELLED } },
            ],
          },
        },
        orderBy: [
          { dueAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ],
        select: { statementId: true, title: true, ownerId: true, dueAt: true },
      }),
    ]);
    const [locations, owners] = await Promise.all([
      this.prisma.location.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                inspections.flatMap((i) =>
                  i.locationId ? [i.locationId] : [],
                ),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                actionRows.flatMap((a) => (a.ownerId ? [a.ownerId] : [])),
              ),
            ],
          },
        },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
    ]);
    const branch = new Map(locations.map((l) => [l.id, l.name]));
    const ownerName = new Map(
      owners.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(' ').trim() ||
          u.email ||
          'User',
      ]),
    );

    // The most relevant inspection first: the chosen branch's (or, for every branch, whole-organisation ones), then
    // the others; newest first within each (the query order, kept by the stable sort).
    const relevance = (i: { locationId: string | null }) =>
      (locationId ? i.locationId === locationId : i.locationId === null)
        ? 0
        : 1;
    const ordered = [...inspections].sort(
      (a, b) => relevance(a) - relevance(b),
    );

    const wanted = new Set(statementIds);
    const scores = new Map<string, PackMockScore>();
    for (const i of ordered) {
      const rules = parseScoringRules(i.frameworkVersion.scoringRules);
      const scale = new Map(
        (rules?.scale ?? []).map((s) => [s.score, s.label]),
      );
      const outOf = Math.max(4, ...(rules?.scale ?? []).map((s) => s.score));
      for (const s of i.statements) {
        if (
          !wanted.has(s.statementId) ||
          scores.has(s.statementId) ||
          s.score === null
        )
          continue;
        scores.set(s.statementId, {
          score: s.score,
          label: scale.get(s.score) ?? null,
          outOf,
          inspectionTitle: i.title,
          completedAt: i.completedAt,
          branchName: i.locationId
            ? (branch.get(i.locationId) ?? 'Branch')
            : null,
        });
      }
    }

    const actions = new Map<string, PackMockAction[]>();
    for (const a of actionRows) {
      if (!a.statementId) continue;
      const list = actions.get(a.statementId) ?? [];
      list.push({
        title: a.title,
        owner: a.ownerId ? (ownerName.get(a.ownerId) ?? 'User') : null,
        dueAt: a.dueAt,
        overdue: Boolean(a.dueAt && a.dueAt.getTime() < now.getTime()),
      });
      actions.set(a.statementId, list);
    }

    const first = ordered[0];
    const result = first?.result as InspectionResult | null | undefined;
    const latest: PackLatestInspection | null = first
      ? {
          title: first.title,
          completedAt: first.completedAt,
          branchName: first.locationId
            ? (branch.get(first.locationId) ?? 'Branch')
            : null,
          overall: result?.overallApplies ? (result.overall ?? null) : null,
          keyQuestions: (result?.keyQuestions ?? []).map((k) => ({
            code: k.keyQuestionCode,
            rating: k.rating,
          })),
        }
      : null;
    return { scores, actions, latest };
  }
}

/** The ZIP: the PDF, a CSV of the evidence, the files and policies, and a README of what is inside. */
export async function buildPackZip(
  name: string,
  pdf: Buffer,
  csv: string,
  files: PackFile[],
  notes: string[],
  pack: EvidencePack,
): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder(name)!;
  root.file(`${name}.pdf`, pdf);
  root.file('evidence.csv', csv);
  const used = new Set<string>();
  for (const f of files) {
    let path = f.path;
    for (let n = 2; used.has(path); n += 1) {
      const ext = extname(f.path);
      path = `${f.path.slice(0, f.path.length - ext.length)} (${n})${ext}`;
    }
    used.add(path);
    root.file(path, f.data);
  }
  const evidenceCount = new Set(
    pack.statements.flatMap((s) => s.evidence.map((e) => e.id)),
  ).size;
  const readme = [
    `CQC evidence pack - ${pack.organisationName}`,
    `${pack.scopeLabel}`,
    `${pack.frameworkTitle}`,
    `Made ${pack.generatedAt.toISOString().slice(0, 10)} by ${pack.generatedBy}.`,
    '',
    'What is inside:',
    `- ${name}.pdf: the pack to read first (${pack.statements.length} quality statements, ${evidenceCount} pieces of evidence).`,
    '- evidence.csv: the same evidence as a spreadsheet.',
    pack.includesFiles
      ? '- evidence-files/: the files attached to the evidence, one folder per piece of evidence (named in the PDF).'
      : '- Files attached to the evidence were left out.',
    pack.includesPolicies
      ? '- policies/: the published policies behind the quality statements.'
      : '- Policies were left out.',
    '',
    'Survey figures are totals only: no individual answers are included, and nothing is broken down below 5 responses.',
    'Attached files may contain personal information: share this pack only with the CQC and keep it secure.',
    ...(notes.length
      ? ['', 'Not included:', ...notes.map((n) => `- ${n}`)]
      : []),
    '',
  ].join('\r\n');
  root.file('README.txt', readme);
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
