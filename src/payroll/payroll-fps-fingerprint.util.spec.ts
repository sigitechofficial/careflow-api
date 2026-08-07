import { fingerprintCareFpsPayload } from './payroll-fps-fingerprint.util'
import type { CareFpsPayload } from './types/fps-payload.types'

function base(): CareFpsPayload {
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
      paymentDate: '2026-04-28',
      periodStart: '2026-04-06',
      periodEnd: '2026-05-05',
    },
    employees: [
      {
        employeeId: 'e1',
        name: { forename: 'Ada', surname: 'Lovelace' },
        birthDate: '1990-01-01',
        gender: 'F',
        nino: 'AB123456C',
        payId: 'PAY001',
        address: {
          line1: '1 High St',
          line2: null,
          city: 'Leeds',
          county: null,
          postcode: 'LS1 1AA',
          country: 'GB',
        },
        employment: {
          taxCode: '1257L',
          week1Month1: false,
          niCategory: 'A',
          starterDeclaration: null,
          hoursNormallyWorked: 'D',
          startingDate: '2020-01-01',
          leavingDate: null,
          isStarterInPeriod: false,
          isLeaverInPeriod: false,
          isFirstPayOfEmployment: false,
          isLastPayOfEmployment: false,
          p45Received: false,
        },
        payment: {
          taxablePay: 2000,
          taxDeductedOrRefunded: 200,
          employeeNiContribution: 100,
          employerNiContribution: 120,
          periodGross: 2000,
          periodNetPay: 1700,
          taxablePayYtd: 2000,
          totalTaxYtd: 200,
          employeeNiYtd: 100,
          employerNiYtd: 120,
          grossPayYtd: 2000,
          netPayYtd: 1700,
        },
        issues: [],
      },
    ],
    totals: {
      employeeCount: 1,
      totalGross: 2000,
      totalIncomeTax: 200,
      totalEmployeeNi: 100,
      totalEmployerNi: 120,
      totalNetPay: 1700,
    },
    warnings: [],
    validation: { isReadyToSubmit: true, errorCount: 0, warningCount: 0, items: [] },
  }
}

describe('payroll-fps-fingerprint.util', () => {
  it('is stable when only generatedAt changes', () => {
    const a = base()
    const b = base()
    b.meta.generatedAt = '2026-08-07T11:00:00.000Z'
    expect(fingerprintCareFpsPayload(a)).toBe(fingerprintCareFpsPayload(b))
  })

  it('changes when money figures change', () => {
    const a = base()
    const b = base()
    b.employees[0].payment.taxablePay = 2100
    expect(fingerprintCareFpsPayload(a)).not.toBe(fingerprintCareFpsPayload(b))
  })
})
