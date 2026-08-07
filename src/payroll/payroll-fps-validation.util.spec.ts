import {
  isValidUkNino,
  isValidUkPostcode,
  validateCareFpsPayload,
} from './payroll-fps-validation.util'
import type { CareFpsPayload } from './types/fps-payload.types'

function basePayload(over: Partial<CareFpsPayload> = {}): CareFpsPayload {
  return {
    meta: {
      schemaVersion: 'care-fps-preview-1',
      generatedAt: '2026-08-07T10:00:00.000Z',
      ukPayrollRunId: 'run-1',
      runStatus: 'CLOSED',
      taxYearCode: '2026-27',
      purpose: 'PREVIEW',
    },
    employer: {
      hmrcOfficeNumber: '123',
      employerPayeReference: 'AB45678',
      fullPayeReference: '123/AB45678',
      accountsOfficeReference: '123PA00012345',
      employerTradingName: 'Care Ltd',
    },
    submission: {
      relatedTaxYear: '26-27',
      taxMonthOrWeekNumber: 1,
      payFrequency: 'MONTHLY',
      paymentDate: '2026-04-30',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
    },
    employees: [
      {
        employeeId: 'emp-1',
        name: { forename: 'Jane', surname: 'Carer' },
        birthDate: '1990-01-15',
        gender: 'F',
        nino: 'AB123456C',
        payId: 'PAY-001',
        address: {
          line1: '1 High Street',
          line2: null,
          city: 'Leeds',
          county: null,
          postcode: 'LS1 1AA',
          country: 'United Kingdom',
        },
        employment: {
          taxCode: '1257L',
          week1Month1: false,
          niCategory: 'A',
          starterDeclaration: 'B_ONLY_JOB_THIS_YEAR',
          hoursNormallyWorked: 'B',
          startingDate: '2026-04-01',
          leavingDate: null,
          isStarterInPeriod: true,
          isLeaverInPeriod: false,
          isFirstPayOfEmployment: true,
          isLastPayOfEmployment: false,
          p45Received: false,
        },
        payment: {
          taxablePay: 1952.5,
          taxDeductedOrRefunded: 390.5,
          employeeNiContribution: 156.16,
          employerNiContribution: 387.45,
          periodGross: 3000,
          periodNetPay: 2453.34,
          taxablePayYtd: 1952.5,
          totalTaxYtd: 390.5,
          employeeNiYtd: 156.16,
          employerNiYtd: 387.45,
          grossPayYtd: 3000,
          netPayYtd: 2453.34,
        },
        issues: [],
      },
    ],
    totals: {
      employeeCount: 1,
      totalGross: 3000,
      totalIncomeTax: 390.5,
      totalEmployeeNi: 156.16,
      totalEmployerNi: 387.45,
      totalNetPay: 2453.34,
    },
    warnings: [],
    ...over,
  }
}

describe('payroll-fps-validation.util', () => {
  it('accepts a well-formed NINO and postcode', () => {
    expect(isValidUkNino('AB 12 34 56 C')).toBe(true)
    expect(isValidUkNino('QQ123456C')).toBe(false)
    expect(isValidUkNino('bad')).toBe(false)
    expect(isValidUkPostcode('LS1 1AA')).toBe(true)
    expect(isValidUkPostcode('12')).toBe(false)
  })

  it('marks a complete payload ready to submit', () => {
    const result = validateCareFpsPayload(basePayload(), { gatewayCredentialsReady: true })
    expect(result.errorCount).toBe(0)
    expect(result.isReadyToSubmit).toBe(true)
  })

  it('returns blocking employer and employee errors in plain English', () => {
    const payload = basePayload({
      employer: {
        hmrcOfficeNumber: '',
        employerPayeReference: '',
        fullPayeReference: '',
        accountsOfficeReference: '',
        employerTradingName: null,
      },
      employees: [
        {
          ...basePayload().employees[0],
          name: { forename: '', surname: '' },
          nino: 'XX',
          gender: null,
          employment: {
            ...basePayload().employees[0].employment,
            taxCode: null,
            hoursNormallyWorked: null,
          },
        },
      ],
    })
    const result = validateCareFpsPayload(payload, { gatewayCredentialsReady: false })
    expect(result.isReadyToSubmit).toBe(false)
    expect(result.errorCount).toBeGreaterThan(0)
    expect(result.items.some((i) => i.code === 'EMPLOYER_OFFICE_NUMBER')).toBe(true)
    expect(result.items.some((i) => i.code === 'EMP_NINO_FORMAT')).toBe(true)
    expect(result.items.some((i) => i.code === 'EMP_HOURS_BAND' && i.severity === 'warning')).toBe(
      true,
    )
    expect(result.items.some((i) => i.code === 'GATEWAY_NOT_READY' && i.severity === 'error')).toBe(
      true,
    )
  })
})
