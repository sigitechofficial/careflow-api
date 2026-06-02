import { buildInitialAssessmentPdf, initialAssessmentPdfFilename } from './initial-assessment-pdf.util';
import type { InitialAssessmentPdfData } from './initial-assessment-pdf-data.util';

jest.mock('../common/utils/html-to-pdf.util', () => ({
  renderHtmlToPdfBuffer: jest.fn(async () => Buffer.from('%PDF-mock')),
}));

const minimalData: InitialAssessmentPdfData = {
  organisationName: 'Test Care',
  serviceUserName: 'Jane Doe',
  templateName: 'Enterprise IA',
  templateVersion: 1,
  submissionId: '00000000-0000-4000-8000-000000000001',
  status: 'REVIEWED',
  generatedAt: '2026-06-02T12:00:00.000Z',
  includeSecureFields: false,
  sections: [],
  consentSummary: [],
  safeguardingSummary: [],
  vitalsSummary: [],
  fallsSummary: [],
  medicationSummary: [],
  openActions: [],
  risks: [],
  signOff: {
    serviceUserAgrees: null,
    signatureObtained: null,
    assessorDeclarationConfirmed: null,
    assessorName: null,
    assessorRole: null,
    assessorSignDate: null,
  },
  managerReview: { required: false, approvedForCareStart: false, conditions: null },
};

describe('initial-assessment-pdf.util', () => {
  it('builds PDF from HTML export pipeline', async () => {
    const pdf = await buildInitialAssessmentPdf(minimalData);
    expect(pdf.toString('utf8')).toBe('%PDF-mock');
  });

  it('derives download filename', () => {
    expect(initialAssessmentPdfFilename(minimalData)).toMatch(/^initial-assessment-/);
  });
});
