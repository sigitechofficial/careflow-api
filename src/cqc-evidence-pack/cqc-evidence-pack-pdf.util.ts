import PDFDocument from 'pdfkit';
import {
  SOURCE_TYPE_LABELS,
  metricsLine,
  pdfText,
  type ExportEvidence,
  type ExportPack,
  type ExportStatement,
} from '../cqc-evidence/cqc-evidence-export.util';
import { RATING_LABELS } from '../cqc-mock-inspection/cqc-mock-inspection-pdf.util';
import type { CqcRating } from '../cqc-mock-inspection/cqc-mock-inspection-scoring.util';

export type PackPolicy = {
  policyId: string;
  versionId: string;
  reference: string;
  title: string;
  documentType: string;
  versionLabel: string;
  publishedAt: Date | null;
  reviewDate: Date | null;
  reviewOverdue: boolean;
  /** Published as an uploaded document (added to the ZIP as it was uploaded). */
  uploaded: boolean;
  uploadedFileName: string | null;
};

export type PackMockScore = {
  score: number;
  label: string | null;
  /** The top of the scale (4 on the CQC scale). */
  outOf: number;
  inspectionTitle: string;
  completedAt: Date | null;
  /** The branch inspected; null for the whole organisation. */
  branchName: string | null;
};

export type PackMockAction = {
  title: string;
  owner: string | null;
  dueAt: Date | null;
  overdue: boolean;
};

export type PackLatestInspection = {
  title: string;
  completedAt: Date | null;
  branchName: string | null;
  overall: CqcRating | null;
  keyQuestions: Array<{ code: string; rating: CqcRating | null }>;
};

export type PackEvidence = ExportEvidence & { filesFolder: string | null };

/** The service's CQC registration: the provider and each registered branch in the pack. */
export type PackServiceDetails = {
  provider: {
    name: string;
    legalName: string | null;
    cqcProviderId: string | null;
    address: string | null;
  };
  locations: Array<{
    name: string;
    cqcLocationId: string | null;
    address: string | null;
    contact: string | null;
    registeredManagers: string[];
    nominatedIndividual: string | null;
    regulatedActivities: string[];
    serviceTypes: string[];
    registeredSince: Date | null;
    rating: string | null;
  }>;
};

export type PackKeyGroup = {
  title: string;
  figures: Array<{ label: string; value: string; note?: string }>;
};

/** Counts from the last 12 months; `hidden` names the groups the user may not see. */
export type PackKeyData = {
  from: Date;
  to: Date;
  groups: PackKeyGroup[];
  hidden: string[];
};

export type PackStatement = Omit<ExportStatement, 'evidence'> & {
  keyQuestionCode: string;
  /** "2.3": key question, then statement, as the framework numbers them. */
  number: string;
  evidence: PackEvidence[];
  policies: PackPolicy[];
  mock: PackMockScore | null;
  actions: PackMockAction[];
};

export type EvidencePack = Omit<ExportPack, 'statements'> & {
  format: 'pdf' | 'zip';
  includesFiles: boolean;
  includesPolicies: boolean;
  latestInspection: PackLatestInspection | null;
  /** CQC registration and key figures (null when not loaded, e.g. in older tests). */
  service?: PackServiceDetails | null;
  keyData?: PackKeyData | null;
  statements: PackStatement[];
};

const C = {
  brand: '#0b5d3b',
  brandSoft: '#eaf5ef',
  brandText: '#cfe6da',
  ink: '#0f172a',
  body: '#1e293b',
  muted: '#5b6b80',
  line: '#dbe2ea',
  soft: '#f6f8fa',
  amber: '#a14a06',
  amberSoft: '#fff6eb',
  amberLine: '#f2b46b',
  white: '#ffffff',
};

const RATING_COLOURS: Record<CqcRating, string> = {
  OUTSTANDING: '#047857',
  GOOD: '#15803d',
  REQUIRES_IMPROVEMENT: '#c2410c',
  INADEQUATE: '#b91c1c',
};

const SCORE_COLOURS: Record<number, string> = {
  1: '#b91c1c',
  2: '#c2410c',
  3: '#15803d',
  4: '#047857',
};

export const ukDate = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/London',
      }).format(d)
    : '';

/** "12 Sep 2026" for one day, "1 Jul 2026 to 30 Sep 2026" for a period. */
export function periodText(start: Date | null, end: Date | null): string {
  if (start && end) {
    return ukDate(start) === ukDate(end)
      ? ukDate(end)
      : `${ukDate(start)} to ${ukDate(end)}`;
  }
  if (end) return `Up to ${ukDate(end)}`;
  if (start) return `From ${ukDate(start)}`;
  return 'Not given';
}

/** "1 item", "3 items". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Where a mock score or rating comes from, in words. */
export const mockSource = (m: {
  inspectionTitle?: string;
  title?: string;
  branchName: string | null;
  completedAt: Date | null;
}) =>
  `"${m.inspectionTitle ?? m.title}" (${m.branchName ?? 'whole organisation'}), completed ${ukDate(m.completedAt)}`;

/** Key questions in pack order, each with its statements. */
export function groupByKeyQuestion(
  statements: PackStatement[],
): Array<{ title: string; code: string; statements: PackStatement[] }> {
  const out: Array<{
    title: string;
    code: string;
    statements: PackStatement[];
  }> = [];
  for (const s of statements) {
    const last = out[out.length - 1];
    if (last && last.title === s.keyQuestionTitle) last.statements.push(s);
    else
      out.push({
        title: s.keyQuestionTitle,
        code: s.keyQuestionCode,
        statements: [s],
      });
  }
  return out;
}

/** Evidence whose review date has passed. */
export function reviewOverdue(e: ExportEvidence, now: Date): boolean {
  return Boolean(e.reviewDueAt && e.reviewDueAt.getTime() < now.getTime());
}

/** What needs attention before an inspection, as short lines. */
export function attentionLines(pack: EvidencePack): string[] {
  const now = pack.generatedAt;
  const lines: string[] = [];
  const gaps = pack.statements.filter((s) => !s.evidence.length);
  if (gaps.length === pack.statements.length && gaps.length > 1) {
    lines.push(
      `None of the ${gaps.length} quality statements has current evidence yet.`,
    );
  } else if (gaps.length) {
    lines.push(
      `${plural(gaps.length, 'statement')} with no current evidence: ${gaps.map((g) => `${g.number} ${g.title}`).join('; ')}.`,
    );
  }
  const overdueEvidence = new Map<string, string>();
  for (const s of pack.statements)
    for (const e of s.evidence)
      if (reviewOverdue(e, now)) overdueEvidence.set(e.id, e.title);
  if (overdueEvidence.size) {
    lines.push(
      `Evidence past its review date: ${[...overdueEvidence.values()].join('; ')}.`,
    );
  }
  const overduePolicies = new Map<string, string>();
  for (const s of pack.statements)
    for (const p of s.policies)
      if (p.reviewOverdue)
        overduePolicies.set(p.policyId, `${p.reference} ${p.title}`);
  if (overduePolicies.size) {
    lines.push(
      `Policies past their review date: ${[...overduePolicies.values()].join('; ')}.`,
    );
  }
  const overdueActions = pack.statements.flatMap((s) =>
    s.actions.filter((a) => a.overdue),
  );
  if (overdueActions.length) {
    lines.push(
      `${plural(overdueActions.length, 'improvement action')} past the due date.`,
    );
  }
  return lines;
}

type Render = { buffer: Buffer; pageOf: Map<string, number> };

/**
 * The pack as a PDF. Laid out twice: the first pass finds the page of each statement for the contents, the second
 * prints them (the contents take the same room both times, so the pages do not move).
 */
export async function buildEvidencePackPdf(
  pack: EvidencePack,
): Promise<Buffer> {
  const first = await renderPack(pack, null);
  const second = await renderPack(pack, first.pageOf);
  return second.buffer;
}

function renderPack(
  pack: EvidencePack,
  pages: Map<string, number> | null,
): Promise<Render> {
  return new Promise((resolve, reject) => {
    const M = 46;
    const FOOTER = 30;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M, bottom: M + FOOTER, left: M, right: M },
      bufferPages: true,
      info: {
        Title: pdfText(`CQC evidence pack - ${pack.scopeLabel}`),
        Author: pdfText(pack.organisationName),
      },
    });
    const chunks: Buffer[] = [];
    const pageOf = new Map<string, number>();
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageOf }));
    doc.on('error', reject);

    const L = M;
    const W = doc.page.width - 2 * M;
    const R = L + W;
    const bottom = () => doc.page.height - M - FOOTER;
    const pageNo = () =>
      doc.bufferedPageRange().start + doc.bufferedPageRange().count;
    const groups = groupByKeyQuestion(pack.statements);
    const now = pack.generatedAt;

    // ─── Helpers ──────────────────────────────────────────────────────────
    const font = (bold: boolean, size: number, colour: string) =>
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(colour);
    /** Text at a fixed place; with a width it wraps, otherwise one line. */
    const put = (
      s: string,
      x: number,
      y: number,
      opts: PDFKit.Mixins.TextOptions = {},
    ) =>
      doc.text(pdfText(s), x, y, {
        lineBreak: opts.width !== undefined,
        ...opts,
      });
    const heightOf = (
      s: string,
      bold: boolean,
      size: number,
      width: number,
      lineGap = 1.5,
    ) => {
      font(bold, size, C.ink);
      return doc.heightOfString(pdfText(s), { width, lineGap });
    };
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    const pill = (
      label: string,
      x: number,
      y: number,
      fill: string,
      colour = C.white,
      size = 8,
    ) => {
      font(true, size, colour);
      const w = doc.widthOfString(pdfText(label)) + 14;
      const h = size + 8;
      doc.roundedRect(x, y, w, h, h / 2).fill(fill);
      font(true, size, colour);
      put(label, x + 7, y + 4.2);
      return w;
    };
    const pillWidth = (label: string, size = 8) => {
      font(true, size, C.white);
      return doc.widthOfString(pdfText(label)) + 14;
    };
    const rule = (y: number, colour = C.line) =>
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(colour).stroke();
    /** A heading with a brand bar; keeps `need` points with it on the page. */
    const heading = (title: string, sub?: string, need = 90) => {
      ensure(need);
      const y = doc.y;
      doc.rect(L, y + 1, 3.5, sub ? 34 : 18).fill(C.brand);
      font(true, 15, C.ink);
      put(title, L + 12, y);
      if (sub) {
        font(false, 9.5, C.muted);
        put(sub, L + 12, y + 20, { width: W - 12 });
      }
      doc.y = y + (sub ? 46 : 28);
    };
    /** Wrapped text at x, leaving the cursor `gap` below it. */
    const flow = (
      s: string,
      x: number,
      width: number,
      bold: boolean,
      size: number,
      colour: string,
      gap: number,
    ) => {
      const y0 = doc.y;
      const h = heightOf(s, bold, size, width);
      font(bold, size, colour);
      put(s, x, y0, { width, lineGap: 1.5 });
      doc.y = y0 + h + gap;
    };
    /** A small capital label above a block, e.g. EVIDENCE. */
    const label = (text: string, need = 50) => {
      ensure(need);
      font(true, 8, C.brand);
      put(text.toUpperCase(), L, doc.y, { characterSpacing: 0.8 });
      doc.y += 13;
    };
    /** A shaded box with lines of text; moves to a new page first when it does not fit. */
    const box = (
      lines: Array<{
        text: string;
        bold?: boolean;
        size?: number;
        colour?: string;
        gap?: number;
      }>,
      opts: { fill: string; edge?: string; pad?: number } = { fill: C.soft },
    ) => {
      const pad = opts.pad ?? 10;
      const inner = W - 2 * pad - (opts.edge ? 4 : 0);
      const h =
        lines.reduce(
          (n, l) =>
            n + heightOf(l.text, !!l.bold, l.size ?? 9.5, inner) + (l.gap ?? 3),
          0,
        ) +
        2 * pad -
        3;
      ensure(Math.min(h, bottom() - M));
      const y = doc.y;
      doc.roundedRect(L, y, W, h, 6).fill(opts.fill);
      if (opts.edge) doc.roundedRect(L, y, 4, h, 2).fill(opts.edge);
      let ty = y + pad;
      const x = L + pad + (opts.edge ? 4 : 0);
      for (const l of lines) {
        font(!!l.bold, l.size ?? 9.5, l.colour ?? C.body);
        put(l.text, x, ty, { width: inner, lineGap: 1.5 });
        ty += heightOf(l.text, !!l.bold, l.size ?? 9.5, inner) + (l.gap ?? 3);
      }
      doc.y = y + h + 10;
    };
    /** Label: value rows in two columns (label column fixed), wrapping values. */
    const facts = (
      rows: Array<[string, string, string?]>,
      x: number,
      width: number,
      lw = 78,
    ) => {
      for (const [k, v, colour] of rows) {
        if (!v) continue;
        const h = Math.max(heightOf(v, false, 9, width - lw), 11);
        ensure(h + 2);
        const y = doc.y;
        font(true, 8.5, C.muted);
        put(k, x, y + 0.5);
        font(false, 9, colour ?? C.body);
        put(v, x + lw, y, { width: width - lw, lineGap: 1.5 });
        doc.y = y + h + 2.5;
      }
    };
    /**
     * A bordered table: a shaded header row, then one row per item. Column widths are shares of the page
     * width; a cell can have a smaller second line (`sub`). The header repeats after a page break.
     */
    type GridCell = {
      text: string;
      sub?: string;
      bold?: boolean;
      colour?: string;
    };
    const grid = (
      cols: Array<{ title: string; w: number }>,
      rows: GridCell[][],
    ) => {
      const pad = 5;
      const xs: number[] = [];
      let acc = L;
      for (const c of cols) {
        xs.push(acc);
        acc += c.w * W;
      }
      const widths = cols.map((c) => c.w * W - 2 * pad);
      const lines = (y: number, h: number) => {
        doc.lineWidth(0.5).strokeColor(C.line);
        for (const x of [...xs, R])
          doc
            .moveTo(x, y)
            .lineTo(x, y + h)
            .stroke();
        doc
          .moveTo(L, y + h)
          .lineTo(R, y + h)
          .stroke();
      };
      const head = () => {
        const y = doc.y;
        doc.rect(L, y, W, 18).fill(C.soft);
        doc
          .lineWidth(0.5)
          .strokeColor(C.line)
          .moveTo(L, y)
          .lineTo(R, y)
          .stroke();
        font(true, 7, C.muted);
        cols.forEach((c, i) =>
          put(c.title.toUpperCase(), xs[i] + pad, y + 6, {
            characterSpacing: 0.5,
            width: widths[i],
            height: 9,
            ellipsis: true,
          }),
        );
        lines(y, 18);
        doc.y = y + 18;
      };
      const cellH = (c: GridCell, w: number) =>
        heightOf(c.text, !!c.bold, 9, w) +
        (c.sub ? heightOf(c.sub, false, 8, w) + 2 : 0);
      ensure(18 + 24);
      head();
      for (const row of rows) {
        const h =
          Math.max(...row.map((c, i) => cellH(c, widths[i])), 10) + 2 * pad;
        if (doc.y + h > bottom()) {
          doc.addPage();
          head();
        }
        const y = doc.y;
        row.forEach((c, i) => {
          font(!!c.bold, 9, c.colour ?? C.ink);
          put(c.text, xs[i] + pad, y + pad, { width: widths[i], lineGap: 1.5 });
          if (c.sub) {
            // Measure first: heightOf sets the font, so the sub-line's font comes after it.
            const subY = y + pad + heightOf(c.text, !!c.bold, 9, widths[i]) + 2;
            font(false, 8, c.colour ?? C.muted);
            put(c.sub, xs[i] + pad, subY, {
              width: widths[i],
              lineGap: 1.5,
            });
          }
        });
        lines(y, h);
        doc.y = y + h;
      }
      doc.y += 10;
    };

    /** A table header row. */
    const tableHead = (cols: Array<[string, number, number?]>) => {
      ensure(40);
      const y = doc.y;
      doc.rect(L, y, W, 20).fill(C.soft);
      font(true, 7.5, C.muted);
      for (const [t, x, w] of cols)
        put(t.toUpperCase(), x, y + 7, {
          characterSpacing: 0.5,
          ...(w ? { width: w } : {}),
        });
      doc.y = y + 20;
    };

    // ─── Cover ────────────────────────────────────────────────────────────
    const bandH = 120;
    doc.rect(0, 0, doc.page.width, bandH).fill(C.brand);
    font(true, 8.5, C.brandText);
    put(pack.organisationName.toUpperCase(), L, 32, {
      characterSpacing: 1.2,
      width: W,
    });
    font(true, 24, C.white);
    put('CQC evidence pack', L, 48, { width: W });
    font(false, 12, C.brandText);
    put(pack.scopeLabel, L, 80, { width: W, height: 16, ellipsis: true });

    let y = bandH + 22;
    const evidenceIds = new Set(
      pack.statements.flatMap((s) => s.evidence.map((e) => e.id)),
    );
    const policyIds = new Set(
      pack.statements.flatMap((s) => s.policies.map((p) => p.policyId)),
    );
    const covered = pack.statements.filter((s) => s.evidence.length).length;
    const openActions = pack.statements.reduce(
      (n, s) => n + s.actions.length,
      0,
    );
    const tiles: Array<[string, string, string]> = [
      [
        'Quality statements',
        String(pack.statements.length),
        `${covered} with evidence`,
      ],
      [
        'Evidence',
        String(evidenceIds.size),
        evidenceIds.size === 1 ? 'item' : 'items',
      ],
      [
        'Published policies',
        pack.includesPolicies ? String(policyIds.size) : '-',
        pack.includesPolicies ? 'behind these statements' : 'not included',
      ],
      ['Open actions', String(openActions), 'from mock inspections'],
    ];
    const tw = (W - 3 * 10) / 4;
    tiles.forEach(([k, v, sub], i) => {
      const x = L + i * (tw + 10);
      doc.roundedRect(x, y, tw, 62, 6).fillAndStroke(C.soft, C.line);
      font(true, 7.5, C.muted);
      put(k.toUpperCase(), x + 10, y + 10, {
        characterSpacing: 0.5,
        width: tw - 20,
      });
      font(true, 20, C.ink);
      put(v, x + 10, y + 22);
      font(false, 8, C.muted);
      put(sub, x + 10, y + 46, { width: tw - 20, height: 10, ellipsis: true });
    });
    y += 62 + 14;
    font(false, 9, C.muted);
    put(
      `Service: ${pack.branchName ?? 'every branch'}   ·   ${pack.frameworkTitle}   ·   Made ${ukDate(pack.generatedAt)} by ${pack.generatedBy}`,
      L,
      y,
      { width: W },
    );
    doc.y = y + 24;

    // How to read.
    box(
      [
        {
          text: 'How to read this pack',
          bold: true,
          size: 10.5,
          colour: C.ink,
          gap: 5,
        },
        {
          text: '- Each CQC quality statement has three short tables: Evidence (what the service keeps), Policies (published policies behind it) and Mock inspection (how the service scored itself, and actions still open).',
        },
        ...(pack.service || pack.keyData
          ? [
              {
                text: '- About the service (next page) gives the CQC registration and key figures from the last 12 months: counts only, no names.',
              },
            ]
          : []),
        {
          text: `- Mock inspections are the service checking itself on the CQC scale: 1 significant shortfalls, 2 some shortfalls, 3 good standard, 4 exceptional standard. They are not CQC ratings.`,
        },
        {
          text:
            '- Survey figures are totals only: no individual answers, and nothing broken down below 5 responses.' +
            (pack.format === 'zip' && pack.includesFiles
              ? ' Attached files are in the evidence-files folder, named under each piece of evidence.'
              : ''),
          gap: 0,
        },
      ],
      { fill: C.brandSoft, edge: C.brand },
    );

    // Summary by key question.
    heading('Summary by key question', undefined, 170);
    const sc = {
      kq: L + 10,
      bar: L + 122,
      n: L + 222,
      pol: L + 280,
      act: L + 335,
      mock: R - 112,
    };
    tableHead([
      ['Key question', sc.kq],
      ['Statements with evidence', sc.bar, 150],
      ['Policies', sc.pol],
      ['Actions', sc.act],
      ['Latest mock rating', sc.mock, 112],
    ]);
    for (const g of groups) {
      const rowH = 30;
      ensure(rowH);
      const ry = doc.y;
      const n = g.statements.filter((s) => s.evidence.length).length;
      font(true, 10.5, C.ink);
      put(g.title, sc.kq, ry + 10, { width: 108, height: 13, ellipsis: true });
      doc.roundedRect(sc.bar, ry + 13, 88, 6, 3).fill(C.line);
      const pct = n / g.statements.length;
      if (pct > 0)
        doc
          .roundedRect(sc.bar, ry + 13, Math.max(6, 88 * pct), 6, 3)
          .fill(pct === 1 ? C.brand : '#d97706');
      font(true, 10, C.ink);
      put(`${n} of ${g.statements.length}`, sc.n, ry + 10);
      font(false, 10, C.body);
      put(
        pack.includesPolicies
          ? String(
              new Set(
                g.statements.flatMap((s) => s.policies.map((p) => p.policyId)),
              ).size,
            )
          : '-',
        sc.pol,
        ry + 10,
      );
      const acts = g.statements.reduce((k, s) => k + s.actions.length, 0);
      put(String(acts), sc.act, ry + 10);
      const kq = pack.latestInspection?.keyQuestions.find(
        (k) => k.code === g.code,
      );
      if (kq?.rating)
        pill(
          RATING_LABELS[kq.rating],
          sc.mock,
          ry + 7,
          RATING_COLOURS[kq.rating],
        );
      else {
        font(false, 9.5, C.muted);
        put('Not rated', sc.mock, ry + 10);
      }
      rule(ry + rowH);
      doc.y = ry + rowH;
    }
    doc.y += 8;
    font(false, 8.5, C.muted);
    const ratingNote = pack.latestInspection
      ? `Latest mock rating: from the mock inspection ${mockSource(pack.latestInspection)}${pack.latestInspection.overall ? `; overall ${RATING_LABELS[pack.latestInspection.overall]}` : ''}.`
      : 'Latest mock rating: no mock inspection has been completed yet.';
    put(ratingNote, L, doc.y, { width: W, lineGap: 1.5 });
    doc.y += heightOf(ratingNote, false, 8.5, W) + 12;

    const attention = attentionLines(pack);
    if (attention.length) {
      box(
        [
          {
            text: 'Needs attention before an inspection',
            bold: true,
            size: 10.5,
            colour: C.amber,
            gap: 5,
          },
          ...attention.map((t, i) => ({
            text: `- ${t}`,
            gap: i === attention.length - 1 ? 0 : 3,
          })),
        ],
        { fill: C.amberSoft, edge: C.amberLine },
      );
    }

    // ─── About the service ────────────────────────────────────────────────
    if (pack.service || pack.keyData) {
      doc.addPage();
      heading(
        'About the service',
        'The CQC registration of the service and key figures an inspector usually asks for.',
      );
      const svc = pack.service;
      if (svc) {
        label('Provider');
        facts(
          [
            ['Name', svc.provider.legalName || svc.provider.name],
            ['CQC provider ID', svc.provider.cqcProviderId ?? 'Not recorded'],
            ['Registered office', svc.provider.address ?? ''],
          ],
          L,
          W,
          120,
        );
        doc.y += 6;
        label(
          svc.locations.length === 1
            ? 'Registered location'
            : 'Registered locations',
        );
        if (!svc.locations.length) {
          font(false, 9.5, C.muted);
          put(
            'No branch in this pack has a CQC location ID recorded.',
            L,
            doc.y,
            { width: W },
          );
          doc.y += 18;
        }
        for (const loc of svc.locations) {
          ensure(70);
          flow(loc.name, L, W, true, 10.5, C.ink, 3);
          facts(
            [
              ['CQC location ID', loc.cqcLocationId ?? ''],
              ['Address', loc.address ?? ''],
              ['Contact', loc.contact ?? ''],
              [
                'Registered manager',
                loc.registeredManagers.length
                  ? loc.registeredManagers.join(', ')
                  : 'Not recorded',
              ],
              ['Nominated individual', loc.nominatedIndividual ?? ''],
              ['Regulated activities', loc.regulatedActivities.join(', ')],
              ['Service types', loc.serviceTypes.join(', ')],
              ['Registered since', ukDate(loc.registeredSince)],
              ['Latest CQC rating', loc.rating ?? 'Not recorded'],
            ],
            L,
            W,
            120,
          );
          doc.y += 8;
        }
      }
      const kd = pack.keyData;
      if (kd) {
        heading(
          'Key data',
          `${ukDate(kd.from)} to ${ukDate(kd.to)} (the last 12 months). Counts only, no names.`,
          120,
        );
        for (const g of kd.groups) {
          label(g.title, 40 + g.figures.length * 18);
          for (const f of g.figures) {
            const noteX = L + 250;
            const noteW = R - noteX;
            const h =
              Math.max(f.note ? heightOf(f.note, false, 9, noteW) : 0, 12) + 6;
            ensure(h);
            const ry = doc.y;
            font(false, 9.5, C.body);
            put(f.label, L + 8, ry + 2, { width: 160 });
            font(true, 10.5, C.ink);
            put(f.value, L + 175, ry + 1, { width: 70 });
            if (f.note) {
              font(false, 9, C.muted);
              put(f.note, noteX, ry + 2.5, { width: noteW, lineGap: 1.5 });
            }
            rule(ry + h);
            doc.y = ry + h + 2;
          }
          doc.y += 8;
        }
        if (kd.hidden.length) {
          const t = `Not shown, because your account cannot see them: ${kd.hidden.join(', ')}.`;
          font(false, 8.5, C.muted);
          put(t, L, doc.y, { width: W, lineGap: 1.5 });
          doc.y += heightOf(t, false, 8.5, W) + 6;
        }
      }
    }

    // ─── Contents ─────────────────────────────────────────────────────────
    doc.addPage();
    heading(
      'Contents',
      'Every quality statement in this pack, with what it holds and the page it starts on.',
    );
    const cc = {
      no: L + 8,
      title: L + 40,
      ev: L + 290,
      pol: L + 345,
      mock: L + 400,
      page: R - 40,
    };
    tableHead([
      ['No.', cc.no],
      ['Quality statement', cc.title],
      ['Evidence', cc.ev],
      ['Policies', cc.pol],
      ['Mock score', cc.mock],
      ['Page', cc.page, 32],
    ]);
    let zebra = false;
    for (const g of groups) {
      ensure(40);
      const gy = doc.y + 6;
      font(true, 10, C.brand);
      put(g.title, cc.no, gy);
      doc.y = gy + 18;
      for (const s of g.statements) {
        const th = heightOf(s.title, false, 9.5, cc.ev - cc.title - 10);
        const rowH = Math.max(20, th + 9);
        ensure(rowH);
        const ry = doc.y;
        if (zebra) doc.rect(L, ry, W, rowH).fill(C.soft);
        zebra = !zebra;
        font(true, 9.5, C.muted);
        put(s.number, cc.no, ry + 5);
        font(false, 9.5, C.ink);
        put(s.title, cc.title, ry + 5, {
          width: cc.ev - cc.title - 10,
          lineGap: 1.5,
        });
        if (s.evidence.length) {
          font(false, 9.5, C.body);
          put(String(s.evidence.length), cc.ev, ry + 5);
        } else {
          font(true, 9, C.amber);
          put('None', cc.ev, ry + 5);
        }
        font(false, 9.5, C.body);
        put(
          pack.includesPolicies ? String(s.policies.length) : '-',
          cc.pol,
          ry + 5,
        );
        put(
          s.mock ? `${s.mock.score} of ${s.mock.outOf}` : '-',
          cc.mock,
          ry + 5,
        );
        const p = pages?.get(s.number || s.code);
        font(true, 9.5, C.ink);
        put(p ? String(p) : '', cc.page, ry + 5, { width: 32, align: 'right' });
        doc.y = ry + rowH;
      }
    }

    // ─── Statements ───────────────────────────────────────────────────────
    for (const g of groups) {
      doc.addPage();
      // Key question band.
      const by = doc.y;
      doc.roundedRect(L, by, W, 44, 6).fill(C.brand);
      font(true, 8, C.brandText);
      put('KEY QUESTION', L + 14, by + 9, { characterSpacing: 1 });
      font(true, 16, C.white);
      put(g.title, L + 14, by + 20, { width: W - 160 });
      font(false, 9.5, C.brandText);
      put(plural(g.statements.length, 'quality statement'), R - 150, by + 24, {
        width: 136,
        align: 'right',
      });
      doc.y = by + 58;

      for (const [index, s] of g.statements.entries()) {
        ensure(120);
        // A line between statements, but not at the top of a new page.
        if (index > 0 && doc.y > M + 20) {
          doc.y += 4;
          rule(doc.y);
          doc.y += 14;
        }
        pageOf.set(s.number || s.code, pageNo());

        // Statement number and title, with the mock score on the right.
        const sy = doc.y;
        const scoreText = s.mock
          ? `Mock score ${s.mock.score} of ${s.mock.outOf}`
          : 'Not scored yet';
        const sw = pillWidth(scoreText);
        font(true, 12.5, C.brand);
        put(s.number, L, sy + 1);
        const tx = L + 34;
        const tWidth = R - sw - 12 - tx;
        font(true, 12.5, C.ink);
        put(s.title, tx, sy, { width: tWidth, lineGap: 1.5 });
        if (s.mock)
          pill(
            scoreText,
            R - sw,
            sy - 1,
            SCORE_COLOURS[s.mock.score] ?? C.muted,
          );
        else pill(scoreText, R - sw, sy - 1, C.soft, C.muted);
        doc.y = sy + Math.max(heightOf(s.title, true, 12.5, tWidth), 16) + 10;

        // Evidence.
        label('Evidence');
        if (!s.evidence.length) {
          font(false, 9.5, C.amber);
          put('No current evidence for this statement yet.', L, doc.y, {
            width: W,
          });
          doc.y += 18;
        } else {
          grid(
            [
              { title: 'Evidence', w: 0.46 },
              { title: 'Type', w: 0.18 },
              { title: 'Period', w: 0.2 },
              { title: 'Review by', w: 0.16 },
            ],
            s.evidence.map((e) => {
              const overdue = reviewOverdue(e, now);
              const sub = [
                e.summary,
                e.metrics ? metricsLine(e.metrics) : '',
                pack.format === 'zip' && e.attachments.length
                  ? `Files: ${e.attachments.join(', ')}${e.filesFolder ? ` (in ${e.filesFolder}/)` : ''}`
                  : '',
              ]
                .filter(Boolean)
                .join('\n');
              return [
                { text: e.title, bold: true, sub },
                { text: SOURCE_TYPE_LABELS[e.sourceType] ?? e.sourceType },
                { text: periodText(e.periodStart, e.periodEnd) },
                {
                  text: e.reviewDueAt ? ukDate(e.reviewDueAt) : '-',
                  sub: overdue ? 'Overdue' : undefined,
                  colour: overdue ? C.amber : undefined,
                  bold: overdue,
                },
              ];
            }),
          );
        }

        // Policies.
        if (pack.includesPolicies) {
          label('Policies');
          if (!s.policies.length) {
            font(false, 9.5, C.muted);
            put('No published policy is linked to this statement.', L, doc.y, {
              width: W,
            });
            doc.y += 18;
          } else {
            grid(
              [
                { title: 'Reference', w: 0.17 },
                { title: 'Policy', w: 0.53 },
                { title: 'Version', w: 0.12 },
                { title: 'Review by', w: 0.18 },
              ],
              s.policies.map((pol) => [
                { text: pol.reference, bold: true },
                { text: pol.title },
                { text: pol.versionLabel },
                {
                  text: pol.reviewDate ? ukDate(pol.reviewDate) : '-',
                  sub: pol.reviewOverdue ? 'Overdue' : undefined,
                  colour: pol.reviewOverdue ? C.amber : undefined,
                  bold: pol.reviewOverdue,
                },
              ]),
            );
          }
        }

        // Mock inspection: the score and where it came from, then actions still open.
        label('Mock inspection');
        if (!s.mock) {
          font(false, 9.5, C.muted);
          put('Not scored in a completed mock inspection yet.', L, doc.y, {
            width: W,
          });
          doc.y += 18;
        } else {
          grid(
            [
              { title: 'Score', w: 0.3 },
              { title: 'Mock inspection', w: 0.48 },
              { title: 'Completed', w: 0.22 },
            ],
            [
              [
                {
                  text: `${s.mock.score} of ${s.mock.outOf}${s.mock.label ? ` - ${s.mock.label}` : ''}`,
                  bold: true,
                  colour: SCORE_COLOURS[s.mock.score],
                },
                {
                  text: s.mock.inspectionTitle,
                  sub: s.mock.branchName ?? 'Whole organisation',
                },
                { text: ukDate(s.mock.completedAt) || '-' },
              ],
            ],
          );
        }
        if (s.actions.length) {
          grid(
            [
              { title: 'Improvement action still open', w: 0.56 },
              { title: 'Owner', w: 0.24 },
              { title: 'Due', w: 0.2 },
            ],
            s.actions.map((a) => [
              { text: a.title },
              { text: a.owner ?? '-' },
              {
                text: a.dueAt ? ukDate(a.dueAt) : '-',
                sub: a.overdue ? 'Overdue' : undefined,
                colour: a.overdue ? C.amber : undefined,
                bold: a.overdue,
              },
            ]),
          );
        }
        doc.y += 6;
      }
    }

    // ─── Footer on every page ─────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - M - 6;
      rule(fy);
      font(false, 8, C.muted);
      put(
        `${pack.organisationName}  ·  CQC evidence pack: ${pack.scopeLabel}  ·  ${ukDate(pack.generatedAt)}`,
        L,
        fy + 8,
        {
          width: W - 80,
          height: 10,
          ellipsis: true,
        },
      );
      put(`Page ${i - range.start + 1} of ${range.count}`, R - 80, fy + 8, {
        width: 80,
        align: 'right',
      });
      doc.page.margins.bottom = keep;
    }
    doc.end();
  });
}
