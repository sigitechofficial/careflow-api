import PDFDocument from 'pdfkit';
import type { BodyMapGapItem } from './body-map-gaps.util';

function sanitize(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\u2026/g, '...').replace(/[^\x20-\x7E\n]/g, '?');
}

export type BodyMapCqcPdfData = {
  organisationName?: string | null;
  serviceUserName: string;
  serviceUserNumber?: string | null;
  dateOfBirth?: string | null;
  generatedAt: string;
  summary: {
    activeCount: number;
    reviewDueCount: number;
    highRiskCount: number;
    safeguardingCount: number;
  };
  gaps: BodyMapGapItem[];
  records: {
    recordType: string;
    subType: string | null;
    status: string;
    riskLevel: string;
    bodyPart: string | null;
    description: string | null;
    nextReviewAt: string | null;
  }[];
};

export function buildBodyMapCqcPdf(data: BodyMapCqcPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `Body Map CQC Evidence — ${data.serviceUserName}`,
        Author: 'CareAdmin',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (data.organisationName) {
      doc.fontSize(9).fillColor('#475569').text(sanitize(data.organisationName), { align: 'center' });
      doc.moveDown(0.2);
    }
    doc.fontSize(14).fillColor('#0f172a').text('BODY MAP — CQC EVIDENCE PACK', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor('#334155').text(sanitize(data.serviceUserName), { align: 'center' });
    if (data.serviceUserNumber) {
      doc.text(`SU ref: ${sanitize(data.serviceUserNumber)}`, { align: 'center' });
    }
    if (data.dateOfBirth) {
      doc.text(`DOB: ${sanitize(data.dateOfBirth)}`, { align: 'center' });
    }
    doc.text(`Generated: ${sanitize(data.generatedAt)}`, { align: 'center' });
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#0f172a').text('Summary');
    doc.fontSize(9).fillColor('#334155');
    doc.text(
      [
        `Active records: ${data.summary.activeCount}`,
        `Review due / overdue: ${data.summary.reviewDueCount}`,
        `High / urgent risk: ${data.summary.highRiskCount}`,
        `Safeguarding triggers: ${data.summary.safeguardingCount}`,
      ].join('\n'),
    );
    doc.moveDown(0.6);

    if (data.gaps.length > 0) {
      doc.fontSize(11).fillColor('#b45309').text('Outstanding gaps');
      doc.fontSize(8).fillColor('#92400e');
      for (const g of data.gaps.slice(0, 40)) {
        doc.text(`• ${sanitize(g.message)}`);
      }
      doc.moveDown(0.6);
    }

    doc.fontSize(11).fillColor('#0f172a').text('Active records');
    doc.fontSize(8).fillColor('#334155');
    for (const r of data.records) {
      const line = [
        sanitize(r.recordType),
        r.subType ? sanitize(r.subType) : '',
        `risk ${sanitize(r.riskLevel)}`,
        r.bodyPart ? `@ ${sanitize(r.bodyPart)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      doc.text(line);
      if (r.description) {
        doc.text(`  ${sanitize(r.description).slice(0, 200)}`, { indent: 8 });
      }
      if (r.nextReviewAt) {
        doc.text(`  Next review: ${sanitize(r.nextReviewAt)}`, { indent: 8 });
      }
      doc.moveDown(0.15);
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
      }
    }

    doc.fontSize(7).fillColor('#64748b').text(
      'Machine-readable JSON export available from CareAdmin body map module.',
      40,
      doc.page.height - 50,
      { align: 'center', width: doc.page.width - 80 },
    );

    doc.end();
  });
}
