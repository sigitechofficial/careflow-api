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

describe('TR-13: reimbursements on the pay statement', () => {
  const withRunEmployee = (over: Record<string, number>) => {
    const base = baseInput()
    return buildCarePayslipData({ ...base, runEmployee: { ...base.runEmployee, ...over } })
  }

  it('mileage paid with the run is shown apart from wages, with the total payable', () => {
    const data = withRunEmployee({ expenseTotal: 3.41, reimbursementPayable: 3.41, netPay: 154 })
    expect(data.totals).toMatchObject({ netPay: 154, expenseTotal: 3.41, reimbursement: 3.41, totalPayable: 157.41 })
    // Gross taxable pay is not changed by the reimbursement.
    expect(data.totals.grossPay).toBe(840)
    expect(data.notes).toContain(
      'Mileage and expenses of GBP 3.41 are reimbursed with this payment. They are not wages and are not part of gross taxable pay; total payable is GBP 157.41.',
    )
  })

  it('a run from before reimbursements were paid through payouts keeps its old wording', () => {
    const data = withRunEmployee({ expenseTotal: 12.5 })
    expect(data.totals).toMatchObject({ reimbursement: 0, totalPayable: 739.4 })
    expect(data.notes.some((n) => n.includes('Expenses of GBP 12.50 are tracked separately'))).toBe(true)
  })

  it('says when the tax treatment of mileage has not been verified', () => {
    const data = withRunEmployee({ expenseTotal: 3.41, reimbursementPayable: 3.41, expenseNotVerified: 3.41 })
    expect(data.totals.expenseNotVerified).toBe(3.41)
    expect(data.notes).toContain(
      'The tax treatment of GBP 3.41 of mileage has not been verified against HMRC approved amounts for the period.',
    )
    expect(withRunEmployee({ expenseTotal: 3.41, reimbursementPayable: 3.41 }).notes.some((n) => n.includes('not been verified'))).toBe(false)
  })

  /**
   * Gate C19: the stored C11-C16 figures on the payslip. £3,000 salary, PAYE £390.20, NI £156.16 /
   * £387.45, Plan 2 £49, postgraduate £75, pension (relief at source) £99.20 from pay, £124.00
   * gross, £24.80 relief, £74.40 employer: net £2,205.44.
   */
  describe('student loans and workplace pension on the payslip (Gate C19)', () => {
    const stored = {
      visitPay: 0,
      salaryPay: 3000,
      travelPay: 0,
      expenseTotal: 0,
      totalGross: 3000,
      taxablePay: 1951,
      incomeTax: 390.2,
      employeeNi: 156.16,
      employerNi: 387.45,
      studentLoanPlanApplied: '2',
      studentLoanDeduction: 49,
      postgraduateLoanApplied: true,
      postgraduateLoanDeduction: 75,
      pensionApplied: true,
      pensionEmployeeNet: 99.2,
      pensionEmployeeGross: 124,
      pensionTaxRelief: 24.8,
      pensionEmployer: 74.4,
      netPay: 2230.44,
    }
    const slip = (over: Record<string, unknown> = {}) => {
      const base = baseInput()
      return buildCarePayslipData({ ...base, runEmployee: { ...base.runEmployee, ...stored, ...over } })
    }

    it('Student Loan Plan 2 and the Postgraduate Loan are separate deductions', () => {
      const data = slip()
      expect(data.deductions.map((d) => [d.label, d.amount])).toEqual([
        ['Income Tax (PAYE)', 390.2],
        ['National Insurance (employee)', 156.16],
        ['Student Loan (Plan 2)', 49],
        ['Postgraduate Loan', 75],
        ['Workplace pension (employee, relief at source)', 99.2],
      ])
      // A calculated zero is shown; no plan applied shows no line.
      expect(slip({ studentLoanDeduction: 0, netPay: 2279.44 }).deductions.find((d) => d.label === 'Student Loan (Plan 2)')?.amount).toBe(0)
      expect(slip({ studentLoanPlanApplied: 'NONE', studentLoanDeduction: 0, netPay: 2279.44 }).deductions.some((d) => d.label.startsWith('Student Loan'))).toBe(false)
      expect(data.notes.some((n) => n.includes('not calculated in Care yet'))).toBe(false)
    })

    it('relief at source: £99.20 deducted once; employer £74.40, gross £124.00 and relief £24.80 shown for information only', () => {
      const data = slip()
      expect(data.pensionInformation.map((d) => [d.label, d.amount, d.isDeduction])).toEqual([
        ['Employer pension contribution', 74.4, false],
        ['Gross employee pension contribution', 124, false],
        ['Basic-rate tax relief claimed by the pension provider', 24.8, false],
      ])
      expect(data.deductions.filter((d) => d.label.includes('pension'))).toHaveLength(1)
      expect(data.totals).toMatchObject({ grossPay: 3000, totalDeductions: 769.56, netPay: 2230.44 })
      expect(data.employerCosts.map((c) => c.label)).toEqual(['National Insurance (employer)']) // not a deduction
      expect(data.reconciliation).toEqual({ ok: true, expectedNetPay: 2230.44, storedNetPay: 2230.44 })
      // Built again from the same row: the same figures, nothing added twice.
      expect(slip()).toEqual({ ...data, meta: { ...data.meta } })
    })

    it('a row from before loans and pensions were recorded says so instead of showing zeros; a stored net pay that does not agree is flagged', () => {
      const legacy = buildCarePayslipData(baseInput()) // no C11-C16 fields: an old closed run
      expect(legacy.deductions.some((d) => /Student Loan|Postgraduate|pension/.test(d.label))).toBe(false)
      expect(legacy.pensionInformation).toEqual([])
      expect(legacy.notes).toContain(
        'Historical detail unavailable: this run was calculated before student loan, postgraduate loan, workplace pension figures were recorded. They are not shown and are not assumed to be zero.',
      )
      expect(legacy.reconciliation.ok).toBe(true) // 840 − 68.20 − 32.40 = 739.40
      const wrong = slip({ netPay: 2329.64 }) // as if the pension had not been deducted
      expect(wrong.reconciliation).toEqual({ ok: false, expectedNetPay: 2230.44, storedNetPay: 2329.64 })
    })
  })
})
