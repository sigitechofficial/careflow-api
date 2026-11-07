import { BadRequestException } from '@nestjs/common';
import { PolicyExportService } from './policy-export.service';
import * as util from './policy-export.util';

jest.mock('../common/utils/html-to-pdf.util', () => ({ renderHtmlToPdfBuffer: jest.fn(async () => Buffer.from('%PDF-1.7')) }));

const version = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  status: 'PUBLISHED',
  versionLabel: 'v1.0',
  contentHtml: '<p>Text</p>',
  hasDocument: false,
  contentKind: 'EDITOR',
  effectiveDate: '2026-11-01',
  reviewDate: '2027-11-01',
  publishedAt: '2026-11-05T10:00:00Z',
  ...over,
});

function setup(opts: { current?: Record<string, unknown>; library?: Record<string, unknown> } = {}) {
  const prisma: any = {
    companyProfile: { findFirst: jest.fn(async () => ({ displayName: 'Allfor Care', companyName: 'Allfor Care Ltd', displayLogoUrl: null, companyLogoUrl: null })) },
    user: { findUnique: jest.fn(async () => ({ firstName: 'Sam', lastName: 'Lee', email: 'sam@example.test' })) },
  };
  const policies: any = {
    getById: jest.fn(async () => ({
      id: 'p1',
      reference: 'POL-MED-001',
      title: 'Medicines Management Policy',
      description: 'Summary',
      documentType: 'POLICY',
      primaryCategory: { name: 'Medication' },
      currentVersion: version(opts.current),
    })),
    getVersion: jest.fn(async () => version({ id: 'v2', status: 'DRAFT', versionLabel: 'v2.0' })),
  };
  const library: any = {
    get: jest.fn(async () => ({
      data: {
        reference: 'POL-CD-001',
        title: 'Person-Centred Care Policy',
        summary: 'Our parent policy',
        documentType: 'POLICY',
        category: { name: 'Care delivery' },
        revision: 3,
        researchedOn: '2026-10-01',
        reviewFrequencyMonths: 12,
        regulatoryBasis: [{ source: 'Care Act 2014', url: 'https://www.legislation.gov.uk/ukpga/2014/23' }],
        adoptedPolicyId: null,
        contentHtml: '<p>Ready-made text</p>',
        ...opts.library,
      },
    })),
  };
  const orgSettings: any = { getOperationalTimezone: async () => 'Europe/London' };
  const svc = new PolicyExportService(prisma, policies, library, orgSettings);
  return { svc, policies };
}

const user: any = { id: 'u1', permissions: ['policies.read'] };

describe('PolicyExportService', () => {
  let html: jest.SpyInstance;
  let docx: jest.SpyInstance;
  beforeEach(() => {
    html = jest.spyOn(util, 'policyExportHtml');
    docx = jest.spyOn(util, 'policyExportDocx');
  });
  afterEach(() => jest.restoreAllMocks());

  it('your policy as PDF: its current version, the organisation and who printed it, a file name from the reference', async () => {
    const { svc, policies } = setup();
    const file = await svc.exportPolicy(user, 'p1', 'pdf');
    expect(policies.getById).toHaveBeenCalledWith(user, 'p1');
    expect(file).toMatchObject({ contentType: 'application/pdf', fileName: 'POL-MED-001 Medicines Management Policy v1.0.pdf' });
    const model = html.mock.calls[0][0];
    expect(model).toMatchObject({ organisation: 'Allfor Care', printedBy: 'Sam Lee', notice: null, watermark: null });
    expect(model.details).toContainEqual(['Effective date', '1 Nov 2026']);
  });

  it('a chosen draft version is marked DRAFT and named so; Word gives a .docx', async () => {
    const { svc, policies } = setup();
    const file = await svc.exportPolicy(user, 'p1', 'docx', 'v2');
    expect(policies.getVersion).toHaveBeenCalledWith(user, 'p1', 'v2');
    expect(file.fileName).toBe('POL-MED-001 Medicines Management Policy v2.0 DRAFT.docx');
    expect(file.contentType).toContain('wordprocessingml');
    expect(docx.mock.calls[0][0]).toMatchObject({ watermark: 'DRAFT', notice: { tone: 'draft' } });
  });

  it('an uploaded policy is not remade: it is downloaded as it was uploaded', async () => {
    const { svc } = setup({ current: { hasDocument: true, contentKind: 'UPLOAD', contentHtml: null } });
    await expect(svc.exportPolicy(user, 'p1', 'pdf')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a ready-made policy says it is ready-made (not yet adopted) and lists its legislation', async () => {
    const { svc } = setup();
    const file = await svc.exportLibraryPolicy(user, 'lib1', 'pdf');
    expect(file.fileName).toBe('POL-CD-001 Person-Centred Care Policy ready-made.pdf');
    const model = html.mock.calls[0][0];
    expect(model.notice.text).toContain('not your organisation’s policy until it is adopted');
    expect(model.appendix).toEqual({ heading: 'Legislation and guidance', items: [{ text: 'Care Act 2014', url: 'https://www.legislation.gov.uk/ukpga/2014/23' }] });
  });

  it('once adopted, it says the organisation’s own copy is the one staff follow', async () => {
    const { svc } = setup({ library: { adoptedPolicyId: 'p9' } });
    await svc.exportLibraryPolicy(user, 'lib1', 'docx');
    expect(docx.mock.calls[0][0].notice.text).toContain('its own copy in Policies is the version staff follow');
  });
});
