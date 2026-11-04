import PDFDocument from 'pdfkit';
import { Logger } from '@nestjs/common';
import { sanitizePayslipPdfText } from '../../payroll/payroll-payslip-pdf.util';
import { renderHtmlToPdfBuffer } from '../../common/utils/html-to-pdf.util';
import { renderQuoteHtml } from './quote-pdf-html.util';

type Doc = InstanceType<typeof PDFDocument>;

/** Client-facing quote content. Built only from an issued version's snapshot — never internal notes. */
export type ClientQuoteView = {
  /** SUMMARY: visits by time of day with no times, lengths or per-visit prices; totals only. */
  layout: 'DETAILED' | 'SUMMARY';
  provider: {
    name: string;
    email: string | null;
    phone: string | null;
    vatNumber: string | null;
  };
  quotationNumber: string;
  versionNumber: number;
  quoteTypeLabel: string;
  statusLabel: string;
  issueDate: string | null;
  validUntil: string | null;
  proposedStartDate: string | null;
  proposedEndDate: string | null;
  clientName: string;
  contactName: string | null;
  visits: Array<{
    label: string;
    when: string;
    /** Day chips (Mon, Tue … or one-off dates), clock time and how often. */
    days: string[];
    time: string;
    frequency: string;
    duration: string;
    carers: number;
    activities: string[];
    perVisit: string | null;
    weekly: string;
  }>;
  extras: Array<{ description: string; frequency: string; amount: string }>;
  /** The quote's rates in words, when it has rates besides the hourly one (else empty). */
  rates: Array<{ label: string; value: string }>;
  totals: Array<{ label: string; amount: string; method: string }>;
  oneOffTotal: string | null;
  /** Only when the quote charges VAT. */
  vatLabel: string | null;
  funding: Array<{
    payer: string;
    detail: string;
    weekly: string;
    status: string;
  }>;
  clientWeeklyLiability: string;
  clientNotes: string | null;
  terms: string | null;
};

/** Text Helvetica can draw; keeps × and ÷ (in its character set) for the totals' working. */
const t = (v: string | null | undefined) =>
  (v ?? '')
    .split(/([\u00D7\u00F7])/)
    .map((part) => (part === '\u00D7' || part === '\u00F7' ? part : sanitizePayslipPdfText(part)))
    .join('');

/** Plain pdfkit layout, used when no browser is available for the HTML design. */
export function buildQuotePdfKit(view: ClientQuoteView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc: Doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `Care quotation ${view.quotationNumber} V${view.versionNumber}`,
        Author: t(view.provider.name),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const width = doc.page.width - 80;
    const heading = (text: string) => {
      doc
        .moveDown(0.8)
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#0f172a')
        .text(t(text), left);
      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.6)
        .moveTo(left, doc.y + 2)
        .lineTo(left + width, doc.y + 2)
        .stroke();
      doc.moveDown(0.4).font('Helvetica').fontSize(9).fillColor('#0f172a');
    };
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor('#0f172a');
      doc.text(t(label), left, y, { width: width * 0.65 });
      doc.text(t(value), left + width * 0.65, y, {
        width: width * 0.35,
        align: 'right',
      });
      doc.moveDown(0.2);
    };

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#0f172a')
      .text(t(view.provider.name), left);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#64748b')
      .text(
        t(
          [view.provider.email, view.provider.phone]
            .filter(Boolean)
            .join('  |  '),
        ),
        left,
      );
    doc
      .moveDown(0.8)
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#0d9488')
      .text(
        t(
          `Care quotation ${view.quotationNumber} - Version ${view.versionNumber}`,
        ),
        left,
      );
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#0f172a')
      .text(t(`${view.quoteTypeLabel}  |  ${view.statusLabel}`), left);

    heading('Details');
    row('Prepared for', view.clientName);
    if (view.contactName) row('Contact', view.contactName);
    row('Issue date', view.issueDate ?? '-');
    row('Valid until', view.validUntil ?? '-');
    row('Proposed start', view.proposedStartDate ?? '-');
    if (view.proposedEndDate) row('Proposed end', view.proposedEndDate);

    heading('Proposed visits');
    for (const v of view.visits) {
      doc.font('Helvetica-Bold').fontSize(9).text(t(v.label), left);
      const carers = `${v.carers} carer${v.carers === 1 ? '' : 's'}`;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#334155')
        .text(
          t(
            view.layout === 'SUMMARY'
              ? `${v.when}  |  ${carers}`
              : `${v.when}  |  ${v.duration}  |  ${carers}`,
          ),
          left,
        );
      if (v.activities.length)
        doc.text(t(`Includes: ${v.activities.join(', ')}`), left, undefined, {
          width,
        });
      doc.fillColor('#0f172a');
      if (view.layout === 'DETAILED')
        row(v.perVisit ? `Per visit ${v.perVisit}` : 'Price', v.weekly);
      doc.moveDown(0.2);
    }

    if (view.extras.length) {
      heading('Other charges');
      for (const e of view.extras)
        row(`${e.description} (${e.frequency})`, e.amount);
    }

    if (view.rates.length) {
      heading('Rates used');
      for (const r of view.rates) row(r.label, r.value);
    }

    heading('Cost summary');
    for (const tot of view.totals) {
      row(tot.label, tot.amount, true);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748b')
        .text(t(tot.method), left, undefined, { width });
      doc.fillColor('#0f172a').moveDown(0.2);
    }
    if (view.oneOffTotal) row('One-off charges', view.oneOffTotal, true);
    if (view.vatLabel)
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#64748b')
        .text(t(view.vatLabel), left, undefined, { width });

    if (view.funding.length) {
      heading('Funding');
      for (const f of view.funding)
        row(`${f.payer} - ${f.detail} (${f.status})`, f.weekly);
      row('You pay (per week)', view.clientWeeklyLiability, true);
    }

    if (view.clientNotes) {
      heading('Notes');
      doc.text(t(view.clientNotes), left, undefined, { width });
    }
    if (view.terms) {
      heading('Terms');
      doc.fontSize(8).text(t(view.terms), left, undefined, { width });
    }

    doc
      .moveDown(1)
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#64748b')
      .text(
        t(
          'This quotation is an estimate based on the visits described above. To accept, please contact us; acceptance is recorded by our office.',
        ),
        left,
        undefined,
        { width },
      );
    doc.end();
  });
}

const logger = new Logger('QuotePdf');

/**
 * The client PDF in the quotation design (HTML rendered by headless Chrome / Edge, as the
 * assessment PDFs are). Falls back to the plain pdfkit layout when no browser is installed.
 */
export async function buildQuotePdf(view: ClientQuoteView): Promise<Buffer> {
  try {
    return await renderHtmlToPdfBuffer(renderQuoteHtml(view), {
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
  } catch (e) {
    logger.warn(
      `HTML quotation PDF failed, using the plain layout: ${(e as Error).message}`,
    );
    return buildQuotePdfKit(view);
  }
}
