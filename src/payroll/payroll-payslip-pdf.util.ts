import PDFDocument from 'pdfkit'
import type { CarePayslipData } from './types/payslip.types'
import { formatUkPayslipDate } from './payroll-payslip.util'

export { formatUkPayslipDate } from './payroll-payslip.util'

type Doc = InstanceType<typeof PDFDocument>

const C = {
  ink: '#0f172a',
  muted: '#64748b',
  soft: '#94a3b8',
  line: '#e2e8f0',
  border: '#cbd5e1',
  headerBg: '#0f172a',
  headerMuted: '#94a3b8',
  cardBg: '#ffffff',
  stripe: '#f8fafc',
  payHead: '#0f766e',
  payHeadBg: '#f0fdfa',
  dedHead: '#475569',
  dedHeadBg: '#f8fafc',
  netBg: '#ecfdf5',
  netInk: '#065f46',
  netAccent: '#10b981',
  ytdBg: '#f1f5f9',
  accent: '#0d9488',
}

/**
 * Helvetica (WinAnsi) cannot render most Unicode. Normalise fancy punctuation
 * and keep ASCII + Latin-1 pound sign.
 */
export function sanitizePayslipPdfText(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/\u2026/g, '...')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u00B7\u2022\u2023\u2043]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x20-\x7E\u00A3\n]/g, '?')
}

function sanitize(value: string | null | undefined): string {
  return sanitizePayslipPdfText(value)
}

function gbp(amount: number): string {
  // Helvetica WinAnsi supports U+00A3. Never run this through ASCII-only sanitize.
  const n = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `\u00A3${n}`
}

/** Space a UK NI number for display (AB123456C -> AB 12 34 56 C). */
export function formatUkNinoDisplay(nino: string | null | undefined): string {
  if (!nino?.trim()) return '-'
  const c = nino.replace(/\s+/g, '').toUpperCase()
  if (c.length !== 9) return sanitize(nino.trim().toUpperCase())
  return `${c.slice(0, 2)} ${c.slice(2, 4)} ${c.slice(4, 6)} ${c.slice(6, 8)} ${c.slice(8)}`
}

function fillRect(doc: Doc, x: number, y: number, w: number, h: number, color: string) {
  doc.save().rect(x, y, w, h).fill(color).restore()
}

function strokeRect(doc: Doc, x: number, y: number, w: number, h: number, color = C.border) {
  doc.strokeColor(color).lineWidth(0.8).rect(x, y, w, h).stroke()
}

function hLine(doc: Doc, x: number, y: number, width: number, color = C.line) {
  doc.strokeColor(color).lineWidth(0.6).moveTo(x, y).lineTo(x + width, y).stroke()
}

type MoneyRow = { label: string; amount: string; bold?: boolean; muted?: boolean }

function moneyPanel(
  doc: Doc,
  x: number,
  y: number,
  width: number,
  title: string,
  headBg: string,
  headInk: string,
  rows: MoneyRow[],
  minRows: number,
): number {
  const pad = 10
  const rowH = 16
  const headerH = 22
  const bodyRows = Math.max(rows.length, minRows)
  const height = headerH + bodyRows * rowH + 6

  fillRect(doc, x, y, width, height, C.cardBg)
  strokeRect(doc, x, y, width, height)
  fillRect(doc, x, y, width, headerH, headBg)
  fillRect(doc, x, y, 3, height, headInk)

  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(headInk)
    .text(title.toUpperCase(), x + pad + 2, y + 7, { width: width - pad * 2 })

  let cy = y + headerH
  for (let i = 0; i < bodyRows; i++) {
    const row = rows[i]
    if (i % 2 === 1) {
      fillRect(doc, x + 3, cy, width - 3, rowH, C.stripe)
    }
    if (row?.bold) {
      fillRect(doc, x + 3, cy, width - 3, rowH, headBg)
    }
    if (row) {
      doc
        .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(row.muted ? C.muted : C.ink)
        .text(sanitize(row.label), x + pad + 2, cy + 4, { width: width * 0.55 - pad })
      doc
        .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(row.muted ? C.muted : C.ink)
        .text(row.amount, x + width * 0.52, cy + 4, {
          width: width * 0.48 - pad,
          align: 'right',
        })
    }
    cy += rowH
  }

  strokeRect(doc, x, y, width, height)
  return y + height
}

function metaCard(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  lines: Array<{ text: string; bold?: boolean; size?: number }>,
) {
  fillRect(doc, x, y, w, h, C.cardBg)
  strokeRect(doc, x, y, w, h)
  fillRect(doc, x, y, 3, h, C.accent)

  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted).text(title, x + 12, y + 8)
  let ty = y + 22
  for (const line of lines) {
    doc
      .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(line.size ?? 9)
      .fillColor(C.ink)
      .text(sanitize(line.text), x + 12, ty, { width: w - 24 })
    ty = doc.y + 2
  }
}

/**
 * Enhanced A4 UK itemised pay statement (ERA 1996 s.8).
 */
export function buildPayslipPdf(data: CarePayslipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: {
        Title: `Payslip - ${data.employee.displayName} - ${data.period.paymentDate}`,
        Author: 'Care Payroll',
        Subject: 'Itemised pay statement (ERA 1996 s.8)',
      },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageW = doc.page.width
    const left = 36
    const contentW = pageW - 72
    const gap = 10
    const colW = (contentW - gap) / 2
    let y = 36

    // —— Header band ——
    const headerH = 74
    fillRect(doc, left, y, contentW, headerH, C.headerBg)
    fillRect(doc, left, y + headerH - 4, contentW, 4, C.accent)

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#ffffff')
      .text(sanitize(data.employer.name).toUpperCase(), left + 14, y + 10, {
        width: contentW * 0.58,
      })
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.headerMuted)
      .text('PAYSLIP  |  ITEMISED PAY STATEMENT', left + 14, y + 28)
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#ffffff')
      .text(sanitize(data.period.periodCaption), left + 14, y + 42, {
        width: contentW * 0.58,
      })
    if (data.employer.fullPayeReference) {
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(C.headerMuted)
        .text(`PAYE ref  ${sanitize(data.employer.fullPayeReference)}`, left + 14, y + 56)
    }

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(C.headerMuted)
      .text('PAYMENT DATE', left + contentW * 0.58, y + 14, {
        width: contentW * 0.42 - 14,
        align: 'right',
      })
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#ffffff')
      .text(formatUkPayslipDate(data.period.paymentDate), left + contentW * 0.58, y + 28, {
        width: contentW * 0.42 - 14,
        align: 'right',
      })
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.headerMuted)
      .text(sanitize(data.period.frequencyLabel), left + contentW * 0.58, y + 50, {
        width: contentW * 0.42 - 14,
        align: 'right',
      })
    y += headerH + 14

    // —— Employee / period cards ——
    const metaH = 78
    metaCard(doc, left, y, colW, metaH, 'EMPLOYEE', [
      { text: data.employee.displayName, bold: true, size: 11 },
      { text: `Payroll no.  ${data.employee.payrollNumber || '-'}`, size: 8 },
      { text: `NI number    ${formatUkNinoDisplay(data.employee.nationalInsuranceNo)}`, size: 8 },
    ])
    metaCard(doc, left + colW + gap, y, colW, metaH, 'PAY PERIOD', [
      { text: data.period.periodCaption, bold: true, size: 9 },
      {
        text: `Tax code  ${data.employee.taxCode || '-'}    NI cat  ${data.employee.niCategory || '-'}`,
        size: 8,
      },
      {
        text: `${data.period.taxYearLabel}  |  ${data.period.scheduleName}`,
        size: 7.5,
      },
    ])
    y += metaH + 14

    // —— Payments | Deductions ——
    const paymentRows: MoneyRow[] = [
      ...(data.earnings.length
        ? data.earnings.map((e) => ({ label: e.label, amount: gbp(e.amount) }))
        : [{ label: 'Gross pay', amount: gbp(0), muted: true }]),
    ]
    if (data.hoursWorked.totalHours != null && data.hoursWorked.totalHours > 0) {
      paymentRows.push({
        label: `Hours worked (${data.hoursWorked.totalHours.toFixed(2)} hrs)`,
        amount: '-',
        muted: true,
      })
    }
    paymentRows.push({
      label: 'Gross pay',
      amount: gbp(data.totals.grossPay),
      bold: true,
    })

    const deductionRows: MoneyRow[] = [
      ...(data.deductions.length
        ? data.deductions.map((d) => ({ label: d.label, amount: gbp(d.amount) }))
        : [{ label: 'No deductions this period', amount: gbp(0), muted: true }]),
      {
        label: 'Total deductions',
        amount: gbp(data.totals.totalDeductions),
        bold: true,
      },
    ]

    const minRows = Math.max(paymentRows.length, deductionRows.length, 4)
    const payBottom = moneyPanel(
      doc,
      left,
      y,
      colW,
      'Payments',
      C.payHeadBg,
      C.payHead,
      paymentRows,
      minRows,
    )
    const dedBottom = moneyPanel(
      doc,
      left + colW + gap,
      y,
      colW,
      'Deductions',
      C.dedHeadBg,
      C.dedHead,
      deductionRows,
      minRows,
    )
    y = Math.max(payBottom, dedBottom) + 14

    // —— Net pay ——
    const bankStatusLabel =
      sanitize(data.payment.bankStatusLabel) || 'Calculated - not yet paid'
    const netH = 56
    fillRect(doc, left, y, contentW, netH, C.netBg)
    strokeRect(doc, left, y, contentW, netH, '#a7f3d0')
    fillRect(doc, left, y, 4, netH, C.netAccent)

    const netLabel = 'NET PAY THIS PERIOD'
    const netMethod = sanitize(data.payment.methodLabel) || 'Bank transfer'
    const netMethodLine = `${netMethod}  |  ${bankStatusLabel}`
    const netAmount = gbp(data.totals.netPay)
    const leftColW = contentW * 0.52
    const rightColX = left + leftColW
    const rightColW = contentW - leftColW - 16

    // Vertically centre left label stack and right amount in the banner.
    doc.font('Helvetica').fontSize(7.5)
    const labelH = 7.5
    doc.font('Helvetica').fontSize(8)
    const methodH = 8
    const leftStackH = labelH + 4 + methodH
    const leftTop = y + (netH - leftStackH) / 2

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(C.netInk)
      .text(netLabel, left + 16, leftTop, { width: leftColW - 20, lineBreak: false })
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(C.netInk)
      .text(netMethodLine, left + 16, leftTop + labelH + 4, {
        width: leftColW - 20,
        lineBreak: false,
      })

    doc.font('Helvetica-Bold').fontSize(18)
    const amountTop = y + (netH - 18) / 2
    doc
      .fillColor(C.netInk)
      .text(netAmount, rightColX, amountTop, {
        width: rightColW,
        align: 'right',
        lineBreak: false,
      })
    y += netH + 12

    if (data.employerCosts.length > 0) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(C.muted)
        .text(
          `Employer costs (not deducted from your pay): ${data.employerCosts
            .map((c) => `${c.label} ${gbp(c.amount)}`)
            .join('  |  ')}`,
          left,
          y,
          { width: contentW },
        )
      y += 14
    }

    if (data.pensionInformation.length > 0) {
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(C.muted)
        .text(
          `Workplace pension (information, not deducted again): ${data.pensionInformation
            .map((c) => `${c.label} ${gbp(c.amount)}`)
            .join('  |  ')}`,
          left,
          y,
          { width: contentW },
        )
      y += 14
    }

    // —— YTD ——
    if (data.ytd) {
      const ytdH = 52
      fillRect(doc, left, y, contentW, ytdH, C.ytdBg)
      strokeRect(doc, left, y, contentW, ytdH)
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(C.muted)
        .text('YEAR TO DATE  (this tax year)', left + 12, y + 8)

      const cells = [
        ['Gross', gbp(data.ytd.grossPayYtd)],
        ['Taxable', gbp(data.ytd.taxablePayYtd)],
        ['Tax', gbp(data.ytd.incomeTaxYtd)],
        ['Employee NI', gbp(data.ytd.employeeNiYtd)],
        ['Net', gbp(data.ytd.netPayYtd)],
      ]
      const cellW = (contentW - 24) / cells.length
      cells.forEach(([label, value], i) => {
        const cx = left + 12 + i * cellW
        if (i > 0) {
          doc
            .strokeColor(C.border)
            .lineWidth(0.5)
            .moveTo(cx - 4, y + 20)
            .lineTo(cx - 4, y + ytdH - 8)
            .stroke()
        }
        doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(label, cx, y + 22)
        doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(value, cx, y + 34)
      })
      y += ytdH + 14
    }

    // —— Notes ——
    if (data.notes.length > 0) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text('Notes', left, y)
      y += 12
      hLine(doc, left, y, contentW)
      y += 8
      doc.font('Helvetica').fontSize(7).fillColor(C.soft)
      for (const note of data.notes) {
        doc.text(`- ${sanitize(note)}`, left, y, { width: contentW })
        y = doc.y + 3
      }
    }

    // —— Footer ——
    doc
      .font('Helvetica')
      .fontSize(6.5)
      .fillColor(C.soft)
      .text(
        `Generated ${sanitize(data.meta.generatedAt)}  |  Care ${data.meta.schemaVersion}  |  Run ${data.meta.ukPayrollRunId.slice(0, 8)}`,
        left,
        doc.page.height - 28,
        { width: contentW, align: 'center' },
      )

    doc.end()
  })
}
