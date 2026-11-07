/**
 * A policy as a document to download: PDF (the same layout as the admin app's print page, made by headless Chrome)
 * and Word (.docx, built here). Both take one model so they always say the same thing: the organisation and logo,
 * the reference and type, title and summary, a draft or ready-made note, the details table, the policy text, any
 * legal sources, the end note, and on every page the reference, version and page number.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';

export type PolicyExportModel = {
  organisation: string;
  logo: { data: Buffer; type: 'png' | 'jpg' } | null;
  /** e.g. "Policy", "Procedure". */
  kindLabel: string;
  reference: string;
  title: string;
  summary: string | null;
  notice: { tone: 'draft' | 'info'; text: string } | null;
  /** Faint word across every page (PDF) / in the page header (Word), e.g. DRAFT. */
  watermark: string | null;
  details: Array<[string, string]>;
  /** The policy text (sanitised HTML). */
  contentHtml: string;
  appendix: { heading: string; items: Array<{ text: string; url?: string | null }> } | null;
  /** Left of the footer on every page. */
  footer: string;
  printedBy: string;
  printedAt: Date;
  timeZone: string;
};

export const POLICY_KIND_LABELS: Record<string, string> = {
  POLICY: 'Policy',
  PROCEDURE: 'Procedure',
  PROTOCOL: 'Protocol',
  GUIDELINE: 'Guideline',
};

/** "5 Nov 2026" (or "—"). */
export function exportDate(v: string | Date | null | undefined, timeZone = 'Europe/London'): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v.length === 10 ? `${v}T12:00:00Z` : v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone });
}

/** A file name from the reference and title: "POL-MED-001 Medicines Management Policy v1.0.pdf". */
export function exportFileName(parts: string[], ext: 'pdf' | 'docx'): string {
  const base = parts
    .filter(Boolean)
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${base || 'policy'}.${ext}`;
}

/** Width and height of a PNG or JPEG (for placing the logo without stretching it). */
export function imageSize(data: Buffer): { width: number; height: number } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = data[i + 1]!;
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── PDF (HTML for headless Chrome) ──────────────────────────────────────────

const PAPER_CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 10.5pt; line-height: 1.55; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.masthead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #0f766e; }
.org { display: flex; align-items: center; gap: 10px; }
.logo { max-height: 14mm; max-width: 45mm; object-fit: contain; }
.orgname { font-size: 11pt; font-weight: 600; }
.kind { display: flex; flex-direction: column; align-items: flex-end; text-align: right; font-size: 8.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #0f766e; }
.ref { margin-top: 2px; font-weight: 500; letter-spacing: .02em; text-transform: none; color: #4b5563; }
h1.title { margin: 9mm 0 3mm; font-size: 20pt; line-height: 1.2; font-weight: 700; letter-spacing: -.01em; color: #0b1220; }
.summary { margin: 0 0 5mm; font-size: 11pt; line-height: 1.5; color: #374151; }
.note { margin: 0 0 5mm; padding: 3mm 4mm; border: 1px solid; border-left-width: 4px; font-size: 9.5pt; }
.note.draft { border-color: #f59e0b; background: #fffbeb; color: #78350f; }
.note.info { border-color: #99d5cf; background: #f0fdfa; color: #134e4a; }
table.details { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 0 0 6mm; page-break-inside: avoid; }
table.details th, table.details td { padding: 2.2mm 3mm; border: 1px solid #e3e6ea; text-align: left; vertical-align: top; }
table.details th { width: 22%; background: #f6f7f9; font-weight: 600; color: #4b5563; }
table.details td { width: 28%; }
.content { font-size: 10.5pt; line-height: 1.6; orphans: 3; widows: 3; }
.content > :first-child { margin-top: 0; }
.content h1 { font-size: 15pt; margin: 8mm 0 3mm; font-weight: 700; }
.content h2 { margin: 7mm 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 1px solid #d9dde3; font-size: 13pt; line-height: 1.3; font-weight: 700; color: #0b1220; page-break-after: avoid; break-after: avoid; }
.content h3 { margin: 5mm 0 2mm; font-size: 11pt; line-height: 1.35; font-weight: 700; color: #0b1220; page-break-after: avoid; break-after: avoid; }
.content h4 { margin: 4mm 0 1.5mm; font-size: 10.5pt; font-weight: 700; page-break-after: avoid; }
.content p { margin: 0 0 3mm; }
.content ul, .content ol { margin: 0 0 3.5mm; padding-left: 6.5mm; }
.content li { margin: 1.2mm 0; padding-left: .8mm; page-break-inside: avoid; }
.content li > p { margin: 0; }
.content strong, .content b { font-weight: 700; }
.content a { color: #0f766e; text-decoration: underline; }
.content blockquote { margin: 0 0 4mm; padding: 2mm 4mm; border-left: 3px solid #cbd2d9; color: #374151; }
.content table { width: 100%; margin: 1mm 0 4mm; border-collapse: collapse; font-size: 9pt; }
.content thead { display: table-header-group; }
.content tr { page-break-inside: avoid; }
.content th, .content td { padding: 1.8mm 2.5mm; border: 1px solid #d9dde3; text-align: left; vertical-align: top; }
.content th { background: #f3f5f7; font-weight: 700; }
.appendix { margin-top: 8mm; page-break-inside: avoid; }
.appendix h2 { margin: 0 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 1px solid #d9dde3; font-size: 12pt; font-weight: 700; color: #0b1220; }
.appendix ul { margin: 0; padding-left: 6.5mm; font-size: 9.5pt; }
.appendix li { margin: 1mm 0; }
.appendix .url { color: #4b5563; word-break: break-all; }
.end { margin-top: 10mm; padding-top: 3mm; border-top: 1px solid #d9dde3; font-size: 8.5pt; color: #6b7280; page-break-inside: avoid; }
.end p { margin: 0 0 1mm; }
.endmark { font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #4b5563; }
.watermark { position: fixed; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-size: 96pt; font-weight: 800; letter-spacing: .1em; color: rgba(217, 119, 6, .09); transform: rotate(-30deg); z-index: 0; }
.page { position: relative; z-index: 1; }
`;

/** The footer Chrome repeats on every page (inline styles only; .pageNumber / .totalPages are filled in). */
export function policyPdfFooter(m: PolicyExportModel): string {
  return `<div style="width:100%;padding:0 17mm;display:flex;justify-content:space-between;gap:12px;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#6b7280;">
<span>${esc(m.footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

export function policyExportHtml(m: PolicyExportModel): string {
  const logo = m.logo ? `<img class="logo" src="data:image/${m.logo.type === 'jpg' ? 'jpeg' : 'png'};base64,${m.logo.data.toString('base64')}" alt="">` : '';
  const rows: string[] = [];
  for (let i = 0; i < m.details.length; i += 2) {
    rows.push(
      `<tr>${m.details
        .slice(i, i + 2)
        .map(([l, v]) => `<th>${esc(l)}</th><td>${esc(v)}</td>`)
        .join('')}</tr>`,
    );
  }
  const appendix = m.appendix?.items.length
    ? `<section class="appendix"><h2>${esc(m.appendix.heading)}</h2><ul>${m.appendix.items
        .map((it) => `<li>${esc(it.text)}${it.url ? ` <span class="url">${esc(it.url)}</span>` : ''}</li>`)
        .join('')}</ul></section>`
    : '';
  const printedOn = m.printedAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: m.timeZone });
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(`${m.reference} ${m.title}`)}</title><style>${PAPER_CSS}</style></head><body>
${m.watermark ? `<div class="watermark">${esc(m.watermark)}</div>` : ''}
<div class="page">
<header class="masthead"><div class="org">${logo}${m.organisation ? `<span class="orgname">${esc(m.organisation)}</span>` : ''}</div>
<div class="kind"><span>${esc(m.kindLabel)}</span><span class="ref">${esc(m.reference)}</span></div></header>
<h1 class="title">${esc(m.title)}</h1>
${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : ''}
${m.notice ? `<p class="note ${m.notice.tone}">${esc(m.notice.text)}</p>` : ''}
<table class="details"><tbody>${rows.join('')}</tbody></table>
<div class="content">${m.contentHtml}</div>
${appendix}
<footer class="end"><p class="endmark">End of document</p><p>Printed ${esc(printedOn)}${m.printedBy ? ` by ${esc(m.printedBy)}` : ''}. Printed copies are not controlled: check CareFlow for the current version before relying on this copy.</p></footer>
</div></body></html>`;
}

// ─── Word (.docx) ────────────────────────────────────────────────────────────

const FONT = 'Calibri';
const INK = '111827';
const MUTED = '4B5563';
const SOFT = '6B7280';
const TEAL = '0F766E';
const LINE = 'D9DDE3';
/** Twips per millimetre. */
const MM = 56.7;

type RunStyle = { bold?: boolean; italics?: boolean; underline?: boolean; code?: boolean; sup?: boolean; sub?: boolean };

function run(text: string, s: RunStyle = {}, extra: Partial<IRunOptions> = {}): TextRun {
  return new TextRun({
    text,
    bold: s.bold,
    italics: s.italics,
    underline: s.underline ? {} : undefined,
    font: s.code ? 'Consolas' : undefined,
    superScript: s.sup,
    subScript: s.sub,
    ...extra,
  } as IRunOptions);
}

const isEl = (n: ChildNode): n is Element => n.type === 'tag' || n.type === 'script' || n.type === 'style';
const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'hr', 'section', 'article']);

/** Inline content of nodes as runs (bold, italics, links, line breaks). */
function inlineRuns(nodes: ChildNode[], style: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      const text = n.data.replace(/\s+/g, ' ');
      if (text) out.push(run(text, style));
      continue;
    }
    if (!isEl(n)) continue;
    const tag = n.name.toLowerCase();
    if (tag === 'br') {
      out.push(new TextRun({ break: 1 }));
      continue;
    }
    if (tag === 'a') {
      const href = n.attribs.href ?? '';
      const children = inlineRuns(n.children, { ...style, underline: true }).map((r) =>
        r instanceof TextRun ? r : r,
      ) as TextRun[];
      if (/^https?:\/\//i.test(href)) {
        out.push(new ExternalHyperlink({ link: href, children: children.length ? children : [run(href, { underline: true })] }));
      } else {
        out.push(...children);
      }
      continue;
    }
    const next: RunStyle = {
      ...style,
      ...(tag === 'strong' || tag === 'b' ? { bold: true } : {}),
      ...(tag === 'em' || tag === 'i' ? { italics: true } : {}),
      ...(tag === 'u' ? { underline: true } : {}),
      ...(tag === 'code' ? { code: true } : {}),
      ...(tag === 'sup' ? { sup: true } : {}),
      ...(tag === 'sub' ? { sub: true } : {}),
    };
    out.push(...inlineRuns(n.children, next));
  }
  return out;
}

/** Trims spaces at the start and end of a paragraph's runs (HTML whitespace between tags). */
function trimRuns(runs: ParagraphChild[]): ParagraphChild[] {
  return runs;
}

type Ctx = { orderedInstance: number };

/** HTML blocks as Word paragraphs and tables. */
function blocksFromHtml(nodes: ChildNode[], ctx: Ctx, listLevel = -1): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  let pending: ChildNode[] = [];
  const flush = () => {
    const runs = trimRuns(inlineRuns(pending));
    pending = [];
    if (runs.length) out.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
  };
  for (const n of nodes) {
    if (!isEl(n) || !BLOCKS.has(n.name.toLowerCase())) {
      if (n.type === 'text' && !n.data.trim() && !pending.length) continue;
      pending.push(n);
      continue;
    }
    flush();
    const tag = n.name.toLowerCase();
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = { h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3 }[tag as 'h1' | 'h2' | 'h3'] ?? HeadingLevel.HEADING_4;
        out.push(new Paragraph({ heading: level, children: inlineRuns(n.children), keepNext: true }));
        break;
      }
      case 'ul':
      case 'ol': {
        const instance = tag === 'ol' ? ++ctx.orderedInstance : 0;
        for (const li of n.children) {
          if (!isEl(li) || li.name.toLowerCase() !== 'li') continue;
          const own = li.children.filter((c) => !(isEl(c) && ['ul', 'ol'].includes(c.name.toLowerCase())));
          const nested = li.children.filter((c) => isEl(c) && ['ul', 'ol'].includes(c.name.toLowerCase()));
          // A list item's own text: its inline content (paragraphs inside it are joined).
          const runs = own.flatMap((c) => (isEl(c) && c.name.toLowerCase() === 'p' ? inlineRuns(c.children) : inlineRuns([c])));
          out.push(
            new Paragraph({
              children: runs,
              numbering: { reference: tag === 'ol' ? 'policy-ordered' : 'policy-bullets', level: Math.min(listLevel + 1, 3), instance },
              spacing: { after: 60 },
            }),
          );
          out.push(...blocksFromHtml(nested, ctx, listLevel + 1));
        }
        break;
      }
      case 'li':
        out.push(new Paragraph({ children: inlineRuns(n.children), numbering: { reference: 'policy-bullets', level: Math.max(0, listLevel), instance: 0 } }));
        break;
      case 'table':
        out.push(tableFromHtml(n, ctx));
        out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
        break;
      case 'blockquote':
        for (const b of blocksFromHtml(n.children, ctx, listLevel)) {
          out.push(
            b instanceof Paragraph
              ? new Paragraph({
                  children: inlineRuns(isEl(n) ? n.children : []),
                  indent: { left: 6 * MM },
                  border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'CBD2D9', space: 8 } },
                  spacing: { after: 160 },
                })
              : b,
          );
          break;
        }
        break;
      case 'hr':
        out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 4 } } }));
        break;
      default:
        // p, div, section, article
        if (n.children.some((c) => isEl(c) && BLOCKS.has(c.name.toLowerCase()))) out.push(...blocksFromHtml(n.children, ctx, listLevel));
        else {
          const runs = inlineRuns(n.children);
          if (runs.length) out.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
        }
    }
  }
  flush();
  return out;
}

function tableFromHtml(table: Element, ctx: Ctx): Table {
  const rows: TableRow[] = [];
  const walk = (nodes: ChildNode[], inHead: boolean) => {
    for (const n of nodes) {
      if (!isEl(n)) continue;
      const tag = n.name.toLowerCase();
      if (tag === 'thead') walk(n.children, true);
      else if (tag === 'tbody' || tag === 'tfoot') walk(n.children, false);
      else if (tag === 'tr') {
        const cells = n.children.filter((c): c is Element => isEl(c) && ['td', 'th'].includes(c.name.toLowerCase()));
        if (!cells.length) continue;
        const head = inHead || cells.every((c) => c.name.toLowerCase() === 'th');
        rows.push(
          new TableRow({
            tableHeader: head,
            cantSplit: true,
            children: cells.map((c) => {
              const isTh = c.name.toLowerCase() === 'th';
              const content = blocksFromHtml(c.children, ctx).filter((b): b is Paragraph => b instanceof Paragraph);
              return new TableCell({
                children: content.length
                  ? isTh
                    ? [new Paragraph({ children: inlineRuns(c.children, { bold: true }) })]
                    : content
                  : [new Paragraph({ children: [] })],
                shading: isTh ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F5F7' } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                columnSpan: Number(c.attribs.colspan) > 1 ? Number(c.attribs.colspan) : undefined,
              });
            }),
          }),
        );
      }
    }
  };
  walk(table.children, false);
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.length ? rows : [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [] })] })] })],
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  });
}

/** The policy text as Word paragraphs and tables (for tests and the document). */
export function docxBlocksFromHtml(html: string): Array<Paragraph | Table> {
  const dom = parseDocument(html || '', { decodeEntities: true });
  return blocksFromHtml(dom.children, { orderedInstance: 0 });
}

export async function policyExportDocx(m: PolicyExportModel): Promise<Buffer> {
  const body: Array<Paragraph | Table> = [];

  // Masthead: logo and organisation on the left, type and reference on the right; a teal rule under it.
  const logoRun = (() => {
    if (!m.logo) return null;
    const size = imageSize(m.logo.data);
    const height = 40;
    const width = size && size.height ? Math.min(170, Math.round((size.width / size.height) * height)) : 120;
    return new ImageRun({ type: m.logo.type, data: m.logo.data, transformation: { width, height } });
  })();
  body.push(
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 176 * MM }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 6 } },
      spacing: { after: 360 },
      children: [
        ...(logoRun ? [logoRun, run('  ')] : []),
        run(m.organisation, { bold: true }, { size: 22, color: INK }),
        run('\t'),
        run(m.kindLabel.toUpperCase(), { bold: true }, { size: 17, color: TEAL, characterSpacing: 30 }),
        run('  '),
        run(m.reference, {}, { size: 17, color: MUTED }),
      ],
    }),
  );
  body.push(new Paragraph({ children: [run(m.title, { bold: true }, { size: 40, color: '0B1220' })], spacing: { after: 120 } }));
  if (m.summary) body.push(new Paragraph({ children: [run(m.summary, {}, { size: 22, color: '374151' })], spacing: { after: 240 } }));
  if (m.notice) {
    const draft = m.notice.tone === 'draft';
    body.push(
      new Paragraph({
        children: [run(m.notice.text, {}, { size: 19, color: draft ? '78350F' : '134E4A' })],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: draft ? 'FFFBEB' : 'F0FDFA' },
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: draft ? 'F59E0B' : '99D5CF', space: 6 } },
        spacing: { before: 60, after: 240 },
        indent: { left: 2 * MM },
      }),
    );
  }

  // Details: two label/value pairs a row.
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: 'E3E6EA' };
  const detailRows: TableRow[] = [];
  for (let i = 0; i < m.details.length; i += 2) {
    const pair = m.details.slice(i, i + 2);
    while (pair.length < 2) pair.push(['', '']);
    detailRows.push(
      new TableRow({
        cantSplit: true,
        children: pair.flatMap(([label, value]) => [
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F6F7F9' },
            margins: { top: 70, bottom: 70, left: 110, right: 110 },
            children: [new Paragraph({ children: [run(label, { bold: true }, { size: 18, color: MUTED })] })],
          }),
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE },
            margins: { top: 70, bottom: 70, left: 110, right: 110 },
            children: [new Paragraph({ children: [run(value, {}, { size: 18, color: INK })] })],
          }),
        ]),
      }),
    );
  }
  body.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: detailRows,
      borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder, insideHorizontal: cellBorder, insideVertical: cellBorder },
    }),
  );
  body.push(new Paragraph({ children: [], spacing: { after: 240 } }));

  body.push(...docxBlocksFromHtml(m.contentHtml));

  if (m.appendix?.items.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(m.appendix.heading)], keepNext: true }));
    for (const it of m.appendix.items) {
      body.push(
        new Paragraph({
          numbering: { reference: 'policy-bullets', level: 0, instance: 0 },
          children: [
            run(it.text, {}, { size: 19 }),
            ...(it.url ? [run('  '), new ExternalHyperlink({ link: it.url, children: [run(it.url, { underline: true }, { size: 17, color: SOFT })] })] : []),
          ],
        }),
      );
    }
  }

  const printedOn = m.printedAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: m.timeZone });
  body.push(
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } },
      spacing: { before: 480, after: 40 },
      keepNext: true,
      children: [run('END OF DOCUMENT', { bold: true }, { size: 16, color: MUTED, characterSpacing: 30 })],
    }),
    new Paragraph({
      children: [
        run(
          `Printed ${printedOn}${m.printedBy ? ` by ${m.printedBy}` : ''}. Printed copies are not controlled: check CareFlow for the current version before relying on this copy.`,
          {},
          { size: 16, color: SOFT },
        ),
      ],
    }),
  );

  const doc = new Document({
    creator: m.organisation || 'CareFlow',
    title: `${m.reference} ${m.title}`,
    description: m.summary ?? undefined,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: INK }, paragraph: { spacing: { line: 300 } } },
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: '0B1220', font: FONT }, paragraph: { spacing: { before: 360, after: 120 } } },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, color: '0B1220', font: FONT },
          paragraph: { spacing: { before: 320, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } } },
        },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '0B1220', font: FONT }, paragraph: { spacing: { before: 240, after: 80 } } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, font: FONT }, paragraph: { spacing: { before: 200, after: 60 } } },
      ],
      characterStyles: [{ id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: TEAL, underline: {} } }],
    },
    numbering: {
      config: [
        {
          reference: 'policy-bullets',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ['•', '–', '▪', '•'][level]!,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360 + level * 360, hanging: 260 } } },
          })),
        },
        {
          reference: 'policy-ordered',
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL][level]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 400 + level * 360, hanging: 300 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: Math.round(18 * MM), bottom: Math.round(20 * MM), left: Math.round(17 * MM), right: Math.round(17 * MM), footer: Math.round(9 * MM) },
          },
        },
        headers: m.watermark
          ? {
              default: new Header({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [run(`${m.watermark} · not published`, { bold: true }, { size: 16, color: 'B45309', characterSpacing: 20 })],
                  }),
                ],
              }),
            }
          : undefined,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: 176 * MM }],
                children: [
                  run(m.footer, {}, { size: 15, color: SOFT }),
                  new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: SOFT }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
