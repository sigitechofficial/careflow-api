import PDFDocument from 'pdfkit';
import type { MarChartCell } from './medication-charts.service';
import type { MarExportChartPayload, MarExportContext } from './medication-mar-export-shared.util';
import {
  cellExportCode,
  formatMedicationDetailText,
  groupMedicationRows,
} from './medication-mar-export-shared.util';

function sanitizePdfText(value: string): string {
  return value
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
}

function sanitizePdfColor(color: string | null | undefined): string | undefined {
  if (!color?.trim()) return undefined;
  const c = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(c)) return c;
  if (/^#[0-9A-Fa-f]{3}$/.test(c)) return c;
  return undefined;
}

export function buildMarExportPdf(
  ctx: MarExportContext,
  chart: MarExportChartPayload,
  _options?: import('./medication-mar-export-shared.util').MarExportRenderOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 28,
      info: {
        Title: `MAR ${chart.month}`,
        Author: 'CareAdmin',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (ctx.organisationName) {
      doc.fontSize(9).fillColor('#475569').text(ctx.organisationName, { align: 'center' });
      doc.moveDown(0.2);
    }
    doc.fontSize(14).fillColor('#0f172a').text('MEDICATION ADMINISTRATION RECORD', {
      align: 'center',
    });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#475569').text(ctx.reportMonthLabel, { align: 'center' });
    doc.text(ctx.serviceUserLabel, { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(8).fillColor('#64748b');
    const metaLines = [
      ctx.dateOfBirth ? `DOB: ${ctx.dateOfBirth}` : null,
      ctx.nhsNumber ? `NHS: ${ctx.nhsNumber}` : null,
      ctx.locationName ? `Location: ${ctx.locationName}` : null,
      ctx.allergySummary ? `Allergies: ${ctx.allergySummary}` : 'Allergies: None recorded',
      `Period: ${ctx.periodStart} to ${ctx.periodEnd}`,
      `Generated: ${ctx.generatedAt}${ctx.generatedBy ? ` by ${ctx.generatedBy}` : ''}`,
      `MAR completion: ${ctx.monthStats.marCompletionPercent ?? '—'}% through ${ctx.monthStats.completionThroughDate} (${ctx.monthStats.documented} documented, ${ctx.monthStats.stillOpen} open, ${ctx.monthStats.given} given, ${ctx.monthStats.notGiven} not given, ${ctx.monthStats.prnAdministered} PRN)`,
    ].filter(Boolean) as string[];
    for (const line of metaLines) {
      doc.text(line, { align: 'center' });
    }
    doc.moveDown(0.5);
    doc.fillColor('#0f172a');

    const days = Array.from({ length: chart.lastDay }, (_, i) => i + 1);
    const colMed = 118;
    const colSlot = 56;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right - colMed - colSlot;
    const colDay = Math.max(11, Math.floor(usable / Math.max(days.length, 1)));
    const rowH = 14;
    let y = doc.y;

    const drawRow = (
      cells: string[],
      opts?: {
        bold?: boolean;
        fill?: string;
        cellFills?: (string | undefined)[];
        cellTextColors?: (string | undefined)[];
      },
    ) => {
      let x = doc.page.margins.left;
      if (opts?.fill) {
        doc.save();
        doc.rect(x, y, colMed + colSlot + colDay * days.length, rowH).fill(opts.fill);
        doc.restore();
      }
      doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7);
      for (let i = 0; i < cells.length; i++) {
        const w = i === 0 ? colMed : i === 1 ? colSlot : colDay;
        const cellFill = opts?.cellFills?.[i];
        if (cellFill) {
          doc.save();
          doc.rect(x, y, w, rowH).fill(cellFill);
          doc.restore();
        }
        doc.fillColor(opts?.cellTextColors?.[i] ?? '#0f172a');
        doc.text(sanitizePdfText(cells[i] ?? ''), x + 2, y + 3, { width: w - 4, lineBreak: false });
        doc.fillColor('#0f172a');
        x += w;
      }
      y += rowH;
      if (y > doc.page.height - doc.page.margins.bottom - rowH * 3) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });
        y = doc.page.margins.top;
      }
    };

    drawRow(['Medication', 'Slot', ...days.map(String)], { bold: true, fill: '#f1f5f9' });

    const grouped = groupMedicationRows(chart.medications);
    for (const slots of grouped) {
      slots.forEach((row, slotIndex) => {
        const labels = days.map(d => {
          const cell = row.days.find(c => c.day === d);
          return cell ? cellExportCode(cell) : '';
        });
        const dayCells = days.map(d => row.days.find(c => c.day === d));
        const cellFills: (string | undefined)[] = [
          undefined,
          undefined,
          ...dayCells.map(cell => {
            if (!cell) return undefined;
            if (cell.cellState === 'recorded') return sanitizePdfColor(cell.color);
            if (cell.cellState === 'due') return '#fef9c3';
            if (cell.cellState === 'na') return '#f8fafc';
            if (cell.cellState === 'prn') return '#eff6ff';
            return undefined;
          }),
        ];
        const cellTextColors: (string | undefined)[] = [
          undefined,
          undefined,
          ...dayCells.map(cell => {
            if (!cell) return undefined;
            if (cell.cellState === 'recorded' && cell.textColor) return cell.textColor;
            if (cell.cellState === 'due') return '#854d0e';
            if (cell.cellState === 'na') return '#94a3b8';
            if (cell.cellState === 'prn') return '#1d4ed8';
            return '#0f172a';
          }),
        ];
        const medCol =
          slotIndex === 0
            ? sanitizePdfText(formatMedicationDetailText(row, ' | '))
            : '';
        const slotCol = sanitizePdfText(
          row.dueTime ? `${row.timeSlot} ${row.dueTime}` : row.timeSlot,
        );
        drawRow([medCol, slotCol, ...labels], { cellFills, cellTextColors });
      });
    }

    doc.moveDown(1);
    doc.font('Helvetica').fontSize(7).fillColor('#64748b');
    const legendLine = chart.legend
      .slice(0, 20)
      .map(l => `${l.code}=${l.label}`)
      .join('  ·  ');
    doc.text(legendLine, doc.page.margins.left, y + 4, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    });

    doc.end();
  });
}
