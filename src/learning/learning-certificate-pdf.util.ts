import PDFDocument from 'pdfkit';

/** Everything printed on a learning certificate (17 Nov 2026, first design — to be finalised). */
export type CertificatePdfData = {
  organisationName: string;
  /** Company logo from Settings › Company details (PNG or JPEG), or null. */
  logo?: Buffer | null;
  carerName: string;
  courseTitle: string;
  courseCode: string | null;
  deliveryLabel: string | null;
  completedAt: Date;
  issuedAt: Date;
  expiresAt: Date | null;
  cpdMinutes: number | null;
  /** One sentence on how the carer passed, e.g. "Assessed as competent by Jane Smith". */
  resultLine: string;
  trainerName: string | null;
  /** Who signed it off: the manager who recorded the outcome, or who issued it. */
  signedByName: string | null;
  signedByRole: string;
  certificateNumber: string;
  verificationCode: string;
  status: string;
  revocationReason: string | null;
};

const C = {
  ink: '#0f172a',
  muted: '#475569',
  soft: '#94a3b8',
  teal: '#0f766e',
  tealSoft: '#ccfbf1',
  gold: '#b45309',
  paper: '#fffdf8',
  red: '#b91c1c',
};

/** Helvetica (WinAnsi) cannot draw most Unicode: swap fancy punctuation, drop the rest. */
export function certificateText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E£\n]/g, '');
}

function ukDate(d: Date | null | undefined): string {
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(d);
}

function cpdLabel(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** A4 landscape certificate as a PDF buffer. */
export function buildCertificatePdf(data: CertificatePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 0,
      info: {
        Title: certificateText(`Certificate - ${data.courseTitle} - ${data.carerName}`),
        Author: certificateText(data.organisationName),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;
    const t = certificateText;

    // Paper and frame
    doc.rect(0, 0, W, H).fill(C.paper);
    doc.lineWidth(6).strokeColor(C.teal).rect(22, 22, W - 44, H - 44).stroke();
    doc.lineWidth(1).strokeColor(C.gold).rect(34, 34, W - 68, H - 68).stroke();
    // Corner accents
    for (const [x, y, sx, sy] of [
      [34, 34, 1, 1],
      [W - 34, 34, -1, 1],
      [34, H - 34, 1, -1],
      [W - 34, H - 34, -1, -1],
    ] as const) {
      doc
        .save()
        .fillColor(C.teal)
        .polygon([x, y], [x + 46 * sx, y], [x, y + 46 * sy])
        .fill()
        .restore();
    }

    const inner = { x: 70, w: W - 140 };
    let y = 66;
    if (data.logo) {
      try {
        doc.image(data.logo, W / 2 - 80, 46, { fit: [160, 44], align: 'center', valign: 'center' });
        y = 98;
      } catch {
        // Unreadable image: the certificate still prints without it.
      }
    }

    doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(13);
    doc.text(t(data.organisationName).toUpperCase(), inner.x, y, { width: inner.w, align: 'center', characterSpacing: 1.5 });
    y += data.logo ? 26 : 34;

    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(data.logo ? 30 : 34);
    doc.text('Certificate of Completion', inner.x, y, { width: inner.w, align: 'center' });
    y += data.logo ? 44 : 50;
    doc.moveTo(W / 2 - 60, y).lineTo(W / 2 + 60, y).lineWidth(2).strokeColor(C.gold).stroke();
    y += 18;

    doc.fillColor(C.muted).font('Helvetica').fontSize(13);
    doc.text('This is to certify that', inner.x, y, { width: inner.w, align: 'center' });
    y += 24;
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(28);
    doc.text(t(data.carerName), inner.x, y, { width: inner.w, align: 'center' });
    y += 42;
    doc.fillColor(C.muted).font('Helvetica').fontSize(13);
    doc.text('has successfully completed', inner.x, y, { width: inner.w, align: 'center' });
    y += 22;
    doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(20);
    doc.text(t(data.courseTitle), inner.x, y, { width: inner.w, align: 'center' });
    y = doc.y + 6;
    doc.fillColor(C.muted).font('Helvetica-Oblique').fontSize(11.5);
    doc.text(t(data.resultLine), inner.x, y, { width: inner.w, align: 'center' });
    y = doc.y + 18;

    // Facts row
    const facts: Array<[string, string]> = [
      ['Completed on', ukDate(data.completedAt)],
      ['Valid until', data.expiresAt ? ukDate(data.expiresAt) : 'No expiry'],
    ];
    if (data.deliveryLabel) facts.push(['Delivery', data.deliveryLabel]);
    const cpd = cpdLabel(data.cpdMinutes);
    if (cpd) facts.push(['Learning time', cpd]);
    if (data.courseCode) facts.push(['Course code', data.courseCode]);
    const colW = Math.min(150, inner.w / facts.length);
    let fx = W / 2 - (colW * facts.length) / 2;
    for (const [label, value] of facts) {
      doc.fillColor(C.soft).font('Helvetica').fontSize(9);
      doc.text(label.toUpperCase(), fx, y, { width: colW, align: 'center', characterSpacing: 0.8 });
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(11.5);
      doc.text(t(value), fx, y + 13, { width: colW, align: 'center' });
      fx += colW;
    }

    // Signatures
    const sigY = H - 150;
    const sigs: Array<[string, string]> = [
      [data.signedByName ?? '', data.signedByRole],
      [data.trainerName ?? '', data.trainerName ? 'Trainer' : 'Registered manager'],
    ];
    const sigW = 220;
    const sigXs = [inner.x + 40, W - inner.x - 40 - sigW];
    sigs.forEach(([name, role], i) => {
      const sx = sigXs[i];
      doc.fillColor(C.ink).font('Helvetica-Oblique').fontSize(14);
      doc.text(t(name) || ' ', sx, sigY, { width: sigW, align: 'center' });
      doc.moveTo(sx, sigY + 22).lineTo(sx + sigW, sigY + 22).lineWidth(0.8).strokeColor(C.soft).stroke();
      doc.fillColor(C.muted).font('Helvetica').fontSize(10);
      doc.text(t(role), sx, sigY + 28, { width: sigW, align: 'center' });
    });

    // Footer: number, issue date, verification
    const footY = H - 86;
    doc.fillColor(C.muted).font('Helvetica').fontSize(9);
    doc.text(
      t(`Certificate no. ${data.certificateNumber}   |   Issued ${ukDate(data.issuedAt)}   |   Verification code ${data.verificationCode}`),
      inner.x,
      footY,
      { width: inner.w, align: 'center' },
    );
    doc.fillColor(C.soft).fontSize(8.5);
    doc.text(
      t(`To check this certificate, contact ${data.organisationName} with the verification code.`),
      inner.x,
      footY + 13,
      { width: inner.w, align: 'center' },
    );

    if (data.status !== 'ACTIVE') {
      const word = data.status === 'REVOKED' ? 'REVOKED' : data.status === 'EXPIRED' ? 'EXPIRED' : data.status;
      doc.save();
      doc.rotate(-24, { origin: [W / 2, H / 2] });
      doc.fillColor(C.red).opacity(0.18).font('Helvetica-Bold').fontSize(110);
      doc.text(word, 0, H / 2 - 60, { width: W, align: 'center' });
      doc.restore();
      if (data.revocationReason) {
        doc.fillColor(C.red).font('Helvetica').fontSize(9);
        doc.text(t(`Revoked: ${data.revocationReason}`), inner.x, footY - 16, { width: inner.w, align: 'center' });
      }
    }

    doc.end();
  });
}
