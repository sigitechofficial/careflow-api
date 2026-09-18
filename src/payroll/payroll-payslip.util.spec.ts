import {
  buildCarePayslipData,
  buildPayslipPeriodCaption,
  hoursFromPaidMinutes,
  payFrequencyLabel,
  payslipPdfFilename,
} from './payroll-payslip.util'

function baseInput(overrides?: Partial<Parameters<typeof buildCarePayslipData>[0]>) {
  return {
    generatedAt: '2026-09-16T10:00:00.000Z',
    run: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'CLOSED' },
    runEmployee: {
      id: '11111111-2222-3333-4444-555555555555',
      employeeId: 'emp-1',
      visitPay: 800,
      salaryPay: 0,
      travelPay: 40,
      nmwTopUp: 0,
      otherPay: 0,
      expenseTotal: 12.5,
      deductionTotal: 0,
      totalGross: 840,
      taxablePay: 840,
      incomeTax: 68.2,
      employeeNi: 32.4,
      employerNi: 95.1,
      netPay: 739.4,
      taxCodeApplied: '1257L',
      niCategoryApplied: 'A',
    },
    employee: {
      displayName: 'Jane Carer',
      payrollNumber: 'PAY-001',
      nationalInsuranceNo: 'QQ123456C',
    },
    employer: {
      employerTradingName: 'Careflow Homecare Ltd',
      fullPayeReference: '123/AB45678',
      accountsOfficeReference: '123PA00012345',
    },
    period: {
      taxYearCode: '2026-27',
      taxYearLabel: '2026 to 2027',
      scheduleName: 'Monthly carers',
      frequency: 'MONTHLY',
      periodLabel: 'April 2026',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      paymentDate: '2026-04-30',
    },
    paidMinutes: 2400,
    ytd: {
      grossPayYtd: 840,
      taxablePayYtd: 840,
      incomeTaxYtd: 68.2,
      employeeNiYtd: 32.4,
      employerNiYtd: 95.1,
      netPayYtd: 739.4,
    },
    ...overrides,
  }
}

describe('payroll-payslip.util', () => {
  it('labels pay frequency clearly', () => {
    expect(payFrequencyLabel('MONTHLY')).toBe('Monthly')
    expect(payFrequencyLabel('WEEKLY')).toBe('Weekly')
  })

  it('builds month and week captions with date ranges', () => {
    expect(
      buildPayslipPeriodCaption({
        frequency: 'MONTHLY',
        periodLabel: 'April 2026',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
      }),
    ).toBe('Monthly - April 2026 (01/04/2026 - 30/04/2026)')

    expect(
      buildPayslipPeriodCaption({
        frequency: 'WEEKLY',
        periodLabel: 'P3 2026-04-20 – 2026-04-26',
        periodStart: '2026-04-20',
        periodEnd: '2026-04-26',
      }),
    ).toBe('Weekly - Period 3 (20/04/2026 - 26/04/2026)')
  })

  it('converts paid minutes to hours', () => {
    expect(hoursFromPaidMinutes(90)).toBe(1.5)
    expect(hoursFromPaidMinutes(0)).toBe(0)
  })

  it('builds ERA essentials including period caption', () => {
    const slip = buildCarePayslipData(baseInput())
    expect(slip.period.periodCaption).toContain('Monthly - April 2026')
    expect(slip.period.frequencyLabel).toBe('Monthly')
    expect(slip.totals.grossPay).toBe(840)
    expect(slip.hoursWorked.totalHours).toBe(40)
    expect(slip.payment.bankStatus).toBe('CALCULATED')
    expect(slip.payment.bankStatusLabel).toBe('Calculated — not yet paid')
  })

  it('labels bank payment as paid when payout line is paid', () => {
    const slip = buildCarePayslipData(
      baseInput({
        bankPayment: {
          lineStatus: 'PAID',
          batchStatus: 'PAID',
          paidAt: '2026-04-30T12:00:00.000Z',
        },
      }),
    )
    expect(slip.payment.bankStatus).toBe('PAID')
    expect(slip.payment.bankStatusLabel).toContain('Paid')
    expect(slip.payment.paidAt).toBe('2026-04-30T12:00:00.000Z')
  })

  it('labels approved payout as awaiting bank payment', () => {
    const slip = buildCarePayslipData(
      baseInput({
        bankPayment: {
          lineStatus: 'PENDING',
          batchStatus: 'APPROVED',
          paidAt: null,
        },
      }),
    )
    expect(slip.payment.bankStatus).toBe('APPROVED')
    expect(slip.payment.bankStatusLabel).toBe('Approved — awaiting bank payment')
  })

  it('rejects non-closed runs', () => {
    expect(() =>
      buildCarePayslipData(baseInput({ run: { id: 'run-1', status: 'DRAFT' } })),
    ).toThrow(/CLOSED/)
  })

  it('builds a stable PDF filename', () => {
    const slip = buildCarePayslipData(baseInput())
    expect(payslipPdfFilename(slip)).toBe('payslip-jane-carer-20260430-11111111.pdf')
  })
})
