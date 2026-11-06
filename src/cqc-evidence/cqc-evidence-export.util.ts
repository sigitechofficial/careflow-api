import PDFDocument from 'pdfkit';
import type { CqcSurveyMetrics } from './cqc-survey-metrics.util';

/** Evidence pack for inspection: one statement or all of them, as CSV or PDF. */
export type ExportEvidence = {
  id: string;
  title: string;
  summary: string | null;
  sourceType: string;
  sourceLabel: string | null;
  categoryTitle: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  status: string;
  reviewDueAt: Date | null;
  addedBy: string;
  addedAt: Date;
  branches: string[];
  metrics: CqcSurveyMetrics | null;
  actions: Array<{ youSaid: string; weDid: string }>;
  attachments: string[];
};

export type ExportStatement = {
  keyQuestionTitle: string;
  code: string;
  title: string;
  summary: string;
  evidence: ExportEvidence[];
};

export type ExportPack = {
  organisationName: string;
  generatedAt: Date;
  generatedBy: string;
  frameworkTitle: string;
  scopeLabel: string;
  statements: ExportStatement[];
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  SURVEY_RESULT: 'Survey result',
  POLICY: 'Policy',
  AUDIT: 'Audit',
  INCIDENT_LEARNING: 'Learning from incidents',
  TRAINING: 'Training',
  COMPLAINT: 'Complaint',
  COMPLIMENT: 'Compliment',
  MANUAL: 'Added by hand',
};

export const STATUS_LABELS: Record<string, string> = {
  CURRENT: 'Current',
  SUPERSEDED: 'Superseded',
  ARCHIVED: 'Archived',
};

const ukDate = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(d) : '';

export function periodLabel(start: Date | null, end: Date | null): string {
  if (start && end) return `${ukDate(start)} to ${ukDate(end)}`;
  if (end) return `Up to ${ukDate(end)}`;
  if (start) return `From ${ukDate(start)}`;
  return '';
}

/** Survey figures in one line (counts, rate, headline). */
export function metricsLine(m: CqcSurveyMetrics | null): string {
  if (!m) return '';
  const parts = [`${m.responses} responses`];
  if (m.responseRate !== null && m.recipients) parts.push(`${m.responseRate}% response rate (${m.recipients} asked)`);
  if (m.suppressed) parts.push(`fewer than ${m.threshold} responses, no breakdown`);
  else if (m.headline?.percent !== null && m.headline?.percent !== undefined) {
    parts.push(`${m.headline.percent}% ${m.headline.positiveLabels.join(' or ')} overall (${m.headline.base} answered)`);
  }
  return parts.join('; ');
}

/** A CSV cell: quoted, and a leading = + - @ neutralised so spreadsheets never run it as a formula. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_HEADER = [
  'Key question',
  'Quality statement',
  'Evidence',
  'Status',
  'Evidence category',
  'Source',
  'Source detail',
  'Period covered',
  'Summary',
  'Survey figures',
  'You said, we did',
  'Branches',
  'Review due',
  'Added by',
  'Added on',
  'Attachments',
];

export function buildEvidenceCsv(pack: ExportPack): string {
  const rows: string[][] = [CSV_HEADER];
  for (const s of pack.statements) {
    if (!s.evidence.length) {
      rows.push([s.keyQuestionTitle, s.title, 'No current evidence', ...Array(CSV_HEADER.length - 3).fill('')]);
      continue;
    }
    for (const e of s.evidence) {
      rows.push([
        s.keyQuestionTitle,
        s.title,
        e.title,
        STATUS_LABELS[e.status] ?? e.status,
        e.categoryTitle,
        SOURCE_TYPE_LABELS[e.sourceType] ?? e.sourceType,
        e.sourceLabel ?? '',
        periodLabel(e.periodStart, e.periodEnd),
        e.summary ?? '',
        metricsLine(e.metrics),
        e.actions.map((a) => `You said: ${a.youSaid} We did: ${a.weDid}`).join(' | '),
        e.branches.length ? e.branches.join('; ') : 'Whole organisation',
        ukDate(e.reviewDueAt),
        e.addedBy,
        ukDate(e.addedAt),
        e.attachments.join('; '),
      ]);
    }
  }
  // Excel opens UTF-8 CSV correctly with a byte-order mark.
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** PDF standard fonts are Latin-1 only: keep £ and accents, swap smart punctuation, drop the rest. */
export function pdfText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}

export function buildEvidencePdf(pack: ExportPack): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 45,
      info: { Title: pdfText(`CQC evidence - ${pack.scopeLabel}`), Author: pdfText(pack.organisationName) },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const muted = '#475569';
    const ink = '#0f172a';
    doc.fontSize(9).fillColor(muted).text(pdfText(pack.organisationName));
    doc.moveDown(0.3);
    doc.fontSize(16).fillColor(ink).text('CQC evidence');
    doc.fontSize(11).fillColor(ink).text(pdfText(pack.scopeLabel));
    doc.moveDown(0.3);
    doc
      .fontSize(8.5)
      .fillColor(muted)
      .text(pdfText(`${pack.frameworkTitle}. Generated ${ukDate(pack.generatedAt)} by ${pack.generatedBy}.`))
      .text('Survey figures are totals only: no individual answers are included, and nothing is broken down below 5 responses.');
    doc.moveDown(0.8);

    const gaps = pack.statements.filter((s) => !s.evidence.length);
    if (pack.statements.length > 1) {
      const covered = pack.statements.length - gaps.length;
      doc.fontSize(10).fillColor(ink).text(`${covered} of ${pack.statements.length} quality statements have current evidence.`);
      if (gaps.length) {
        doc.fontSize(8.5).fillColor('#b45309').text(pdfText(`No current evidence: ${gaps.map((g) => g.title).join('; ')}.`));
      }
      doc.moveDown(0.8);
    }

    let keyQuestion = '';
    for (const s of pack.statements) {
      if (s.keyQuestionTitle !== keyQuestion) {
        keyQuestion = s.keyQuestionTitle;
        if (doc.y > 700) doc.addPage();
        doc.moveDown(0.4).fontSize(13).fillColor(ink).text(pdfText(keyQuestion));
        doc.moveDown(0.2);
      }
      if (doc.y > 720) doc.addPage();
      doc.fontSize(11).fillColor(ink).text(pdfText(s.title));
      doc.fontSize(8.5).fillColor(muted).text(pdfText(s.summary));
      doc.moveDown(0.3);
      if (!s.evidence.length) {
        doc.fontSize(9).fillColor('#b45309').text('No current evidence.');
        doc.moveDown(0.6);
        continue;
      }
      for (const e of s.evidence) {
        if (doc.y > 730) doc.addPage();
        doc.fontSize(9.5).fillColor(ink).text(pdfText(`- ${e.title}`), { continued: false });
        const meta = [
          SOURCE_TYPE_LABELS[e.sourceType] ?? e.sourceType,
          e.categoryTitle,
          periodLabel(e.periodStart, e.periodEnd),
          STATUS_LABELS[e.status] ?? e.status,
          e.branches.length ? e.branches.join(', ') : 'Whole organisation',
        ].filter(Boolean);
        doc.fontSize(8).fillColor(muted).text(pdfText(meta.join(' · ')), { indent: 10 });
        if (e.summary) doc.fontSize(8.5).fillColor(ink).text(pdfText(e.summary), { indent: 10 });
        const figures = metricsLine(e.metrics);
        if (figures) doc.fontSize(8.5).fillColor(ink).text(pdfText(`Figures: ${figures}`), { indent: 10 });
        for (const q of e.metrics?.questions ?? []) {
          const value = q.percent === null ? 'too few answers to show' : `${q.percent}% ${q.positiveLabels.join(' or ')} (${q.base} answered)`;
          doc.fontSize(8).fillColor(muted).text(pdfText(`${q.questionText}: ${value}`), { indent: 18 });
        }
        for (const a of e.actions) {
          doc.fontSize(8.5).fillColor(ink).text(pdfText(`You said: ${a.youSaid}`), { indent: 10 });
          doc.fontSize(8.5).fillColor(ink).text(pdfText(`We did: ${a.weDid}`), { indent: 10 });
        }
        if (e.attachments.length) doc.fontSize(8).fillColor(muted).text(pdfText(`Files: ${e.attachments.join(', ')}`), { indent: 10 });
        doc.fontSize(8).fillColor(muted).text(pdfText(`Added by ${e.addedBy} on ${ukDate(e.addedAt)}${e.reviewDueAt ? `; review by ${ukDate(e.reviewDueAt)}` : ''}`), { indent: 10 });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);
    }
    doc.end();
  });
}
