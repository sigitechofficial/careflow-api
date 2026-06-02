import { buildInitialAssessmentHtml, initialAssessmentHtmlFilename } from './initial-assessment-html.util';
import type { InitialAssessmentPdfData } from './initial-assessment-pdf-data.util';

const baseData: InitialAssessmentPdfData = {
  organisationName: 'Test Care',
  companyLegalName: 'Test Care Services Ltd',
  productBrandName: 'CareAdmin',
  serviceUserName: 'Jane Doe',
  serviceUserNumber: 'SU-001',
  dateOfBirth: '1950-01-01',
  templateName: 'Enterprise IA',
  templateVersion: 1,
  submissionId: '00000000-0000-4000-8000-000000000001',
  status: 'REVIEWED',
  assessmentReason: 'New package',
  submittedAt: '2026-06-01T10:00:00.000Z',
  submittedBy: 'Assessor One',
  reviewedAt: '2026-06-02T11:00:00.000Z',
  reviewedBy: 'Manager Two',
  reviewNotes: 'Approved with conditions',
  generatedAt: '2026-06-02T12:00:00.000Z',
  generatedBy: 'Exporter',
  includeSecureFields: false,
  sections: [
    {
      sectionNumber: 1,
      title: 'Personal details',
      rows: [{ questionText: 'Preferred name', answerText: 'Jane', specRef: '1.1' }],
    },
  ],
  consentSummary: [],
  safeguardingSummary: [],
  waterlowScore: 12,
  adlTotal: 8,
  adlDependency: 'Moderate',
  vitalsSummary: [],
  fallsSummary: [],
  medicationSummary: [],
  openActions: [],
  risks: [],
  signOff: {
    serviceUserAgrees: true,
    signatureObtained: true,
    assessorDeclarationConfirmed: true,
    assessorName: 'Assessor One',
    assessorRole: 'RN',
    assessorSignDate: '2026-06-01',
  },
  managerReview: {
    required: true,
    approvedForCareStart: true,
    conditions: 'Double-up week 1',
  },
};

describe('initial-assessment-html.util', () => {
  it('builds HTML containing service user and section answers', () => {
    const html = buildInitialAssessmentHtml(baseData);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('Preferred name');
    expect(html).toContain('Secure access fields');
    expect(html).toContain('Personal details');
    expect(html).toContain('Initial Assessment');
    expect(html).toContain('cover-page');
    expect(html).toContain('cover-su-corner-name');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('cover-avatar');
    expect(html).toContain('cover-file-band');
    expect(html).toContain('Powered by CareAdmin');
    expect(html).toContain('Test Care Services Ltd');
    expect(html).toContain('class="qa"');
    expect(html).toContain('Table of contents');
    expect(html).toContain('href="#section-1"');
    expect(html).not.toContain('<table class="responses"');
  });

  it('renders organisation logo image when a data URI is provided', () => {
    const html = buildInitialAssessmentHtml({
      ...baseData,
      organisationLogoUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });
    expect(html).toContain('<img class="cover-org-logo"');
    expect(html).not.toMatch(/<span class="brand-initials cover-org-initials"/);
  });

  it('escapes unsafe HTML in answers', () => {
    const html = buildInitialAssessmentHtml({
      ...baseData,
      sections: [
        {
          sectionNumber: 1,
          title: 'Test',
          rows: [{ questionText: '<script>', answerText: '<img onerror=alert(1)>', specRef: undefined }],
        },
      ],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('builds a stable filename', () => {
    expect(initialAssessmentHtmlFilename(baseData)).toBe('initial-assessment-SU-001-2026-06-02.html');
  });
});
