import { buildCareRtiEpsBodyXml, CARE_RTI_EPS_BODY_VERSION, epsMessageClass } from './payroll-hmrc-eps-xml.util'
import type { CareEpsPayload } from './types/eps-payload.types'

function sample(): CareEpsPayload {
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
      smpRecovered: 100,
      sppRecovered: 0,
      sapRecovered: 0,
      shppRecovered: 0,
      spbpRecovered: 0,
      nicCompensationOnStatutory: 13.8,
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

describe('payroll-hmrc-eps-xml.util', () => {
  it('maps Care EPS JSON into an IRenvelope body', () => {
    const xml = buildCareRtiEpsBodyXml(sample())
    expect(xml).toContain(`careBodyVersion="${CARE_RTI_EPS_BODY_VERSION}"`)
    expect(xml).toContain('<RelatedTaxYear>26-27</RelatedTaxYear>')
    expect(xml).toContain('<NoPaymentForPeriod>yes</NoPaymentForPeriod>')
    expect(xml).toContain('<EmpAllceInd>yes</EmpAllceInd>')
    expect(xml).toContain('<SMPRecovered>100.00</SMPRecovered>')
    expect(epsMessageClass()).toBe('HMRC-PAYE-RTI-EPS')
  })
})
