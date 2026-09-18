import {
  buildPayslipPdf,
  formatUkNinoDisplay,
  formatUkPayslipDate,
  sanitizePayslipPdfText,
} from './payroll-payslip-pdf.util'
import { buildCarePayslipData } from './payroll-payslip.util'

describe('payroll-payslip-pdf.util', () => {
  it('formats UK dates and NI numbers', () => {
    expect(formatUkPayslipDate('2026-04-30')).toBe('30/04/2026')
    expect(formatUkNinoDisplay('AB123456C')).toBe('AB 12 34 56 C')
  })

  it('keeps the pound sign instead of turning it into ?', () => {
    expect(sanitizePayslipPdfText('\u00A31,234.56')).toBe('\u00A31,234.56')
    expect(sanitizePayslipPdfText('Monthly \u2013 April')).toBe('Monthly - April')
  })

  it('money amounts are not ASCII-sanitized (Payments box bug)', async () => {
    const data = buildCarePayslipData({
      generatedAt: '2026-09-16T10:00:00.000Z',
      run: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'CLOSED' },
      runEmployee: {
        id: '11111111-2222-3333-4444-555555555555',
        employeeId: 'emp-1',
        visitPay: 108,
        salaryPay: 0,
        travelPay: 0,
        nmwTopUp: 0,
        otherPay: 0,
        expenseTotal: 0,
        deductionTotal: 0,
        totalGross: 108,
        taxablePay: 108,
        incomeTax: 0,
        employeeNi: 0,
        employerNi: 0,
        netPay: 108,
        taxCodeApplied: '1257L',
        niCategoryApplied: 'A',
      },
      employee: {
        displayName: 'Emma Richardson',
        payrollNumber: '23423243',
        nationalInsuranceNo: 'AB123459D',
      },
      employer: {
        employerTradingName: 'Care Service Ltd',
        fullPayeReference: '234/ASDF-23423',
        accountsOfficeReference: null,
      },
      period: {
        taxYearCode: '2026-27',
        taxYearLabel: 'Tax year 2026-27',
        scheduleName: '2026-2027',
        frequency: 'MONTHLY',
        periodLabel: 'Sep 2026',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        paymentDate: '2026-09-30',
      },
      paidMinutes: 360,
      ytd: {
        grossPayYtd: 1117.02,
        taxablePayYtd: 1117.02,
        incomeTaxYtd: 0,
        employeeNiYtd: 0,
        employerNiYtd: 0,
        netPayYtd: 1117.02,
      },
    })
    const pdf = await buildPayslipPdf(data)
    const asLatin1 = pdf.toString('latin1')
    // Must not contain the broken "?108.00" pattern from sanitized pound
    expect(asLatin1.includes('?108.00')).toBe(false)
    expect(pdf.includes(Buffer.from([0xa3]))).toBe(true)
  })
})
