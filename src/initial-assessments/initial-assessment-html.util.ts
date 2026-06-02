import type { InitialAssessmentPdfData } from './initial-assessment-pdf-data.util';

function escapeHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

const COVER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function formatCoverDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = d.getDate();
  const mon = COVER_MONTHS[d.getMonth()];
  const yr = String(d.getFullYear()).slice(-2);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}/${mon}/${yr} ${time}`;
}

function serviceUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const last = parts[parts.length - 1]?.[0] ?? '';
    return `${first}${last}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || 'SU';
}

function coverFieldRow(label: string, value: string): string {
  return `<div class="cover-field">
    <div class="cover-field-label">${escapeHtml(label)}</div>
    <div class="cover-field-value">${escapeHtml(value)}</div>
  </div>`;
}

function bulletList(lines: string[]): string {
  if (lines.length === 0) return '<p class="muted">None recorded.</p>';
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
}

function metaRow(label: string, value: string, sub?: string): string {
  const subHtml = sub
    ? `<span class="meta-sub">${escapeHtml(sub)}</span>`
    : '';
  return `<tr>
    <th scope="row">${escapeHtml(label)}</th>
    <td>${escapeHtml(value)}${subHtml}</td>
  </tr>`;
}

function card(title: string, body: string): string {
  return `<section class="card">
  <h2>${escapeHtml(title)}</h2>
  <div class="card-body">${body}</div>
</section>`;
}

function brandLogoHtml(data: InitialAssessmentPdfData, className = 'brand-logo'): string {
  const label = data.organisationName?.trim() || data.companyLegalName?.trim() || 'Organisation';
  const logo = data.organisationLogoUrl?.trim();
  if (logo) {
    const src = logo.startsWith('data:') ? logo : escapeHtml(logo);
    return `<img class="${className}" src="${src}" alt="${escapeHtml(label)}" />`;
  }
  const initials = label.slice(0, 2).toUpperCase();
  return `<span class="brand-initials ${className === 'cover-org-logo' ? 'cover-org-initials' : ''}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

function buildCoverPageHtml(data: InitialAssessmentPdfData): string {
  const orgDisplay = data.organisationName?.trim() || data.companyLegalName?.trim() || 'Organisation';
  const companyLegal = data.companyLegalName?.trim() || orgDisplay;
  const productName = data.productBrandName?.trim() || 'CareAdmin';
  const suInitials = serviceUserInitials(data.serviceUserName);
  const fileId = data.serviceUserNumber?.trim() || data.submissionId.slice(0, 8).toUpperCase();
  const statusLabel = data.status.replace(/_/g, ' ');

  const lastUpdatedLine = data.submittedAt
    ? `Submitted by ${data.submittedBy ?? '—'} at ${formatCoverDateTime(data.submittedAt)}`
    : 'Not yet submitted';
  const reviewedLine =
    data.reviewedAt && data.reviewedBy
      ? ` · Reviewed by ${data.reviewedBy} at ${formatCoverDateTime(data.reviewedAt)}`
      : data.reviewedAt
        ? ` · Reviewed at ${formatCoverDateTime(data.reviewedAt)}`
        : '';

  const documentTitle = `${data.templateName} — Initial Assessment`;

  return `<section class="cover-page" aria-label="Cover page">
  <div class="cover-top">
    <div class="cover-top-right">
      ${brandLogoHtml(data, 'cover-org-logo')}
      <div class="cover-top-brand">
        <span class="cover-product">${escapeHtml(productName)}</span>
        <span class="cover-product-sub">Care Planning</span>
      </div>
    </div>
    <div class="cover-su-corner">
      <span class="cover-su-corner-label">Service user</span>
      <span class="cover-su-corner-name">${escapeHtml(data.serviceUserName)}</span>
    </div>
  </div>

  <div class="cover-file-band">
    <div class="cover-file-inner">
      <div class="cover-file-fields">
        ${coverFieldRow('Service user', data.serviceUserName)}
        ${coverFieldRow('Service user ID', fileId)}
        ${coverFieldRow('Date of birth', data.dateOfBirth ?? '—')}
        ${coverFieldRow('Printed by', data.generatedBy ?? '—')}
        ${coverFieldRow('Printed date', formatCoverDateTime(data.generatedAt))}
      </div>
      <div class="cover-avatar" aria-hidden="true">${escapeHtml(suInitials)}</div>
    </div>
  </div>

  <div class="cover-title-block">
    <h1 class="cover-title">${escapeHtml(documentTitle)}</h1>
    <p class="cover-meta">${escapeHtml(lastUpdatedLine)}${escapeHtml(reviewedLine)}</p>
    <p class="cover-meta">Submission ID: ${escapeHtml(data.submissionId)} · Status: ${escapeHtml(statusLabel)}</p>
    ${data.assessmentReason ? `<p class="cover-meta">Assessment reason: ${escapeHtml(data.assessmentReason)}</p>` : ''}
  </div>

  <hr class="cover-rule" />

  <div class="cover-bottom">
    ${brandLogoHtml(data, 'cover-bottom-logo')}
    <p class="cover-bottom-title">${escapeHtml(companyLegal)}</p>
    <p class="cover-bottom-sub">Initial assessment and care planning record · Powered by ${escapeHtml(productName)}</p>
  </div>
</section>`;
}

export function buildInitialAssessmentHtml(data: InitialAssessmentPdfData): string {
  const orgDisplay = data.organisationName?.trim() || data.companyLegalName?.trim() || 'Organisation';
  const companyLegal = data.companyLegalName?.trim() || orgDisplay;
  const productName = data.productBrandName?.trim() || 'CareAdmin';
  const clinicalLines: string[] = [];
  if (data.waterlowScore != null) clinicalLines.push(`Waterlow score: ${data.waterlowScore}`);
  if (data.adlTotal != null) {
    clinicalLines.push(
      `ADL total: ${data.adlTotal}${data.adlDependency ? ` (${data.adlDependency})` : ''}`,
    );
  }
  clinicalLines.push(...data.vitalsSummary, ...data.fallsSummary, ...data.medicationSummary);

  const riskItems = data.risks.map(
    (r) =>
      `<li><strong>${escapeHtml(r.riskType.replace(/_/g, ' '))}</strong> · ${escapeHtml(r.riskLevel)} — ${escapeHtml(r.description)}</li>`,
  );

  const actionItems = data.openActions.map((a) => {
    const due = a.dueDate ? ` · due ${a.dueDate}` : '';
    return `<li><strong>${escapeHtml(a.title)}</strong> <span class="muted">(${escapeHtml(a.priority)}, ${escapeHtml(a.status.replace(/_/g, ' '))}${escapeHtml(due)})</span></li>`;
  });

  const answeredSections = data.sections.filter((s) => s.rows.length > 0);

  const tocHtml =
    answeredSections.length > 0
      ? `<nav class="toc card" aria-label="Table of contents">
  <h2>Contents</h2>
  <ol class="toc-list">
    ${answeredSections
      .map(
        (s) =>
          `<li><a href="#section-${s.sectionNumber}"><span class="toc-num">${s.sectionNumber}</span> ${escapeHtml(s.title)} <span class="toc-count">${s.rows.length} answer${s.rows.length === 1 ? '' : 's'}</span></a></li>`,
      )
      .join('')}
  </ol>
</nav>`
      : '';

  const sectionBlocks = answeredSections
    .map((section) => {
      const rows = section.rows
        .map((row) => {
          const ref = row.specRef
            ? `<span class="spec-ref">${escapeHtml(row.specRef)}</span> `
            : '';
          return `<article class="qa">
  <h3 class="question">${ref}${escapeHtml(row.questionText)}</h3>
  <p class="answer">${escapeHtml(row.answerText)}</p>
</article>`;
        })
        .join('');
      return `<section class="ia-section" id="section-${section.sectionNumber}">
  <h2 class="section-title"><span class="section-num">${section.sectionNumber}</span> ${escapeHtml(section.title)}</h2>
  ${rows}
</section>`;
    })
    .join('\n');

  const s = data.signOff;
  const statusLabel = data.status.replace(/_/g, ' ');

  const signOffBody = `<dl class="kv">
  <div><dt>Service user agrees</dt><dd>${s.serviceUserAgrees == null ? '—' : s.serviceUserAgrees ? 'Yes' : 'No'}</dd></div>
  <div><dt>Signature obtained</dt><dd>${s.signatureObtained == null ? '—' : s.signatureObtained ? 'Yes' : 'No'}</dd></div>
  <div><dt>Assessor declaration</dt><dd>${s.assessorDeclarationConfirmed == null ? '—' : s.assessorDeclarationConfirmed ? 'Yes' : 'No'}</dd></div>
  <div><dt>Assessor</dt><dd>${escapeHtml(s.assessorName ? `${s.assessorName}${s.assessorRole ? ` (${s.assessorRole})` : ''}` : '—')}</dd></div>
  <div><dt>Sign-off date</dt><dd>${escapeHtml(s.assessorSignDate ?? '—')}</dd></div>
</dl>`;

  const reviewBody = `<dl class="kv">
  <div><dt>Manager review required</dt><dd>${data.managerReview.required ? 'Yes' : 'No'}</dd></div>
  <div><dt>Approved for care start</dt><dd>${data.managerReview.approvedForCareStart ? 'Yes' : 'No'}</dd></div>
  <div><dt>Care start conditions</dt><dd>${escapeHtml(data.managerReview.conditions ?? '—')}</dd></div>
  <div><dt>Review notes</dt><dd>${escapeHtml(data.reviewNotes ?? '—')}</dd></div>
</dl>`;

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Initial Assessment — ${escapeHtml(data.serviceUserName)}</title>
  <style>
    :root {
      --ink: #0f172a;
      --body: #334155;
      --muted: #64748b;
      --border: #e2e8f0;
      --bg: #f8fafc;
      --teal: #0f766e;
      --teal-light: #f0fdfa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.55;
      color: var(--body);
      background: #fff;
    }
    .wrap { max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem 3rem; }
    .cover-page {
      min-height: 100vh;
      max-width: 800px;
      margin: 0 auto;
      padding: 1.75rem 1.5rem 2rem;
      display: flex;
      flex-direction: column;
      page-break-after: always;
      break-after: page;
    }
    .cover-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .cover-top-right {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      margin-left: auto;
    }
    .cover-org-logo, .cover-bottom-logo {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .cover-org-initials, .brand-initials.cover-org-initials {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #e11d48;
      color: #fff;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .cover-top-brand { display: flex; flex-direction: column; line-height: 1.15; }
    .cover-product {
      font-size: 1.35rem;
      font-weight: 700;
      color: #64748b;
      letter-spacing: -0.02em;
    }
    .cover-product-sub {
      font-size: 1.35rem;
      font-weight: 700;
      color: #e11d48;
      letter-spacing: -0.02em;
    }
    .cover-su-corner { text-align: right; flex-shrink: 0; }
    .cover-su-corner-label {
      display: block;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    .cover-su-corner-name {
      display: block;
      margin-top: 0.15rem;
      font-size: 1rem;
      font-weight: 700;
      color: var(--ink);
      max-width: 14rem;
      line-height: 1.25;
    }
    .cover-file-band {
      border-top: 3px solid var(--ink);
      border-bottom: 3px solid var(--ink);
      margin-bottom: 1.75rem;
    }
    .cover-file-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 1.25rem 0.25rem;
    }
    .cover-file-fields {
      flex: 1;
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 2rem;
      row-gap: 0.65rem;
      align-items: baseline;
    }
    .cover-field { display: contents; }
    .cover-field-label {
      font-size: 1rem;
      font-weight: 700;
      color: var(--ink);
      white-space: nowrap;
    }
    .cover-field-value {
      font-size: 1rem;
      font-weight: 400;
      color: var(--ink);
    }
    .cover-avatar {
      flex-shrink: 0;
      width: 88px;
      height: 88px;
      border-radius: 50%;
      background: #2563eb;
      color: #fff;
      font-size: 1.75rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      letter-spacing: 0.02em;
    }
    .cover-title-block { margin-bottom: 1.25rem; }
    .cover-title {
      margin: 0 0 0.65rem;
      font-size: 1.65rem;
      font-weight: 700;
      color: var(--ink);
      line-height: 1.25;
      letter-spacing: -0.02em;
    }
    .cover-meta {
      margin: 0.2rem 0 0;
      font-size: 0.9rem;
      color: var(--muted);
      line-height: 1.45;
    }
    .cover-rule {
      border: 0;
      border-top: 1px solid #cbd5e1;
      margin: 0 0 1.5rem;
    }
    .cover-bottom {
      margin-top: auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.65rem 0.85rem;
    }
    .cover-bottom-logo { width: 36px; height: 36px; border-radius: 6px; }
    .cover-bottom-title {
      margin: 0;
      width: 100%;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--teal);
      line-height: 1.3;
    }
    .cover-bottom-sub {
      margin: 0;
      width: 100%;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--teal);
      line-height: 1.35;
    }
    .brand-logo {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      border: 1px solid var(--border);
      object-fit: cover;
      flex-shrink: 0;
    }
    .brand-initials {
      display: flex;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: var(--teal);
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .doc-body-header {
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    .doc-body-header h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
      color: var(--teal);
    }
    .doc-body-header p { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--muted); }
    .notice {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      font-size: 0.8rem;
      margin-bottom: 1.25rem;
    }
    .card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.15rem;
      margin-bottom: 1.25rem;
    }
    .card h2 {
      margin: 0 0 0.75rem;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--teal);
    }
    .card-body { font-size: 0.9rem; }
    .toc { margin-bottom: 1.25rem; }
    .toc h2 { margin-bottom: 0.65rem; }
    .toc-list {
      margin: 0;
      padding: 0;
      list-style: none;
      columns: 2;
      column-gap: 1.5rem;
    }
    .toc-list li { margin: 0.3rem 0; break-inside: avoid; }
    .toc-list a {
      color: var(--teal);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
    }
    .toc-list a:hover { text-decoration: underline; }
    .toc-num {
      display: inline-block;
      min-width: 1.25rem;
      font-weight: 700;
      color: var(--ink);
    }
    .toc-count {
      font-size: 0.8rem;
      font-weight: 400;
      color: var(--muted);
    }
    @media (max-width: 520px) { .toc-list { columns: 1; } }
    table.meta { width: 100%; border-collapse: collapse; }
    table.meta th {
      width: 36%;
      padding: 0.35rem 0.75rem 0.35rem 0;
      text-align: left;
      font-weight: 600;
      color: var(--muted);
      vertical-align: top;
    }
    table.meta td { padding: 0.35rem 0; color: var(--ink); }
    .meta-sub { display: block; font-size: 0.8rem; font-weight: 400; color: var(--muted); margin-top: 0.1rem; }
    ul { margin: 0.25rem 0 0; padding-left: 1.2rem; }
    ul li { margin: 0.35rem 0; }
    .muted { color: var(--muted); font-weight: 400; }
    .kv { margin: 0; }
    .kv > div {
      display: grid;
      grid-template-columns: minmax(0, 11rem) 1fr;
      gap: 0.5rem 1rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--border);
    }
    .kv > div:last-child { border-bottom: 0; }
    .kv dt { margin: 0; font-weight: 600; color: var(--muted); font-size: 0.85rem; }
    .kv dd { margin: 0; color: var(--ink); }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }
    @media (max-width: 560px) { .two-col { grid-template-columns: 1fr; } }
    .responses-heading {
      margin: 2rem 0 1rem;
      font-size: 1rem;
      font-weight: 700;
      color: var(--ink);
    }
    .ia-section { margin-bottom: 2rem; }
    .section-title {
      margin: 0 0 0.85rem;
      font-size: 1.05rem;
      font-weight: 600;
      color: var(--teal);
      padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--border);
    }
    .section-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.5rem;
      height: 1.5rem;
      margin-right: 0.35rem;
      font-size: 0.8rem;
      font-weight: 700;
      color: #fff;
      background: var(--teal);
      border-radius: 4px;
      vertical-align: middle;
    }
    .qa {
      margin: 0 0 0.75rem;
      padding: 0.7rem 0.85rem;
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .qa .question {
      margin: 0 0 0.35rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--ink);
      line-height: 1.4;
    }
    .qa .answer {
      margin: 0;
      white-space: pre-wrap;
      color: var(--body);
      font-size: 0.9rem;
    }
    .spec-ref {
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--muted);
    }
    .doc-footer {
      margin-top: 2.5rem;
      padding-top: 1.25rem;
      border-top: 2px solid var(--teal);
      text-align: center;
    }
    .footer-brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      margin-bottom: 0.85rem;
    }
    .footer-brand .brand-logo { width: 32px; height: 32px; }
    .footer-brand .brand-initials { width: 32px; height: 32px; font-size: 0.65rem; }
    .footer-org { margin: 0; font-size: 0.9rem; color: var(--ink); }
    .footer-powered { margin: 0; font-size: 0.8rem; color: var(--muted); }
    .footer-meta { margin: 0.35rem 0 0; font-size: 0.75rem; color: var(--muted); }
    .footer-confidential {
      margin: 0.5rem 0 0;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--teal);
    }
    @media (max-width: 520px) {
      .cover-file-inner { flex-direction: column; align-items: flex-start; }
      .cover-top { flex-direction: column; }
      .cover-su-corner { text-align: left; }
    }
    @page { size: A4; margin: 12mm; }
    @media print {
      .cover-page { min-height: 100vh; max-width: none; padding: 0.55in 0.6in; }
      .wrap { max-width: none; padding: 0.5in; }
      .card { break-inside: avoid; }
      .ia-section { break-inside: avoid-page; }
    }
  </style>
</head>
<body>
  ${buildCoverPageHtml(data)}

  <div class="wrap doc-body">
    <header class="doc-body-header">
      <h2>Assessment detail</h2>
      <p>${escapeHtml(data.serviceUserName)} · ${escapeHtml(data.templateName)} v${data.templateVersion}</p>
    </header>

    ${
      !data.includeSecureFields
        ? '<p class="notice">Secure access fields (door code, key safe) are withheld from this export.</p>'
        : ''
    }

    ${card(
      'Record summary',
      `<table class="meta">
        ${metaRow('Submitted', formatIsoDateTime(data.submittedAt), data.submittedBy ?? undefined)}
        ${metaRow('Reviewed', formatIsoDateTime(data.reviewedAt), data.reviewedBy ?? undefined)}
        ${metaRow('Generated', formatIsoDateTime(data.generatedAt), data.generatedBy ?? undefined)}
        ${metaRow('Submission ID', data.submissionId)}
      </table>`,
    )}

    ${tocHtml}

    ${clinicalLines.length ? card('Clinical summary', bulletList(clinicalLines)) : ''}

    ${data.consentSummary.length ? card('Consent & capacity', bulletList(data.consentSummary)) : ''}

    ${data.safeguardingSummary.length ? card('Safeguarding & emergency', bulletList(data.safeguardingSummary)) : ''}

    ${riskItems.length ? card('Risk records', `<ul>${riskItems.join('')}</ul>`) : ''}

    ${actionItems.length ? card('Open actions', `<ul>${actionItems.join('')}</ul>`) : ''}

    ${card(
      'Sign-off & manager review',
      `<div class="two-col">
        <div><h3 style="margin:0 0 0.5rem;font-size:0.9rem;color:var(--ink)">Sign-off</h3>${signOffBody}</div>
        <div><h3 style="margin:0 0 0.5rem;font-size:0.9rem;color:var(--ink)">Manager review</h3>${reviewBody}</div>
      </div>`,
    )}

    <h2 class="responses-heading">Assessment responses</h2>
    ${sectionBlocks || '<p class="muted">No answered questions to export.</p>'}

    <footer class="doc-footer">
      <div class="footer-brand">
        ${brandLogoHtml(data)}
        <p class="footer-org">${escapeHtml(companyLegal)}</p>
        <p class="footer-powered">Powered by ${escapeHtml(productName)} · Care management platform</p>
      </div>
      <p class="footer-meta">Exported ${escapeHtml(formatIsoDateTime(data.generatedAt))}${data.generatedBy ? ` · ${escapeHtml(data.generatedBy)}` : ''}</p>
      <p class="footer-confidential">Confidential — for authorised care and regulatory use only</p>
    </footer>
  </div>
</body>
</html>`;
}

export function initialAssessmentHtmlFilename(data: InitialAssessmentPdfData): string {
  const slug = data.serviceUserNumber ?? data.submissionId.slice(0, 8);
  const date = data.generatedAt.slice(0, 10);
  return `initial-assessment-${slug}-${date}.html`;
}
