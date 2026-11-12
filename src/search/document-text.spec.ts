import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readDocumentText } from './document-text';

/** A minimal one-page PDF whose page says `text` (enough for the PDF reader). */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('readDocumentText', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-text-'));

  it('reads the text of a PDF', async () => {
    const f = join(dir, 'care-plan.pdf');
    writeFileSync(f, tinyPdf('Moving and handling risk assessment'));
    expect(await readDocumentText(f, 'care-plan.pdf', 'application/pdf')).toContain('Moving and handling risk assessment');
  });

  it('reads plain text and tidies spacing', async () => {
    const f = join(dir, 'notes.txt');
    writeFileSync(f, 'Key  safe\n\n\n  by the back door');
    expect(await readDocumentText(f, 'notes.txt', 'text/plain')).toBe('Key safe\nby the back door');
  });

  it('does not try files it cannot read (images, old Word)', async () => {
    const f = join(dir, 'photo.jpg');
    writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff]));
    expect(await readDocumentText(f, 'photo.jpg', 'image/jpeg')).toBeNull();
  });
});
