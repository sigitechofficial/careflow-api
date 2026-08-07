import { fingerprintCareEpsPayload } from './payroll-eps-fingerprint.util'
import type { CareEpsPayload } from './types/eps-payload.types'

function base(): CareEpsPayload {
  return {
    meta: {
      schemaVersion: 'care-eps-preview-1',
      generatedAt: '2026-08-07T10:00:00.000Z',
      purpose: 'PREVIEW',
    },
    employer: {
      hmrcOfficeNumber: '123',
      employerPayeReference: 'AB45678',
      fullPayeReference: '123/AB45678',
      accountsOfficeReference: '123PA00012345',
      employerTradingName: 'Care Ltd',
    },
    period: {
      taxYearCode: '2026-27',
      relatedTaxYear: '26-27',
      taxMonth: 1,
      taxMonthStart: '2026-04-06',
      taxMonthEnd: '2026-05-05',
      electronicDeadline: '2026-05-19',
      daysUntilDeadline: 10,
      deadlineStatus: 'OK',
    },
    indicators: {
      noPaymentThisPeriod: true,
      employmentAllowanceClaimed: true,
    },
    recoveries: {
      smpRecovered: 0,
      sppRecovered: 0,
      sapRecovered: 0,
      shppRecovered: 0,
      spbpRecovered: 0,
      nicCompensationOnStatutory: 0,
    },
    context: {
      closedRunsInTaxMonth: 0,
      employeesPaidInTaxMonth: 0,
      suggestedNilPayment: true,
    },
    warnings: [],
    validation: { isReadyToSubmit: true, errorCount: 0, warningCount: 0, items: [] },
  }
}

describe('payroll-eps-fingerprint.util', () => {
  it('is stable when only generatedAt changes', () => {
    const a = base()
    const b = base()
    b.meta.generatedAt = '2026-08-07T12:00:00.000Z'
    expect(fingerprintCareEpsPayload(a)).toBe(fingerprintCareEpsPayload(b))
  })

  it('changes when Employment Allowance flag changes', () => {
    const a = base()
    const b = base()
    b.indicators.employmentAllowanceClaimed = false
    expect(fingerprintCareEpsPayload(a)).not.toBe(fingerprintCareEpsPayload(b))
  })
})
