import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import type { OrgScope } from '../common/org-scope/org-scope.types';

const mockTmp = mkdtempSync(join(tmpdir(), 'cqc-pack-'));
jest.mock('../cqc-evidence/cqc-evidence-upload.util', () => ({
  resolveSafeCqcEvidencePath: (p: string) => `${mockTmp}/${p}`,
}));
const tmp = mockTmp;

import {
  CqcEvidencePackService,
  PACK_FILES_LIMIT_BYTES,
  packSlug,
  safeFileName,
  statementNumber,
} from './cqc-evidence-pack.service';
import {
  attentionLines,
  periodText,
  type EvidencePack,
} from './cqc-evidence-pack-pdf.util';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const statements = [
  {
    id: 's-meds',
    code: 'SAFE_MEDICINES',
    title: 'Medicines optimisation',
    summary: 'x',
    keyQuestionCode: 'SAFE',
    keyQuestionTitle: 'Safe',
  },
  {
    id: 's-gov',
    code: 'WELL_LED_GOVERNANCE',
    title: 'Governance',
    summary: 'y',
    keyQuestionCode: 'WELL_LED',
    keyQuestionTitle: 'Well-led',
  },
];

const evidence = (
  id: string,
  attachments: Array<{
    fileName: string;
    storagePath: string;
    sizeBytes: number;
  }> = [],
) => ({
  row: { id, title: `Evidence ${id}`, attachments },
  exported: {
    id,
    title: `Evidence ${id}`,
    summary: null,
    sourceType: 'MANUAL',
    sourceLabel: null,
    categoryTitle: 'Processes',
    periodStart: null,
    periodEnd: null,
    status: 'CURRENT',
    reviewDueAt: new Date('2026-10-01T00:00:00.000Z'),
    addedBy: 'Sam',
    addedAt: NOW,
    branches: [],
    metrics: null,
    actions: [],
    attachments: attachments.map((a) => a.fileName),
  },
});

function setup(
  opts: {
    permissions?: string[];
    attachments?: Array<{
      fileName: string;
      storagePath: string;
      sizeBytes: number;
    }>;
  } = {},
) {
  const e1 = evidence('ev-1', opts.attachments);
  const prisma = {
    policyDocument: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'pol-1',
          reference: 'POL-MED-001',
          title: 'Medicines Management Policy',
          documentType: 'POLICY',
          versions: [
            {
              id: 'v-1',
              versionMajor: 2,
              versionMinor: 0,
              publishedAt: NOW,
              reviewDate: new Date('2027-11-01'),
              storagePath: null,
              fileName: null,
            },
          ],
        },
        // Draft only: no published version, left out.
        {
          id: 'pol-2',
          reference: 'POL-MED-014',
          title: 'Errors',
          documentType: 'PROCEDURE',
          versions: [],
        },
        // Published but this user may not open it.
        {
          id: 'pol-3',
          reference: 'POL-GOV-002',
          title: 'Governance',
          documentType: 'POLICY',
          versions: [
            {
              id: 'v-3',
              versionMajor: 1,
              versionMinor: 0,
              publishedAt: NOW,
              reviewDate: null,
              storagePath: null,
              fileName: null,
            },
          ],
        },
      ]),
    },
    cqcMockInspection: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'mi-2',
          title: 'Mock inspection, November',
          locationId: null,
          completedAt: new Date('2026-11-10'),
          result: {
            overall: 'GOOD',
            overallApplies: true,
            keyQuestions: [{ keyQuestionCode: 'SAFE', rating: 'GOOD' }],
          },
          frameworkVersion: { scoringRules: null },
          statements: [{ statementId: 's-meds', score: 3 }],
        },
        {
          id: 'mi-1',
          title: 'Mock inspection, June',
          locationId: 'loc-a',
          completedAt: new Date('2026-06-10'),
          result: null,
          frameworkVersion: { scoringRules: null },
          statements: [
            { statementId: 's-meds', score: 1 },
            { statementId: 's-gov', score: 2 },
          ],
        },
      ]),
    },
    cqcMockInspectionAction: {
      findMany: jest.fn().mockResolvedValue([
        {
          statementId: 's-gov',
          title: 'Audit care plans monthly',
          ownerId: 'u-1',
          dueAt: new Date('2026-11-01'),
        },
      ]),
    },
    location: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'loc-a', name: 'Greenwich' }]),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'u-1', firstName: 'Ana', lastName: 'Lee', email: 'a@x' },
        ]),
    },
  };
  const evidenceService = {
    scopeOf: jest.fn().mockReturnValue({ locationIds: null }),
    buildExportPack: jest.fn(
      (_u, _f, chosen: typeof statements, _l, scopeTitle: string) =>
        Promise.resolve({
          pack: {
            organisationName: 'All For Care',
            generatedAt: NOW,
            generatedBy: 'Sam',
            frameworkTitle: 'CQC (version 1)',
            scopeLabel: scopeTitle,
            branchName: null,
            statements: chosen.map((s) => ({
              id: s.id,
              keyQuestionTitle: s.keyQuestionTitle,
              code: s.code,
              title: s.title,
              summary: s.summary,
              evidence: s.id === 's-meds' ? [e1.exported] : [],
            })),
          },
          rows: chosen.some((s) => s.id === 's-meds') ? [e1.row] : [],
        }),
    ),
  };
  const framework = {
    active: jest.fn().mockResolvedValue({
      title: 'CQC',
      version: 1,
      statements,
      categories: [],
      keyQuestions: [
        { code: 'SAFE', statements: [{ id: 's-ipc' }, { id: 's-meds' }] },
        { code: 'WELL_LED', statements: [{ id: 's-gov' }] },
      ],
    }),
  };
  const policies = {
    getById: jest.fn((_u, id: string) =>
      id === 'pol-3'
        ? Promise.reject(new Error('not visible'))
        : Promise.resolve({}),
    ),
    getVersionDocumentForDownload: jest.fn(),
  };
  const policyExports = {
    exportPolicy: jest.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF-policy'),
      fileName: 'x.pdf',
      contentType: 'application/pdf',
    }),
  };
  const statementPolicies = {
    byStatement: jest.fn().mockResolvedValue({
      data: {
        SAFE_MEDICINES: [
          { reference: 'POL-MED-001', adoptedPolicyId: 'pol-1' },
          { reference: 'POL-MED-014', adoptedPolicyId: 'pol-2' },
          { reference: 'POL-MED-020', adoptedPolicyId: null },
        ],
        WELL_LED_GOVERNANCE: [
          { reference: 'POL-GOV-002', adoptedPolicyId: 'pol-3' },
        ],
      },
    }),
  };
  const audit = { logAudit: jest.fn() };
  const context = {
    serviceDetails: jest.fn().mockResolvedValue({
      provider: { name: 'Acme Care', legalName: 'Acme Care Ltd', cqcProviderId: '1-100', address: '1 High St' },
      locations: [
        {
          name: 'Acme Croydon',
          cqcLocationId: '1-200',
          address: '2 Park Rd, Croydon',
          contact: null,
          registeredManagers: ['Sam Lee'],
          nominatedIndividual: null,
          regulatedActivities: ['Personal care'],
          serviceTypes: ['Homecare agencies'],
          registeredSince: new Date('2020-01-01'),
          rating: 'Good',
        },
      ],
    }),
    keyData: jest.fn().mockResolvedValue({
      from: new Date('2025-11-27'),
      to: new Date('2026-11-27'),
      groups: [{ title: 'Incidents', figures: [{ label: 'Incidents reported', value: '12' }] }],
      hidden: ['Safeguarding'],
    }),
  };
  const service = new CqcEvidencePackService(
    prisma as any,
    audit as any,
    evidenceService as any,
    framework as any,
    policies as any,
    policyExports as any,
    statementPolicies as any,
    context as any,
  );
  const user = {
    id: 'u-me',
    permissions: opts.permissions ?? ['cqc_evidence.export', 'policies.read'],
  } as unknown as RequestUser;
  return {
    service,
    prisma,
    evidenceService,
    policies,
    policyExports,
    audit,
    user,
    context,
  };
}

describe('CqcEvidencePackService', () => {
  it('adds only the published policies the user may open, for the statements in the pack', async () => {
    const { service, user } = setup();
    const out = await service.policiesFor(user, statements, NOW);
    expect(
      out.get('s-meds')?.map((p) => [p.reference, p.versionLabel]),
    ).toEqual([['POL-MED-001', 'v2.0']]);
    expect(out.get('s-gov')).toBeUndefined();
  });

  it('takes the latest completed mock score per statement, and the open actions with owner and overdue', async () => {
    const { service } = setup();
    const out = await service.mockFor(
      { locationIds: null } as OrgScope,
      ['s-meds', 's-gov'],
      undefined,
      NOW,
    );
    expect(out.scores.get('s-meds')).toEqual(
      expect.objectContaining({
        score: 3,
        inspectionTitle: 'Mock inspection, November',
      }),
    );
    expect(out.scores.get('s-gov')).toEqual(
      expect.objectContaining({ score: 2, outOf: 4, branchName: 'Greenwich' }),
    );
    expect(out.actions.get('s-gov')).toEqual([
      {
        title: 'Audit care plans monthly',
        owner: 'Ana Lee',
        dueAt: new Date('2026-11-01'),
        overdue: true,
      },
    ]);
    expect(out.latest).toEqual(
      expect.objectContaining({
        title: 'Mock inspection, November',
        overall: 'GOOD',
      }),
    );
  });

  it('limits mock inspections to the chosen branch and whole-organisation ones, within the user scope', async () => {
    const { service, prisma } = setup();
    await service.mockFor(
      { locationIds: ['loc-a'] } as OrgScope,
      ['s-meds'],
      'loc-a',
      NOW,
    );
    const where = (
      prisma.cqcMockInspection.findMany.mock.calls[0] as unknown as [
        { where: { AND: unknown[] } },
      ]
    )[0].where.AND;
    expect(where).toEqual(
      expect.arrayContaining([
        { OR: [{ locationId: { in: ['loc-a'] } }, { locationId: null }] },
        { OR: [{ locationId: 'loc-a' }, { locationId: null }] },
      ]),
    );
  });

  it('makes a PDF for one key question and records the download', async () => {
    const { service, evidenceService, audit, user, context } = setup();
    const file = await service.download(
      user,
      { format: 'pdf', keyQuestionCode: 'SAFE' },
      undefined,
      NOW,
    );
    expect(file.contentType).toBe('application/pdf');
    // The service's CQC registration and key figures, for the same branches.
    expect(context.serviceDetails).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(context.keyData).toHaveBeenCalledWith(user, expect.anything(), undefined, NOW);
    expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(file.fileName).toBe('cqc-evidence-pack-safe-2026-11-20.pdf');
    expect(
      evidenceService.buildExportPack.mock.calls[0][2].map(
        (s: { id: string }) => s.id,
      ),
    ).toEqual(['s-meds']);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          kind: 'evidence-pack',
          format: 'pdf',
          keyQuestionCode: 'SAFE',
          policyCount: 1,
        }) as unknown,
      }),
    );
  });

  it('makes a ZIP with the PDF, CSV, README, attached files and policies', async () => {
    writeFileSync(join(tmp, 'a.pdf'), 'attached file');
    const { service, policyExports, user } = setup({
      attachments: [
        { fileName: 'Audit: May.pdf', storagePath: 'a.pdf', sizeBytes: 13 },
        { fileName: 'gone.png', storagePath: 'missing.png', sizeBytes: 5 },
      ],
    });
    const file = await service.download(
      user,
      { format: 'zip' },
      undefined,
      NOW,
    );
    expect(file.contentType).toBe('application/zip');
    const zip = await JSZip.loadAsync(file.buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const root = 'cqc-evidence-pack-all-statements-2026-11-20';
    expect(names).toEqual(
      expect.arrayContaining([
        `${root}/${root}.pdf`,
        `${root}/evidence.csv`,
        `${root}/README.txt`,
        `${root}/evidence-files/evidence-ev-1-ev-1/Audit May.pdf`,
        `${root}/policies/POL-MED-001 Medicines Management Policy v2.0.pdf`,
      ]),
    );
    expect(
      await zip
        .file(`${root}/evidence-files/evidence-ev-1-ev-1/Audit May.pdf`)!
        .async('string'),
    ).toBe('attached file');
    expect(await zip.file(`${root}/README.txt`)!.async('string')).toContain(
      'Not found, so not included: gone.png',
    );
    expect(policyExports.exportPolicy).toHaveBeenCalledWith(
      user,
      'pol-1',
      'pdf',
      'v-1',
    );
  });

  it('refuses a ZIP whose files are over the limit, before reading them', async () => {
    const { service, user } = setup({
      attachments: [
        {
          fileName: 'big.pdf',
          storagePath: 'big.pdf',
          sizeBytes: PACK_FILES_LIMIT_BYTES + 1,
        },
      ],
    });
    await expect(
      service.download(user, { format: 'zip' }, undefined, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Leaving the files out makes it fine.
    await expect(
      service.download(
        user,
        { format: 'zip', includeFiles: false },
        undefined,
        NOW,
      ),
    ).resolves.toBeDefined();
  });

  it('leaves policies out for users without policies.read, or when asked', async () => {
    const a = setup({ permissions: ['cqc_evidence.export'] });
    await a.service.download(a.user, { format: 'pdf' }, undefined, NOW);
    expect(a.prisma.policyDocument.findMany).not.toHaveBeenCalled();
    const b = setup();
    await b.service.download(
      b.user,
      { format: 'pdf', includePolicies: false },
      undefined,
      NOW,
    );
    expect(b.prisma.policyDocument.findMany).not.toHaveBeenCalled();
  });

  it('makes safe names for the ZIP', () => {
    expect(packSlug('Well-led: Governance & management')).toBe(
      'well-led-governance-management',
    );
    expect(safeFileName('Report: May/June?.PDF')).toBe('Report May June.pdf');
    expect(safeFileName('...')).toBe('file');
  });

  it("prefers the chosen branch's own mock inspection, and whole-organisation ones for every branch", async () => {
    const { service } = setup();
    const branch = await service.mockFor(
      { locationIds: null } as OrgScope,
      ['s-meds'],
      'loc-a',
      NOW,
    );
    // Greenwich's June inspection comes before the newer whole-organisation one.
    expect(branch.scores.get('s-meds')).toEqual(
      expect.objectContaining({ score: 1, branchName: 'Greenwich' }),
    );
    expect(branch.latest?.title).toBe('Mock inspection, June');
    const every = await service.mockFor(
      { locationIds: null } as OrgScope,
      ['s-meds'],
      undefined,
      NOW,
    );
    expect(every.scores.get('s-meds')).toEqual(
      expect.objectContaining({ score: 3, branchName: null }),
    );
  });

  it('numbers statements as the framework does', () => {
    const fw = {
      keyQuestions: [
        { code: 'SAFE', statements: [{ id: 'a' }, { id: 'b' }] },
        { code: 'WELL_LED', statements: [{ id: 'c' }] },
      ],
    };
    expect(statementNumber(fw, { id: 'b', keyQuestionCode: 'SAFE' })).toBe(
      '1.2',
    );
    expect(statementNumber(fw, { id: 'c', keyQuestionCode: 'WELL_LED' })).toBe(
      '2.1',
    );
    expect(statementNumber(fw, { id: 'x', keyQuestionCode: 'NOPE' })).toBe('');
  });

  it('lists what needs attention, and shows a one-day period as one date', () => {
    const pack = {
      generatedAt: NOW,
      statements: [
        {
          number: '1.1',
          title: 'Learning culture',
          evidence: [],
          policies: [],
          actions: [],
        },
        {
          number: '1.2',
          title: 'Medicines',
          evidence: [
            {
              id: 'e1',
              title: 'Old audit',
              reviewDueAt: new Date('2026-10-01'),
            },
          ],
          policies: [
            {
              policyId: 'p1',
              reference: 'POL-1',
              title: 'Meds',
              reviewOverdue: true,
            },
          ],
          actions: [{ overdue: true }, { overdue: false }],
        },
      ],
    } as unknown as EvidencePack;
    expect(attentionLines(pack)).toEqual([
      '1 statement with no current evidence: 1.1 Learning culture.',
      'Evidence past its review date: Old audit.',
      'Policies past their review date: POL-1 Meds.',
      '1 improvement action past the due date.',
    ]);
    expect(periodText(new Date('2026-09-12'), new Date('2026-09-12'))).toBe(
      '12 Sept 2026',
    );
    expect(periodText(null, null)).toBe('Not given');
  });
});
