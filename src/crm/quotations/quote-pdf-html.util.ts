import type { ClientQuoteView } from './quote-pdf.util';

/** Client quotation document (A4). Self-contained: no external fonts or images, so it renders offline. */

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
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const nl2br = (v: string) => esc(v).replace(/\n/g, '<br />');

const STYLES = `
  :root {
    --brand: #0f766e; --brand-dark: #115e59; --brand-soft: #f0fdfa; --brand-line: #99f6e4;
    --ink: #0f172a; --text: #334155; --muted: #64748b; --faint: #94a3b8; --line: #e2e8f0;
    --amber-soft: #fffbeb; --amber-line: #fde68a; --amber-ink: #92400e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, Arial, sans-serif;
    font-size: 13px; line-height: 1.5; color: var(--text); background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { width: 100%; min-height: 297mm; display: flex; flex-direction: column; }
  .accent-bar { height: 6px; background: linear-gradient(90deg, var(--brand), #14b8a6); }
  .content { padding: 26px 36px 18px; flex: 1; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-mark { width: 44px; height: 44px; border-radius: 12px; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; }
  .brand-mark svg { width: 22px; height: 22px; }
  .brand-name { font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: -.02em; }
  .brand-contact { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .brand-contact span + span::before { content: "•"; margin: 0 6px; color: var(--faint); }
  .doc-meta { text-align: right; }
  .doc-label { font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--brand); }
  .doc-number { font-size: 22px; font-weight: 700; color: var(--ink); letter-spacing: -.02em; margin-top: 2px; }
  .doc-version { font-size: 12px; color: var(--muted); }
  .badges { display: flex; gap: 6px; justify-content: flex-end; margin-top: 10px; }
  .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
  .badge-dot { width: 6px; height: 6px; border-radius: 50%; }
  .badge-approved { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .badge-approved .badge-dot { background: #10b981; }
  .badge-provisional { background: var(--amber-soft); color: var(--amber-ink); border: 1px solid var(--amber-line); }
  .badge-provisional .badge-dot { background: #f59e0b; }
  .badge-neutral { background: #f1f5f9; color: var(--text); border: 1px solid var(--line); }
  .badge-neutral .badge-dot { background: var(--faint); }
  .section { margin-top: 16px; }
  .section-title { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
  .section-title::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .details { display: grid; grid-template-columns: 1.1fr 1.4fr; gap: 16px; }
  .party { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
  .party-label { font-size: 11px; color: var(--muted); }
  .party-name { font-size: 16px; font-weight: 600; color: var(--ink); margin-top: 2px; }
  .party-sub { font-size: 12px; color: var(--text); margin-top: 8px; }
  .party-sub strong { color: var(--ink); font-weight: 500; }
  .dates { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .date { padding: 10px 14px; }
  .date + .date { border-left: 1px solid var(--line); }
  .date-label { font-size: 11px; color: var(--muted); }
  .date-value { font-size: 14px; font-weight: 600; color: var(--ink); margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .grid-table { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; border-collapse: separate; border-spacing: 0; }
  .grid-table th { background: #f8fafc; text-align: left; font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; padding: 7px 12px; border-bottom: 1px solid var(--line); }
  .grid-table td { padding: 8px 12px; vertical-align: top; color: var(--ink); }
  .grid-table tr + tr td { border-top: 1px solid var(--line); }
  .grid-table .num { text-align: right; white-space: nowrap; }
  .visit-name { font-weight: 600; }
  .visit-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .chip { display: inline-block; font-size: 11px; font-weight: 500; background: #f1f5f9; color: var(--text); padding: 2px 8px; border-radius: 6px; margin: 0 4px 3px 0; }
  .costs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .hero-cost { background: var(--brand); color: #fff; border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between; }
  .hero-label { font-size: 12px; opacity: .85; }
  .hero-value { font-size: 30px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; margin-top: 6px; }
  .hero-value small { font-size: 14px; font-weight: 500; opacity: .8; letter-spacing: 0; }
  .hero-note { font-size: 11px; opacity: .8; margin-top: 12px; line-height: 1.45; }
  .cost-list { border: 1px solid var(--line); border-radius: 12px; }
  .cost-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 7px 14px; }
  .cost-row + .cost-row { border-top: 1px solid var(--line); }
  .cost-name { font-weight: 500; color: var(--ink); }
  .cost-calc { font-size: 11px; color: var(--muted); }
  .cost-amount { font-weight: 600; color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .callout { margin-top: 8px; display: flex; gap: 10px; align-items: flex-start; background: #f8fafc; border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; font-size: 11.5px; }
  .callout svg { width: 16px; height: 16px; flex-shrink: 0; color: var(--muted); margin-top: 1px; }
  .callout strong { color: var(--ink); font-weight: 600; }
  .funding { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .funding-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; gap: 12px; }
  .funding-row + .funding-row { border-top: 1px solid var(--line); }
  .funding-source { display: flex; align-items: center; gap: 10px; color: var(--ink); font-weight: 500; }
  .funding-detail { font-size: 11px; color: var(--muted); font-weight: 400; }
  .tag { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; padding: 1px 7px; border-radius: 999px; }
  .tag-confirmed { color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; }
  .tag-pending { color: var(--amber-ink); background: var(--amber-soft); border: 1px solid var(--amber-line); }
  .funding-total { background: var(--brand-soft); border-top: 1px solid var(--brand-line) !important; }
  .funding-total .funding-source { font-weight: 700; color: var(--brand-dark); }
  .funding-total .cost-amount { font-size: 18px; color: var(--brand-dark); }
  .notes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .notes.single { grid-template-columns: 1fr; }
  .note-box { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
  .note-box h4 { font-size: 12px; font-weight: 600; color: var(--ink); margin-bottom: 4px; }
  .note-box p { font-size: 12px; color: var(--text); }
  .accept { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 12px 18px; border: 1px dashed var(--brand-line); background: var(--brand-soft); border-radius: 12px; }
  .accept h4 { font-size: 14px; color: var(--brand-dark); font-weight: 600; }
  .accept p { font-size: 12px; color: var(--text); margin-top: 2px; max-width: 360px; }
  .accept-contact { text-align: right; font-size: 12px; color: var(--ink); font-weight: 500; line-height: 1.7; }
  .footer { padding: 10px 36px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-size: 11px; color: var(--faint); }
  @page { size: A4; margin: 0; }
  .details, .costs, .funding, .notes, .accept, .callout, .grid-table tr { break-inside: avoid; }
  .section-title { break-after: avoid; }
`;

const HEART_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z"/></svg>';
const INFO_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>';

/** Status badge colour: approved / sent / accepted are green, everything else neutral. */
function statusBadge(label: string): string {
  const ok = /approved|sent|accepted|negotiation/i.test(label);
  return `<span class="badge ${ok ? 'badge-approved' : 'badge-neutral'}"><span class="badge-dot"></span>${esc(label)}</span>`;
}

export function renderQuoteHtml(view: ClientQuoteView): string {
  const { provider } = view;
  const contact = [provider.email, provider.phone].filter(Boolean) as string[];
  const [hero, ...otherTotals] = view.totals;
  const provisional = /provisional/i.test(view.quoteTypeLabel);

  // Summary: the visits by time of day only; the price is the total in the cost summary.
  const summary = view.layout === 'SUMMARY';
  const visitRows = view.visits
    .map(
      (v) => `
        <tr>
          <td><div class="visit-name">${esc(v.label)}</div><div class="visit-sub">${esc(v.frequency)}</div>${
            v.activities.length
              ? `<div class="visit-sub">${esc(v.activities.join(', '))}</div>`
              : ''
          }</td>
          <td>${v.days.map((d) => `<span class="chip">${esc(d)}</span>`).join('')}${
            summary ? '' : `<div class="visit-sub">${esc(v.time)}</div>`
          }</td>${
            summary
              ? ''
              : `
          <td>${esc(v.duration)}</td>`
          }
          <td>${v.carers}</td>${
            summary
              ? ''
              : `
          <td class="num">${esc(v.perVisit ?? '—')}</td>
          <td class="num"><strong>${esc(v.weekly)}</strong></td>`
          }
        </tr>`,
    )
    .join('');

  const extras = view.extras.length
    ? `
    <section class="section">
      <h3 class="section-title">Other charges</h3>
      <table class="grid-table">
        <thead><tr><th>Charge</th><th>Frequency</th><th class="num">Amount</th></tr></thead>
        <tbody>${view.extras
          .map(
            (e) =>
              `<tr><td>${esc(e.description)}</td><td>${esc(e.frequency)}</td><td class="num"><strong>${esc(e.amount)}</strong></td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </section>`
    : '';

  const costRows = [
    ...otherTotals.map((t) => ({
      name: t.label,
      calc: t.method,
      amount: t.amount,
    })),
    ...(view.oneOffTotal
      ? [
          {
            name: 'One-off charges',
            calc: 'One-off visits and fees, not in the weekly cost',
            amount: view.oneOffTotal,
          },
        ]
      : []),
  ]
    .map(
      (r) =>
        `<div class="cost-row"><div><div class="cost-name">${esc(r.name)}</div><div class="cost-calc">${esc(r.calc)}</div></div><div class="cost-amount">${esc(r.amount)}</div></div>`,
    )
    .join('');
  const calendar = view.totals.find((t) => /calendar/i.test(t.label));

  const rates = view.rates.length
    ? `
    <section class="section">
      <h3 class="section-title">Rates used</h3>
      <table class="grid-table">
        <thead><tr><th>Visits</th><th class="num">Rate</th></tr></thead>
        <tbody>${view.rates
          .map(
            (r) =>
              `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </section>`
    : '';

  const funding = view.funding.length
    ? `
    <section class="section">
      <h3 class="section-title">Funding</h3>
      <div class="funding">
        ${view.funding
          .map(
            (f) => `
        <div class="funding-row">
          <div class="funding-source">${esc(f.payer)} <span class="funding-detail">${esc(f.detail)}</span>
            <span class="tag ${/confirmed/i.test(f.status) ? 'tag-confirmed' : 'tag-pending'}">${esc(f.status)}</span></div>
          <div class="cost-amount">− ${esc(f.weekly)}</div>
        </div>`,
          )
          .join('')}
        <div class="funding-row funding-total">
          <div class="funding-source">You pay</div>
          <div class="cost-amount">${esc(view.clientWeeklyLiability)}</div>
        </div>
      </div>
    </section>`
    : '';

  const noteBoxes = [
    view.clientNotes
      ? `<div class="note-box"><h4>Notes</h4><p>${nl2br(view.clientNotes)}</p></div>`
      : '',
    view.terms
      ? `<div class="note-box"><h4>Terms</h4><p>${nl2br(view.terms)}</p></div>`
      : '',
  ].filter(Boolean);
  const notes = noteBoxes.length
    ? `
    <section class="section">
      <h3 class="section-title">Notes &amp; terms</h3>
      <div class="notes${noteBoxes.length === 1 ? ' single' : ''}">${noteBoxes.join('')}</div>
    </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Care Quotation ${esc(view.quotationNumber)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
  <div class="accent-bar"></div>
  <div class="content">
    <header class="header">
      <div class="brand">
        <div class="brand-mark">${HEART_ICON}</div>
        <div>
          <div class="brand-name">${esc(provider.name)}</div>
          <div class="brand-contact">${contact.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
        </div>
      </div>
      <div class="doc-meta">
        <div class="doc-label">Care quotation</div>
        <div class="doc-number">${esc(view.quotationNumber)}</div>
        <div class="doc-version">Version ${view.versionNumber}</div>
        <div class="badges">
          <span class="badge ${provisional ? 'badge-provisional' : 'badge-approved'}"><span class="badge-dot"></span>${esc(view.quoteTypeLabel)}</span>
          ${statusBadge(view.statusLabel)}
        </div>
      </div>
    </header>

    <section class="section">
      <h3 class="section-title">Details</h3>
      <div class="details">
        <div class="party">
          <div class="party-label">Prepared for</div>
          <div class="party-name">${esc(view.clientName)}</div>
          ${view.contactName ? `<div class="party-sub">Contact: <strong>${esc(view.contactName)}</strong></div>` : ''}
        </div>
        <div class="dates">
          <div class="date"><div class="date-label">Issue date</div><div class="date-value">${fmtDay(view.issueDate)}</div></div>
          <div class="date"><div class="date-label">Valid until</div><div class="date-value">${fmtDay(view.validUntil)}</div></div>
          <div class="date"><div class="date-label">Proposed start</div><div class="date-value">${fmtDay(view.proposedStartDate)}</div></div>
        </div>
      </div>
    </section>

    <section class="section">
      <h3 class="section-title">Proposed visits</h3>
      <table class="grid-table">
        <thead><tr>${
          summary
            ? '<th>Visit</th><th>Days</th><th>Carers</th>'
            : '<th>Visit</th><th>Schedule</th><th>Duration</th><th>Carers</th><th class="num">Per visit</th><th class="num">Price</th>'
        }</tr></thead>
        <tbody>${visitRows}</tbody>
      </table>
    </section>
    ${rates}
    ${extras}

    <section class="section">
      <h3 class="section-title">Cost summary</h3>
      <div class="costs">
        <div class="hero-cost">
          <div>
            <div class="hero-label">${esc(hero?.label ?? 'Weekly')} cost</div>
            <div class="hero-value">${esc(hero?.amount ?? '—')} <small>/ week</small></div>
          </div>
          <div class="hero-note">${esc(hero?.method ?? '')}</div>
        </div>
        <div class="cost-list">${costRows}</div>
      </div>
      ${
        calendar || view.vatLabel
          ? `<div class="callout">${INFO_ICON}<div>${
              calendar ? `${esc(calendar.method)}. ` : ''
            }${view.vatLabel ? `<strong>${esc(view.vatLabel)}</strong>` : ''}</div></div>`
          : ''
      }
    </section>
    ${funding}
    ${notes}

    <div class="accept">
      <div>
        <h4>Ready to go ahead?</h4>
        <p>This quotation is an estimate based on the visits described above. To accept, please contact us — acceptance is recorded by our office.</p>
      </div>
      <div class="accept-contact">${contact.map(esc).join('<br />')}</div>
    </div>
  </div>
  <footer class="footer">
    <span>${esc(provider.name)} · Quotation ${esc(view.quotationNumber)} · v${view.versionNumber}</span>
    <span>${provider.vatNumber ? `VAT no. ${esc(provider.vatNumber)}` : ''}</span>
  </footer>
</div>
<script>
  // Keep the quotation on one A4 page: a long quote is scaled down to fit. Past 50% it would be
  // hard to read, so a very long quote is left to run onto a second page instead.
  (function () {
    var page = document.querySelector('.page');
    var pageWidth = document.documentElement.clientWidth;
    var pageHeight = 1122; // 297mm at 96dpi
    page.style.minHeight = '0';
    if (page.scrollHeight <= pageHeight) {
      page.style.minHeight = '297mm';
      return;
    }
    // Scaling makes the page wider in layout, which makes it shorter: settle in a few passes.
    var zoom = 1;
    for (var i = 0; i < 4; i++) {
      page.style.width = pageWidth / zoom + 'px';
      zoom = Math.min(1, pageHeight / page.scrollHeight);
    }
    if (zoom < 0.5) {
      page.style.width = '';
      return;
    }
    page.style.width = pageWidth / zoom + 'px';
    page.style.minHeight = pageHeight / zoom + 'px';
    page.style.transformOrigin = 'top left';
    page.style.transform = 'scale(' + zoom + ')';
    document.documentElement.style.height = '297mm';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.height = '297mm';
    document.body.style.overflow = 'hidden';
  })();
</script>
</body>
</html>`;
}
