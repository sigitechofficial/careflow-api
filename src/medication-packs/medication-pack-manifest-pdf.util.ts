import PDFDocument from 'pdfkit';

export type PackManifestPdfLine = {
  medicationName: string;
  strength: string | null;
  dose: string | null;
  routeName: string | null;
  roundLabels: string | null;
  instructions: string | null;
};

export type PackManifestPdfData = {
  organisationName?: string | null;
  serviceUserName: string;
  dateOfBirth?: string | null;
  packName: string;
  packTypeLabel: string;
  cycleNumber: number;
  source: 'PUBLISHED' | 'LIVE';
  pharmacyName: string | null;
  pharmacyPhone: string | null;
  gpName: string | null;
  gpSurgery: string | null;
  nhsNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  publishedAt: string | null;
  generatedAt: string;
  generatedBy?: string | null;
  lines: PackManifestPdfLine[];
};

function sanitize(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\u2026/g, '...').replace(/[^\x20-\x7E]/g, '?');
}

export function buildPackManifestPdf(data: PackManifestPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: `MCA Contents Record — ${data.packName}`, Author: 'CareAdmin' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (data.organisationName) {
      doc.fontSize(9).fillColor('#475569').text(sanitize(data.organisationName), { align: 'center' });
      doc.moveDown(0.2);
    }
    doc.fontSize(15).fillColor('#0f172a').text('MCA CONTENTS RECORD', { align: 'center' });
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor('#475569')
      .text(`${sanitize(data.packName)} — ${sanitize(data.packTypeLabel)} · Cycle ${data.cycleNumber}`, {
        align: 'center',
      });
    if (data.source === 'LIVE') {
      doc.moveDown(0.1);
      doc.fontSize(8).fillColor('#b45309').text('DRAFT — not yet published', { align: 'center' });
    }
    doc.moveDown(0.6);

    const leftCol = [
      `Service user: ${sanitize(data.serviceUserName)}`,
      data.dateOfBirth ? `DOB: ${sanitize(data.dateOfBirth)}` : null,
      `NHS number: ${sanitize(data.nhsNumber) || '-'}`,
      `Pharmacy: ${sanitize(data.pharmacyName) || '-'}`,
      `Pharmacy phone: ${sanitize(data.pharmacyPhone) || '-'}`,
    ].filter(Boolean) as string[];
    const rightCol = [
      `GP: ${sanitize(data.gpName) || '-'}`,
      `GP surgery: ${sanitize(data.gpSurgery) || '-'}`,
      `Start date: ${sanitize(data.startDate) || '-'}`,
      `Review / end date: ${sanitize(data.endDate) || '-'}`,
      `Published: ${sanitize(data.publishedAt) || '-'}`,
    ];

    const metaTop = doc.y;
    doc.fontSize(9).fillColor('#0f172a');
    doc.text(leftCol.join('\n'), 40, metaTop, { width: 250 });
    doc.text(rightCol.join('\n'), 300, metaTop, { width: 250 });
    doc.moveDown(1);

    // Table
    const tableTop = doc.y + 4;
    const cols = [
      { label: 'Medicine', x: 40, w: 130 },
      { label: 'Strength', x: 170, w: 70 },
      { label: 'Dose', x: 240, w: 70 },
      { label: 'Route', x: 310, w: 60 },
      { label: 'Round(s)', x: 370, w: 80 },
      { label: 'Instructions', x: 450, w: 105 },
    ];
    doc.fontSize(8).fillColor('#334155');
    doc.rect(40, tableTop, 515, 16).fill('#f1f5f9');
    doc.fillColor('#334155');
    for (const c of cols) {
      doc.text(c.label, c.x + 2, tableTop + 4, { width: c.w - 4 });
    }
    let y = tableTop + 16;
    doc.fillColor('#0f172a').fontSize(8);
    for (const line of data.lines) {
      const cells = [
        sanitize(line.medicationName),
        sanitize(line.strength),
        sanitize(line.dose),
        sanitize(line.routeName),
        sanitize(line.roundLabels),
        sanitize(line.instructions),
      ];
      const heights = cols.map((c, i) => doc.heightOfString(cells[i] || '-', { width: c.w - 4 }));
      const rowH = Math.max(14, ...heights) + 4;
      if (y + rowH > doc.page.height - 60) {
        doc.addPage();
        y = 40;
      }
      doc.rect(40, y, 515, rowH).stroke('#e2e8f0');
      cols.forEach((c, i) => {
        doc.text(cells[i] || '-', c.x + 2, y + 3, { width: c.w - 4 });
      });
      y += rowH;
    }
    if (data.lines.length === 0) {
      doc.text('No medicines linked to this pack.', 44, y + 4);
      y += 20;
    }

    doc.moveDown(2);
    doc.y = Math.max(doc.y, y + 20);
    doc.fontSize(8).fillColor('#475569');
    doc.text(
      `Generated: ${sanitize(data.generatedAt)}${data.generatedBy ? ` by ${sanitize(data.generatedBy)}` : ''}`,
    );
    doc.moveDown(1.5);
    doc.fontSize(9).fillColor('#0f172a');
    doc.text('Checked and confirmed accurate by: ___________________________    Date: _______________');
    doc.moveDown(0.8);
    doc.fontSize(7).fillColor('#94a3b8').text('This document must be kept with the medication.');

    doc.end();
  });
}
