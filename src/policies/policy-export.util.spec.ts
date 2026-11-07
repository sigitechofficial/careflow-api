import JSZip from 'jszip';
import {
  docxBlocksFromHtml,
  exportDate,
  exportFileName,
  imageSize,
  policyExportDocx,
  policyExportHtml,
  policyPdfFooter,
  type PolicyExportModel,
} from './policy-export.util';

const model = (over: Partial<PolicyExportModel> = {}): PolicyExportModel => ({
  organisation: 'Allfor Care',
  logo: null,
  kindLabel: 'Policy',
  reference: 'POL-MED-001',
  title: 'Medicines <Management> Policy',
  summary: 'How we support people with their medicines.',
  notice: null,
  watermark: null,
  details: [
    ['Reference', 'POL-MED-001'],
    ['Version', 'v1.0'],
    ['Status', 'Published'],
  ],
  contentHtml:
    '<h2>1. Policy statement</h2><p>We support <strong>people</strong> with <a href="https://example.test/x">medicines</a>.</p>' +
    '<ul><li>First</li><li>Second<ul><li>Nested</li></ul></li></ul><ol><li>One</li></ol>' +
    '<table><thead><tr><th>Who</th><th>Does</th></tr></thead><tbody><tr><td>Carer</td><td>Prompts</td></tr></tbody></table>',
  appendix: { heading: 'Legislation and guidance', items: [{ text: 'Care Act 2014', url: 'https://www.legislation.gov.uk/ukpga/2014/23' }] },
  footer: 'POL-MED-001 · Medicines Management Policy · v1.0',
  printedBy: 'Sam Lee',
  printedAt: new Date('2026-11-07T15:00:00Z'),
  timeZone: 'Europe/London',
  ...over,
});

describe('policy export: shared bits', () => {
  it('dates and file names read well', () => {
    expect(exportDate('2026-11-05')).toBe('5 Nov 2026');
    expect(exportDate(null)).toBe('—');
    expect(exportFileName(['POL-MED-001', 'Medicines: "Management"/Policy', 'v1.0', ''], 'pdf')).toBe('POL-MED-001 Medicines Management Policy v1.0.pdf');
  });

  it('reads PNG and JPEG sizes (so the logo keeps its shape)', () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(400, 16);
    png.writeUInt32BE(100, 20);
    expect(imageSize(png)).toEqual({ width: 400, height: 100 });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0x96, 0, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ width: 150, height: 50 });
    expect(imageSize(Buffer.from('not an image'))).toBeNull();
  });
});

describe('policy export: PDF page', () => {
  it('escapes the details, shows the draft note and watermark, and lists the sources', () => {
    const html = policyExportHtml(model({ notice: { tone: 'draft', text: 'Draft. Not published.' }, watermark: 'DRAFT' }));
    expect(html).toContain('Medicines &lt;Management&gt; Policy');
    expect(html).toContain('class="note draft"');
    expect(html).toContain('<div class="watermark">DRAFT</div>');
    expect(html).toContain('<h2>1. Policy statement</h2>');
    expect(html).toContain('Legislation and guidance');
    expect(html).toContain('Printed 7 Nov 2026, 15:00 by Sam Lee');
  });

  it('puts the reference and page numbers in the footer of every page', () => {
    const footer = policyPdfFooter(model());
    expect(footer).toContain('POL-MED-001 · Medicines Management Policy · v1.0');
    expect(footer).toContain('<span class="pageNumber"></span> of <span class="totalPages"></span>');
  });
});

describe('policy export: Word', () => {
  it('turns the policy text into headings, lists (nested), tables and links', () => {
    const blocks = docxBlocksFromHtml(model().contentHtml);
    const kinds = blocks.map((b) => b.constructor.name);
    expect(kinds).toContain('Table');
    expect(blocks.length).toBeGreaterThanOrEqual(7);
  });

  it('makes a valid .docx with the title, details, text, sources and page numbers in the footer', async () => {
    const buffer = await policyExportDocx(model({ watermark: 'DRAFT', notice: { tone: 'draft', text: 'Draft. Not published.' } }));
    const zip = await JSZip.loadAsync(buffer);
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('Medicines &lt;Management&gt; Policy');
    expect(doc).toContain('1. Policy statement');
    expect(doc).toContain('w:val="Heading2"');
    expect(doc).toContain('<w:numPr>');
    expect(doc).toContain('w:hyperlink');
    expect(doc).toContain('Care Act 2014');
    expect(doc).toContain('END OF DOCUMENT');
    const footerName = Object.keys(zip.files).find((n) => /^word\/footer\d+\.xml$/.test(n))!;
    const footer = await zip.file(footerName)!.async('string');
    expect(footer).toContain('NUMPAGES');
    const headerName = Object.keys(zip.files).find((n) => /^word\/header\d+\.xml$/.test(n))!;
    expect(await zip.file(headerName)!.async('string')).toContain('DRAFT · not published');
  });
});
