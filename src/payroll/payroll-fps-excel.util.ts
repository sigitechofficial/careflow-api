import ExcelJS from 'exceljs'
import type { CareFpsPayload } from './types/fps-payload.types'

function money(n: number): number {
  return Math.round(n * 100) / 100
}

export async function buildFpsPreviewExcelBuffer(payload: CareFpsPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Care Payroll'
  wb.created = new Date()

  const summary = wb.addWorksheet('Summary')
  summary.columns = [{ width: 28 }, { width: 48 }]
  const addMeta = (label: string, value: string | number | null | undefined) => {
    summary.addRow([label, value ?? ''])
  }
  summary.addRow(['Care FPS preview (human-readable)', ''])
  summary.addRow([])
  addMeta('Run ID', payload.meta.ukPayrollRunId)
  addMeta('Generated', payload.meta.generatedAt)
  addMeta('Tax year', payload.meta.taxYearCode)
  addMeta('Employer PAYE', payload.employer.fullPayeReference)
  addMeta('Accounts Office', payload.employer.accountsOfficeReference)
  addMeta('Employer name', payload.employer.employerTradingName)
  addMeta('Related tax year (RTI)', payload.submission.relatedTaxYear)
  addMeta('Tax month / week', payload.submission.taxMonthOrWeekNumber)
  addMeta('Pay frequency', payload.submission.payFrequency)
  addMeta('Payment date', payload.submission.paymentDate)
  addMeta('Period start', payload.submission.periodStart)
  addMeta('Period end', payload.submission.periodEnd)
  summary.addRow([])
  addMeta('Employees', payload.totals.employeeCount)
  addMeta('Total gross', money(payload.totals.totalGross))
  addMeta('Total PAYE', money(payload.totals.totalIncomeTax))
  addMeta('Total employee NI', money(payload.totals.totalEmployeeNi))
  addMeta('Total employer NI', money(payload.totals.totalEmployerNi))
  addMeta('Total net pay', money(payload.totals.totalNetPay))
  addMeta('Ready to submit', payload.validation.isReadyToSubmit ? 'Yes' : 'No')

  const employees = wb.addWorksheet('Employees')
  employees.columns = [
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 8 },
    { width: 10 },
    { width: 8 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 36 },
  ]
  const header = employees.addRow([
    'Payroll ID',
    'Forename',
    'Surname',
    'NINO',
    'Date of birth',
    'Gender',
    'Tax code',
    'NI cat',
    'Hours band',
    'Period gross',
    'Tax this period',
    'Employee NI',
    'Employer NI',
    'Net pay',
    'Taxable YTD',
    'Tax YTD',
    'Gross YTD',
    'Starter?',
    'Issues',
  ])
  header.font = { bold: true }
  for (const e of payload.employees) {
    employees.addRow([
      e.payId ?? '',
      e.name.forename,
      e.name.surname,
      e.nino ?? '',
      e.birthDate ?? '',
      e.gender ?? '',
      e.employment.taxCode ?? '',
      e.employment.niCategory ?? '',
      e.employment.hoursNormallyWorked ?? '',
      money(e.payment.periodGross),
      money(e.payment.taxDeductedOrRefunded),
      money(e.payment.employeeNiContribution),
      money(e.payment.employerNiContribution),
      money(e.payment.periodNetPay),
      money(e.payment.taxablePayYtd),
      money(e.payment.totalTaxYtd),
      money(e.payment.grossPayYtd),
      e.employment.isStarterInPeriod ? 'Yes' : 'No',
      e.issues.join('; '),
    ])
  }

  if (payload.validation.items.length > 0) {
    const checks = wb.addWorksheet('Validation')
    checks.columns = [{ width: 12 }, { width: 14 }, { width: 22 }, { width: 60 }]
    const h = checks.addRow(['Severity', 'Scope', 'Employee', 'Message'])
    h.font = { bold: true }
    for (const item of payload.validation.items) {
      checks.addRow([
        item.severity,
        item.scope,
        item.employeeName ?? '',
        item.message,
      ])
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
