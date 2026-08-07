import { buildCareFpsPayload, mapHoursNormallyWorked } from './payroll-fps.util'

describe('payroll-fps.util', () => {
  it('maps contracted hours to FPS bands', () => {
    expect(mapHoursNormallyWorked(10)).toBe('A')
    expect(mapHoursNormallyWorked(20)).toBe('B')
    expect(mapHoursNormallyWorked(26)).toBe('C')
    expect(mapHoursNormallyWorked(35)).toBe('D')
    expect(mapHoursNormallyWorked(null)).toBeNull()
  })

  it('builds a preview FPS payload with warnings when employer incomplete', () => {
    const payload = buildCareFpsPayload({
      run: {
        id: 'run-1',
        status: 'CLOSED',
        totalGross: 3000,
        totalIncomeTax: 390.5,
        totalEmployeeNi: 156.16,
        totalEmployerNi: 387.45,
        totalNetPay: 2453.34,
        taxYearCode: '2026-27',
        periodSequence: 1,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        paymentDate: '2026-04-30',
        payFrequency: 'MONTHLY',
      },
      employer: {
        hmrcOfficeNumber: null,
        employerPayeReference: null,
        accountsOfficeReference: null,
        employerTradingName: null,
        fullPayeReference: null,
        isComplete: false,
      },
      identities: [
        {
          employeeId: 'emp-1',
          firstName: 'Jane',
          lastName: 'Carer',
          dateOfBirth: '1990-01-15',
          genderName: 'Female',
          addressLine1: '1 High Street',
          addressLine2: null,
          town: 'Leeds',
          county: null,
          country: 'United Kingdom',
          postcode: 'LS1 1AA',
          nationalInsuranceNo: 'AB123456C',
          payrollNumber: 'PAY-001',
          startDate: '2026-04-01',
          endDate: null,
          contractedWeeklyHours: 20,
        },
      ],
      employees: [
        {
          employeeId: 'emp-1',
          totalGross: 3000,
          taxablePay: 1952.5,
          incomeTax: 390.5,
          employeeNi: 156.16,
          employerNi: 387.45,
          netPay: 2453.34,
          taxCodeApplied: '1257L',
          niCategoryApplied: 'A',
          week1Month1: false,
          starterDeclaration: 'B_ONLY_JOB_THIS_YEAR',
          ytd: {
            grossPayYtd: 3000,
            taxablePayYtd: 1952.5,
            incomeTaxYtd: 390.5,
            employeeNiYtd: 156.16,
            employerNiYtd: 387.45,
            netPayYtd: 2453.34,
          },
        },
      ],
    })

    expect(payload.meta.schemaVersion).toBe('care-fps-preview-1')
    expect(payload.meta.purpose).toBe('PREVIEW')
    expect(payload.submission.relatedTaxYear).toBe('26-27')
    expect(payload.employees).toHaveLength(1)
    expect(payload.employees[0].gender).toBe('F')
    expect(payload.employees[0].employment.hoursNormallyWorked).toBe('B')
    expect(payload.employees[0].employment.isStarterInPeriod).toBe(true)
    expect(payload.employees[0].employment.isFirstPayOfEmployment).toBe(true)
    expect(payload.employees[0].payment.totalTaxYtd).toBe(390.5)
    expect(payload.warnings.some((w) => /Employer PAYE/i.test(w))).toBe(true)
    expect(payload.validation).toBeDefined()
    expect(payload.validation.isReadyToSubmit).toBe(false)
    expect(payload.validation.errorCount).toBeGreaterThan(0)
  })
})
