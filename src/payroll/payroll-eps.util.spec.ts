import {
  buildCareEpsPayload,
  epsElectronicDeadline,
  ukTaxMonthBounds,
  validateCareEpsPayload,
} from './payroll-eps.util'

describe('payroll-eps.util', () => {
  it('computes UK tax month bounds and EPS deadline', () => {
    expect(ukTaxMonthBounds(2026, 1)).toEqual({
      start: '2026-04-06',
      end: '2026-05-05',
    })
    expect(ukTaxMonthBounds(2026, 12)).toEqual({
      start: '2027-03-06',
      end: '2027-04-05',
    })
    expect(epsElectronicDeadline(2026, 1)).toBe('2026-05-19')
    expect(epsElectronicDeadline(2026, 12)).toBe('2027-04-19')
  })

  it('builds a nil-payment EPS preview with Employment Allowance', () => {
    const payload = buildCareEpsPayload({
      taxYearCode: '2026-27',
      taxMonth: 1,
      employer: {
        hmrcOfficeNumber: '123',
        employerPayeReference: 'AB45678',
        accountsOfficeReference: '123PA00012345',
        employerTradingName: 'Care Ltd',
        fullPayeReference: '123/AB45678',
        isComplete: true,
        employmentAllowanceClaimed: true,
      },
      noPaymentThisPeriod: true,
      recoveries: { smpRecovered: 100 },
      context: { closedRunsInTaxMonth: 0, employeesPaidInTaxMonth: 0 },
      todayIso: '2026-05-15',
    })

    expect(payload.meta.schemaVersion).toBe('care-eps-preview-1')
    expect(payload.period.relatedTaxYear).toBe('26-27')
    expect(payload.period.electronicDeadline).toBe('2026-05-19')
    expect(payload.period.deadlineStatus).toBe('DUE_SOON')
    expect(payload.indicators.noPaymentThisPeriod).toBe(true)
    expect(payload.indicators.employmentAllowanceClaimed).toBe(true)
    expect(payload.recoveries.smpRecovered).toBe(100)
    expect(payload.validation.isReadyToSubmit).toBe(true)
  })

  it('flags incomplete employer on validation', () => {
    const payload = buildCareEpsPayload({
      taxYearCode: '2026-27',
      taxMonth: 2,
      employer: {
        hmrcOfficeNumber: null,
        employerPayeReference: null,
        accountsOfficeReference: null,
        employerTradingName: null,
        fullPayeReference: null,
        isComplete: false,
      },
      todayIso: '2026-05-20',
    })
    const v = validateCareEpsPayload(payload)
    expect(v.isReadyToSubmit).toBe(false)
    expect(v.items.some((i) => i.code === 'EMPLOYER_OFFICE_NUMBER')).toBe(true)
  })
})
