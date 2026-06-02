import { renderHtmlToPdfBuffer } from '../common/utils/html-to-pdf.util';
import { buildInitialAssessmentHtml } from './initial-assessment-html.util';
import type { InitialAssessmentPdfData } from './initial-assessment-pdf-data.util';

export async function buildInitialAssessmentPdf(data: InitialAssessmentPdfData): Promise<Buffer> {
  const html = buildInitialAssessmentHtml(data);
  return renderHtmlToPdfBuffer(html);
}

export function initialAssessmentPdfFilename(data: InitialAssessmentPdfData): string {
  const slug = data.serviceUserNumber ?? data.submissionId.slice(0, 8);
  const date = data.generatedAt.slice(0, 10);
  return `initial-assessment-${slug}-${date}.pdf`;
}
