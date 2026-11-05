import type { ClientQuoteView } from './quote-pdf.util';

/**
 * The quotation email: everything on the client's quote (details, visits, charges, totals,
 * funding, notes and terms) in the message itself, as plain text and as inline-styled HTML for
 * email clients. Built from the same client view as the PDF, so it never shows internal notes.
 */

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 2026-10-29 → 29 Oct 2026. */
function fmtDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const carersText = (n: number) => `${n} carer${n === 1 ? '' : 's'}`;

type Section = {
  title: string;
  rows: Array<{ label: string; value: string; note?: string; bold?: boolean }>;
};

/** The quote's content as titled sections of label / value rows, shared by the text and HTML bodies. */
function sections(view: ClientQuoteView): Section[] {
  const out: Section[] = [];
  out.push({
    title: 'Quotation details',
    rows: [
      {
        label: 'Quotation',
        value: `${view.quotationNumber} (version ${view.versionNumber})`,
      },
      { label: 'Type', value: view.quoteTypeLabel },
      { label: 'Prepared for', value: view.clientName },
      ...(view.contactName
        ? [{ label: 'Contact', value: view.contactName }]
        : []),
      { label: 'Issue date', value: fmtDay(view.issueDate) },
      { label: 'Valid until', value: fmtDay(view.validUntil) },
      { label: 'Proposed start', value: fmtDay(view.proposedStartDate) },
      ...(view.proposedEndDate
        ? [{ label: 'Proposed end', value: fmtDay(view.proposedEndDate) }]
        : []),
    ],
  });
  out.push({
    title: 'Proposed visits',
    rows: view.visits.map((v) => {
      const parts =
        view.layout === 'SUMMARY'
          ? [v.when, carersText(v.carers)]
          : [
              v.when,
              v.duration,
              carersText(v.carers),
              v.perVisit ? `${v.perVisit} per visit` : null,
            ];
      return {
        label: v.label,
        value: view.layout === 'SUMMARY' ? '' : v.weekly,
        note: [
          parts.filter(Boolean).join(' · '),
          v.activities.length ? `Includes: ${v.activities.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }),
  });
  if (view.extras.length)
    out.push({
      title: 'Other charges',
      rows: view.extras.map((e) => ({
        label: e.description,
        value: e.amount,
        note: e.frequency,
      })),
    });
  if (view.rates.length)
    out.push({
      title: 'Rates used',
      rows: view.rates.map((r) => ({ label: r.label, value: r.value })),
    });
  out.push({
    title: 'Cost summary',
    rows: [
      ...view.totals.map((t) => ({
        label: t.label,
        value: t.amount,
        note: t.method,
        bold: true,
      })),
      ...(view.oneOffTotal
        ? [{ label: 'One-off charges', value: view.oneOffTotal, bold: true }]
        : []),
      ...(view.vatLabel
        ? [{ label: 'VAT', value: '', note: view.vatLabel }]
        : []),
    ],
  });
  if (view.funding.length)
    out.push({
      title: 'Who pays',
      rows: [
        ...view.funding.map((f) => ({
          label: f.payer,
          value: f.weekly,
          note: `${f.detail} · ${f.status}`,
        })),
        { label: 'You pay', value: view.clientWeeklyLiability, bold: true },
      ],
    });
  return out;
}

export function buildQuoteEmail(
  view: ClientQuoteView,
  opts: { recipientName: string | null; message: string | null },
): { text: string; html: string } {
  const greeting = `Dear ${opts.recipientName || 'Sir or Madam'},`;
  const intro =
    opts.message ||
    `Thank you for your enquiry. Please find our care quotation ${view.quotationNumber} (version ${view.versionNumber}) below; a PDF copy is attached.`;
  const closing =
    'To accept this quotation or ask about anything in it, please reply to this email or contact us.';
  const contact = [view.provider.email, view.provider.phone]
    .filter(Boolean)
    .join(' · ');
  const all = sections(view);

  const text = [
    greeting,
    '',
    intro,
    '',
    ...all.flatMap((s) => [
      s.title.toUpperCase(),
      ...s.rows.flatMap((r) => [
        r.value ? `- ${r.label}: ${r.value}` : `- ${r.label}`,
        ...(r.note ? r.note.split('\n').map((n) => `    ${n}`) : []),
      ]),
      '',
    ]),
    ...(view.clientNotes ? ['NOTES', view.clientNotes, ''] : []),
    ...(view.terms ? ['TERMS', view.terms, ''] : []),
    closing,
    '',
    'Kind regards,',
    view.provider.name,
    ...(contact ? [contact] : []),
  ].join('\n');

  const cell =
    'padding:8px 0;border-bottom:1px solid #e2e8f0;vertical-align:top;';
  const sectionHtml = (s: Section) => `
      <h2 style="margin:24px 0 8px;font-size:15px;color:#0f766e;">${esc(s.title)}</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
        ${s.rows
          .map(
            (r) => `<tr>
          <td style="${cell}">
            <div style="color:#0f172a;${r.bold ? 'font-weight:600;' : ''}">${esc(r.label)}</div>
            ${r.note ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(r.note).replace(/\n/g, '<br />')}</div>` : ''}
          </td>
          <td style="${cell}text-align:right;white-space:nowrap;padding-left:16px;color:#0f172a;${r.bold ? 'font-weight:600;' : ''}">${esc(r.value)}</td>
        </tr>`,
          )
          .join('')}
      </table>`;
  const block = (title: string, body: string, small = false) => `
      <h2 style="margin:24px 0 8px;font-size:15px;color:#0f766e;">${esc(title)}</h2>
      <p style="margin:0;color:#334155;font-size:${small ? 12 : 14}px;white-space:pre-wrap;">${esc(body)}</p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
        <tr><td style="padding:24px;font-family:'Segoe UI',Arial,sans-serif;color:#334155;line-height:1.5;">
      <p style="margin:0 0 4px;font-size:18px;font-weight:600;color:#0f172a;">${esc(view.provider.name)}</p>
      <p style="margin:0 0 20px;font-size:13px;color:#64748b;">Care quotation ${esc(view.quotationNumber)} · version ${view.versionNumber}</p>
      <p style="margin:0 0 12px;font-size:14px;">${esc(greeting)}</p>
      <p style="margin:0;font-size:14px;white-space:pre-wrap;">${esc(intro)}</p>
      ${all.map(sectionHtml).join('')}
      ${view.clientNotes ? block('Notes', view.clientNotes) : ''}
      ${view.terms ? block('Terms', view.terms, true) : ''}
      <p style="margin:24px 0 0;font-size:14px;">${esc(closing)}</p>
      <p style="margin:16px 0 0;font-size:14px;">Kind regards,<br /><strong style="color:#0f172a;">${esc(view.provider.name)}</strong>${contact ? `<br /><span style="color:#64748b;font-size:13px;">${esc(contact)}</span>` : ''}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { text, html };
}
