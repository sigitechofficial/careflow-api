import PDFDocument from 'pdfkit';
import { pdfText } from '../cqc-evidence/cqc-evidence-export.util';
import type {
  CqcRating,
  InspectionResult,
} from './cqc-mock-inspection-scoring.util';

/** What the report needs: the inspection as the viewer sees it (detail()), plus who made the report. */
export type MockInspectionReport = {
  organisationName: string;
  generatedAt: Date;
  generatedBy: string;
  title: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  serviceName: string;
  /** The ready-made inspection it was started from; null = every quality statement. */
  templateTitle: string | null;
  frameworkTitle: string;
  frameworkVersion: number;
  leadReviewer: string | null;
  startedAt: Date;
  completedAt: Date | null;
  scale: { score: number; label: string }[];
  result: InspectionResult | null;
  keyQuestions: {
    code: string;
    title: string;
    statements: {
      id: string;
      title: string;
      score: number | null;
      strengths: string | null;
      concerns: string | null;
      notes: string | null;
      gap: boolean;
      evidence: { title: string; sourceType: string }[];
      hiddenEvidenceCount: number;
    }[];
  }[];
  actions: {
    statementId: string | null;
    title: string;
    detail: string | null;
    owner: string | null;
    dueAt: Date | null;
    status: 'OPEN' | 'DONE';
    completedAt: Date | null;
  }[];
};

export const RATING_LABELS: Record<CqcRating, string> = {
  OUTSTANDING: 'Outstanding',
  GOOD: 'Good',
  REQUIRES_IMPROVEMENT: 'Requires improvement',
  INADEQUATE: 'Inadequate',
};

const STATUS_LABELS = {
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
} as const;

// Palette: one brand colour, slate greys, and the rating colours.
const C = {
  brand: '#0b5d3b',
  brandSoft: '#e9f4ee',
  brandText: '#cfe6da',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  soft: '#f8fafc',
  track: '#e2e8f0',
  amber: '#b45309',
  amberSoft: '#fff7ed',
  amberLine: '#f59e0b',
  white: '#ffffff',
};

const RATING_COLOURS: Record<CqcRating, string> = {
  OUTSTANDING: '#047857',
  GOOD: '#16a34a',
  REQUIRES_IMPROVEMENT: '#d97706',
  INADEQUATE: '#dc2626',
};

/** Score chips: 1 red, 2 amber, 3 green, 4 deep green. */
const SCORE_COLOURS: Record<number, string> = {
  1: '#dc2626',
  2: '#d97706',
  3: '#16a34a',
  4: '#047857',
};

const ukDate = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Europe/London',
      }).format(d)
    : '';

/** File name: mock-cqc-inspection-<title>-<yyyy-mm-dd>.pdf (letters, digits and dashes only). */
export function reportFileName(title: string, at: Date): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `mock-cqc-inspection-${slug || 'report'}-${at.toISOString().slice(0, 10)}.pdf`;
}

/** One line per key question: "Safe: Good (71.9%, 8/8 scored)". */
export function keyQuestionLine(
  title: string,
  k: InspectionResult['keyQuestions'][number] | undefined,
): string {
  if (!k || k.rating === null) return `${title}: not scored yet`;
  const parts = [
    `${k.percent}%`,
    `${k.scoredCount}/${k.statementCount} scored`,
  ];
  const limited = k.limitedFrom
    ? `; limited from ${RATING_LABELS[k.limitedFrom]} by a low score`
    : '';
  return `${title}: ${RATING_LABELS[k.rating]} (${parts.join(', ')}${limited})`;
}

/** Summary of statements with no evidence: named when some are missing, one line when all are. */
export function gapLine(gapTitles: string[], statementCount: number): string {
  if (gapTitles.length === statementCount) {
    return `None of the ${statementCount} statements has current evidence. Add CQC evidence and refresh the inspection.`;
  }
  return `No current evidence for ${gapTitles.length} statement(s): ${gapTitles.join('; ')}.`;
}

/** "3 items", "None", "1 item (1 hidden)". */
export function evidenceLabel(
  s: MockInspectionReport['keyQuestions'][number]['statements'][number],
): string {
  if (s.gap) return 'None';
  const n = s.evidence.length + s.hiddenEvidenceCount;
  return `${n} item${n === 1 ? '' : 's'}${s.hiddenEvidenceCount ? ` (${s.hiddenEvidenceCount} hidden)` : ''}`;
}

export function buildMockInspectionPdf(
  r: MockInspectionReport,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const M = 42;
    const FOOTER = 34;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: M, bottom: M + FOOTER, left: M, right: M },
      bufferPages: true,
      info: {
        Title: pdfText(`Mock CQC inspection - ${r.title}`),
        Author: pdfText(r.organisationName),
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = M;
    const W = doc.page.width - 2 * M;
    const R = L + W;
    const bottom = () => doc.page.height - M - FOOTER;
    const scaleLabel = new Map(r.scale.map((s) => [s.score, s.label]));
    const allStatements = r.keyQuestions.flatMap((k) => k.statements);
    const scored = allStatements.filter((s) => s.score !== null).length;
    const kqResult = (code: string) =>
      r.result?.keyQuestions.find((k) => k.keyQuestionCode === code);
    const statementTitle = new Map(
      allStatements.map((s) => [s.id, s.title] as const),
    );

    // ─── Drawing helpers ──────────────────────────────────────────────────
    const font = (bold: boolean, size: number, colour: string) =>
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(colour);

    /** Text at a fixed place that never moves the cursor to a new page. */
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

    const pill = (
      label: string,
      x: number,
      y: number,
      fill: string,
      size = 7.5,
      colour = C.white,
    ) => {
      font(true, size, colour);
      const w = doc.widthOfString(pdfText(label)) + 12;
      const h = size + 7;
      doc.roundedRect(x, y, w, h, h / 2).fill(fill);
      font(true, size, colour);
      put(label, x + 6, y + 3.6);
      return w;
    };
    const pillWidth = (label: string, size = 7.5) => {
      font(true, size, C.white);
      return doc.widthOfString(pdfText(label)) + 12;
    };

    const ratingPill = (
      rating: CqcRating | null,
      x: number,
      y: number,
      size = 7.5,
    ) =>
      rating
        ? pill(RATING_LABELS[rating], x, y, RATING_COLOURS[rating], size)
        : pill('Not scored', x, y, C.line, size, C.muted);

    const scoreChip = (score: number | null, x: number, y: number) => {
      const d = 15;
      doc
        .roundedRect(x, y, d, d, 4)
        .fill(score === null ? C.line : (SCORE_COLOURS[score] ?? C.muted));
      font(true, 8, score === null ? C.muted : C.white);
      put(score === null ? '-' : String(score), x, y + 4, {
        width: d,
        align: 'center',
      });
    };

    const bar = (
      x: number,
      y: number,
      w: number,
      percent: number | null,
      colour: string,
    ) => {
      doc.roundedRect(x, y, w, 6, 3).fill(C.track);
      if (percent !== null && percent > 0)
        doc
          .roundedRect(
            x,
            y,
            Math.max(6, (w * Math.min(percent, 100)) / 100),
            6,
            3,
          )
          .fill(colour);
    };

    /** `need`: room for the title and what must follow it on the same page (e.g. a table header and first row). */
    const sectionTitle = (title: string, subtitle?: string, need = 60) => {
      if (doc.y + need > bottom()) doc.addPage();
      const y = doc.y;
      doc.rect(L, y, 3, subtitle ? 30 : 16).fill(C.brand);
      font(true, 13, C.ink);
      put(title, L + 10, y);
      if (subtitle) {
        font(false, 8.5, C.muted);
        put(subtitle, L + 10, y + 17, { width: W - 10 });
      }
      doc.y = y + (subtitle ? 40 : 26);
    };

    // ─── Cover band ───────────────────────────────────────────────────────
    const bandH = 112;
    doc.rect(0, 0, doc.page.width, bandH).fill(C.brand);
    font(true, 8, C.brandText);
    put(r.organisationName.toUpperCase(), L, 30, {
      characterSpacing: 1.2,
      width: W - 120,
    });
    font(true, 21, C.white);
    put('Mock CQC inspection report', L, 46, { width: W - 120 });
    font(false, 11, C.brandText);
    put(r.title, L, 74, { width: W - 120 });
    const statusLabel = STATUS_LABELS[r.status];
    pill(
      statusLabel,
      R - pillWidth(statusLabel, 8),
      30,
      r.status === 'COMPLETED'
        ? '#16a34a'
        : r.status === 'CANCELLED'
          ? C.muted
          : '#2563eb',
      8,
    );

    // ─── Details grid ─────────────────────────────────────────────────────
    let y = bandH + 22;
    const cells: [string, string][] = [
      ['Service', r.serviceName],
      [
        'Inspection',
        r.templateTitle
          ? `Ready-made: ${r.templateTitle}`
          : 'Full: every quality statement',
      ],
      ['Framework', `${r.frameworkTitle} v${r.frameworkVersion}`],
      ['Lead reviewer', r.leadReviewer ?? '-'],
      [
        'Dates',
        `Started ${ukDate(r.startedAt)}${r.completedAt ? `, completed ${ukDate(r.completedAt)}` : ''}`,
      ],
      ['Report generated', `${ukDate(r.generatedAt)} by ${r.generatedBy}`],
    ];
    const colW = W / 3;
    const cellH = 42;
    doc.roundedRect(L, y, W, cellH * 2 + 12, 6).fillAndStroke(C.soft, C.line);
    cells.forEach(([label, value], i) => {
      const cx = L + 12 + (i % 3) * colW;
      const cy = y + 10 + Math.floor(i / 3) * cellH;
      font(true, 6.5, C.muted);
      put(label.toUpperCase(), cx, cy, { characterSpacing: 0.6 });
      font(true, 9, C.ink);
      put(value, cx, cy + 10, { width: colW - 20, height: 24, ellipsis: true });
    });
    y += cellH * 2 + 12 + 16;

    // ─── Overall rating ───────────────────────────────────────────────────
    const overall = r.result?.overall ?? null;
    // A focused inspection leaves out a key question: like CQC, no overall rating.
    const focused = r.result?.overallApplies === false;
    const heroH = 70;
    doc
      .roundedRect(L, y, W, heroH, 6)
      .lineWidth(1)
      .strokeColor(C.line)
      .stroke();
    doc
      .roundedRect(L, y, 5, heroH, 2)
      .fill(overall ? RATING_COLOURS[overall] : C.line);
    font(true, 7, C.muted);
    put('OVERALL RATING', L + 18, y + 14, { characterSpacing: 0.8 });
    font(true, 20, overall ? RATING_COLOURS[overall] : C.muted);
    put(
      overall
        ? RATING_LABELS[overall]
        : focused
          ? 'No overall rating'
          : 'Not yet rated',
      L + 18,
      y + 27,
    );
    font(false, 8, C.muted);
    put(
      overall
        ? 'Worked out from the five key question ratings.'
        : focused
          ? 'A focused inspection rates only the key questions it covers.'
          : 'Given when every quality statement has a score.',
      L + 18,
      y + 51,
      { width: W * 0.55 },
    );
    const px = L + W * 0.58;
    const pw = W * 0.42 - 18;
    font(true, 7, C.muted);
    put('STATEMENTS SCORED', px, y + 14, { characterSpacing: 0.8 });
    font(true, 14, C.ink);
    put(`${scored} of ${allStatements.length}`, px, y + 27);
    bar(
      px,
      y + 50,
      pw,
      allStatements.length ? (scored / allStatements.length) * 100 : 0,
      C.brand,
    );
    y += heroH + 22;

    // ─── Key questions ────────────────────────────────────────────────────
    doc.y = y;
    sectionTitle('Key questions');
    y = doc.y;
    const kqCols = {
      title: L + 10,
      rating: L + 150,
      bar: L + 290,
      pct: L + 290 + 130 + 8,
      count: R - 60,
    };
    doc.rect(L, y, W, 20).fill(C.soft);
    font(true, 7, C.muted);
    put('KEY QUESTION', kqCols.title, y + 7, { characterSpacing: 0.6 });
    put('RATING', kqCols.rating, y + 7, { characterSpacing: 0.6 });
    put('SCORE', kqCols.bar, y + 7, { characterSpacing: 0.6 });
    put('SCORED', kqCols.count, y + 7, {
      characterSpacing: 0.6,
      width: 50,
      align: 'right',
    });
    y += 20;
    const limited: string[] = [];
    for (const k of r.keyQuestions) {
      const res = kqResult(k.code);
      const rowH = 28;
      font(true, 10, C.ink);
      put(k.title, kqCols.title, y + 9);
      const pw2 = ratingPill(res?.rating ?? null, kqCols.rating, y + 7);
      if (res?.limitedFrom) {
        limited.push(
          `${k.title} would be ${RATING_LABELS[res.limitedFrom]} on its percentage, but a low statement score limits it.`,
        );
        font(true, 9, C.amber);
        put('*', kqCols.rating + pw2 + 3, y + 7);
      }
      bar(
        kqCols.bar,
        y + 11,
        130,
        res?.percent ?? null,
        res?.rating ? RATING_COLOURS[res.rating] : C.track,
      );
      font(true, 9, res?.percent != null ? C.ink : C.muted);
      put(res?.percent != null ? `${res.percent}%` : '-', kqCols.pct, y + 9);
      font(false, 9, C.body);
      const total = k.statements.length;
      const done = k.statements.filter((s) => s.score !== null).length;
      put(`${done} / ${total}`, kqCols.count, y + 9, {
        width: 50,
        align: 'right',
      });
      doc
        .moveTo(L, y + rowH)
        .lineTo(R, y + rowH)
        .lineWidth(0.5)
        .strokeColor(C.line)
        .stroke();
      y += rowH;
    }
    if (limited.length) {
      y += 6;
      font(false, 7.5, C.amber);
      for (const note of limited) {
        put(`* ${note}`, L, y, { width: W });
        y += doc.heightOfString(pdfText(`* ${note}`), { width: W }) + 2;
      }
    }
    y += 16;

    // ─── Evidence gaps callout ────────────────────────────────────────────
    const gaps = allStatements.filter((s) => s.gap);
    if (gaps.length) {
      const msg = pdfText(
        gapLine(
          gaps.map((g) => g.title),
          allStatements.length,
        ),
      );
      font(false, 8.5, C.body);
      const h = doc.heightOfString(msg, { width: W - 30 }) + 30;
      if (y + h > bottom()) {
        doc.addPage();
        y = doc.y;
      }
      doc.roundedRect(L, y, W, h, 6).fill(C.amberSoft);
      doc.rect(L, y, 4, h).fill(C.amberLine);
      font(true, 9, C.amber);
      put('Evidence gaps', L + 16, y + 9);
      font(false, 8.5, C.body);
      put(msg, L + 16, y + 21, { width: W - 30 });
      y += h + 16;
    }

    // ─── Scale legend ─────────────────────────────────────────────────────
    if (y + 30 > bottom()) {
      doc.addPage();
      y = doc.y;
    }
    font(true, 7, C.muted);
    put('SCORING SCALE', L, y + 4, { characterSpacing: 0.6 });
    let lx = L + 80;
    for (const s of r.scale) {
      scoreChip(s.score, lx, y);
      font(false, 8, C.body);
      put(s.label, lx + 20, y + 4);
      lx += 20 + doc.widthOfString(pdfText(s.label)) + 16;
    }
    y += 26;
    font(false, 7.5, C.muted);
    put(
      "This is the service's own practice inspection, not a rating by the Care Quality Commission. Scoring follows CQC's published method as summarised by secondary sources and should be checked against the CQC website.",
      L,
      y,
      { width: W },
    );

    // ─── Statements by key question ───────────────────────────────────────
    doc.addPage();
    sectionTitle(
      'Quality statement scores',
      "Each statement scored on the 1 to 4 scale, with the evidence held and the reviewer's notes.",
    );
    const col = { statement: L + 10, score: L + W - 215, evidence: L + W - 88 };
    const stW = col.score - col.statement - 12;

    const tableHeader = () => {
      const hy = doc.y;
      doc.rect(L, hy, W, 18).fill(C.soft);
      font(true, 7, C.muted);
      put('STATEMENT', col.statement, hy + 6, { characterSpacing: 0.6 });
      put('SCORE', col.score, hy + 6, { characterSpacing: 0.6 });
      put('EVIDENCE', col.evidence, hy + 6, { characterSpacing: 0.6 });
      doc.y = hy + 18;
    };

    const kqHeader = (
      k: MockInspectionReport['keyQuestions'][number],
      cont = false,
    ) => {
      const hy = doc.y;
      const res = kqResult(k.code);
      doc.roundedRect(L, hy, W, 26, 4).fill(C.brandSoft);
      doc.rect(L, hy, 3, 26).fill(C.brand);
      font(true, 11, C.ink);
      put(cont ? `${k.title} (continued)` : k.title, L + 12, hy + 8);
      let rx = R - 10;
      if (res?.percent != null) {
        font(true, 9, C.body);
        const t = `${res.percent}%`;
        rx -= doc.widthOfString(t);
        put(t, rx, hy + 9);
        rx -= 8;
      }
      const label = res?.rating ? RATING_LABELS[res.rating] : 'Not scored';
      rx -= pillWidth(label);
      ratingPill(res?.rating ?? null, rx, hy + 6);
      doc.y = hy + 30;
      tableHeader();
    };

    for (const k of r.keyQuestions) {
      if (doc.y + 90 > bottom()) doc.addPage();
      else doc.y += 6;
      kqHeader(k);
      k.statements.forEach((s, i) => {
        const notes: [string, string][] = [];
        if (s.strengths) notes.push(['Strengths', s.strengths]);
        if (s.concerns) notes.push(['Concerns', s.concerns]);
        if (s.notes) notes.push(['Notes', s.notes]);
        font(true, 9, C.ink);
        const titleH = doc.heightOfString(pdfText(s.title), { width: stW });
        font(false, 8, C.body);
        const noteH = notes.reduce(
          (h, [label, text]) =>
            h +
            doc.heightOfString(pdfText(`${label}: ${text}`), { width: stW }) +
            2,
          0,
        );
        const rowH = Math.max(26, titleH + noteH + 14);
        if (doc.y + rowH > bottom()) {
          doc.addPage();
          kqHeader(k, true);
        }
        const ry = doc.y;
        if (i % 2 === 1) doc.rect(L, ry, W, rowH).fill(C.soft);
        font(true, 9, C.ink);
        put(s.title, col.statement, ry + 8, { width: stW });
        let ny = ry + 8 + titleH + 2;
        for (const [label, text] of notes) {
          font(true, 8, label === 'Concerns' ? C.amber : C.body);
          doc.text(pdfText(`${label}: `), col.statement, ny, {
            continued: true,
            width: stW,
          });
          font(false, 8, C.body);
          doc.text(pdfText(text), { width: stW });
          ny = doc.y + 2;
        }
        scoreChip(s.score, col.score, ry + 6);
        font(false, 8, s.score === null ? C.muted : C.body);
        put(
          s.score === null ? 'Not scored' : (scaleLabel.get(s.score) ?? ''),
          col.score + 21,
          ry + 9.5,
          {
            width: col.evidence - col.score - 28,
            height: 10,
            ellipsis: true,
          },
        );
        font(s.gap, 8, s.gap ? C.amber : C.body);
        put(evidenceLabel(s), col.evidence, ry + 9.5, {
          width: R - col.evidence - 6,
          height: 10,
          ellipsis: true,
        });
        doc
          .moveTo(L, ry + rowH)
          .lineTo(R, ry + rowH)
          .lineWidth(0.5)
          .strokeColor(C.line)
          .stroke();
        doc.y = ry + rowH;
      });
    }

    // ─── Actions ──────────────────────────────────────────────────────────
    doc.y += 18;
    const open = r.actions.filter((a) => a.status === 'OPEN').length;
    sectionTitle(
      'Improvement actions',
      r.actions.length
        ? `${open} open, ${r.actions.length - open} done.`
        : undefined,
      // Title, table header and the first action row stay together.
      r.actions.length ? 120 : 80,
    );
    if (!r.actions.length) {
      const ay = doc.y;
      doc.roundedRect(L, ay, W, 34, 6).fill(C.soft);
      font(false, 9, C.muted);
      put(
        'No actions recorded. Add one for any statement scored 1 or 2.',
        L + 14,
        ay + 12,
      );
      doc.y = ay + 34;
    } else {
      const ac = {
        action: L + 10,
        statement: L + W * 0.48,
        due: L + W - 150,
        status: L + W - 70,
      };
      const actionHeader = () => {
        const hy = doc.y;
        doc.rect(L, hy, W, 18).fill(C.soft);
        font(true, 7, C.muted);
        put('ACTION', ac.action, hy + 6, { characterSpacing: 0.6 });
        put('STATEMENT', ac.statement, hy + 6, { characterSpacing: 0.6 });
        put('DUE', ac.due, hy + 6, { characterSpacing: 0.6 });
        put('STATUS', ac.status, hy + 6, { characterSpacing: 0.6 });
        doc.y = hy + 18;
      };
      actionHeader();
      const aw = ac.statement - ac.action - 12;
      const sw = ac.due - ac.statement - 12;
      for (const a of r.actions) {
        const owner = a.owner ? `Owner: ${a.owner}` : '';
        const sub = [a.detail, owner].filter(Boolean).join('  ·  ');
        font(true, 9, C.ink);
        const th = doc.heightOfString(pdfText(a.title), { width: aw });
        font(false, 8, C.muted);
        const dh = sub
          ? doc.heightOfString(pdfText(sub), { width: aw }) + 2
          : 0;
        const stTitle = a.statementId
          ? (statementTitle.get(a.statementId) ?? 'Quality statement')
          : 'General';
        const sh = doc.heightOfString(pdfText(stTitle), { width: sw });
        const rowH = Math.max(26, th + dh + 14, sh + 14);
        if (doc.y + rowH > bottom()) {
          doc.addPage();
          actionHeader();
        }
        const ry = doc.y;
        font(true, 9, C.ink);
        put(a.title, ac.action, ry + 8, { width: aw });
        if (sub) {
          font(false, 8, C.muted);
          put(sub, ac.action, ry + 10 + th, { width: aw });
        }
        font(false, 8.5, C.body);
        put(stTitle, ac.statement, ry + 8, { width: sw });
        put(a.dueAt ? ukDate(a.dueAt) : '-', ac.due, ry + 8);
        if (a.status === 'DONE') pill('Done', ac.status, ry + 6, '#16a34a');
        else pill('Open', ac.status, ry + 6, '#2563eb');
        doc
          .moveTo(L, ry + rowH)
          .lineTo(R, ry + rowH)
          .lineWidth(0.5)
          .strokeColor(C.line)
          .stroke();
        doc.y = ry + rowH;
      }
    }

    // ─── Footer on every page ─────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - M - 10;
      doc
        .moveTo(L, fy)
        .lineTo(R, fy)
        .lineWidth(0.5)
        .strokeColor(C.line)
        .stroke();
      font(false, 7, C.muted);
      put(
        `${r.organisationName}  ·  Mock CQC inspection: ${r.title}  ·  Internal practice inspection, not a CQC rating`,
        L,
        fy + 8,
        {
          width: W - 70,
          height: 10,
          ellipsis: true,
        },
      );
      put(`Page ${i - range.start + 1} of ${range.count}`, R - 70, fy + 8, {
        width: 70,
        align: 'right',
      });
      doc.page.margins.bottom = keep;
    }
    doc.end();
  });
}
