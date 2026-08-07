import {
  isPayrollHoursNormallyWorked,
  mapContractedHoursToBand,
} from './payroll-hours-normally-worked.util'

describe('payroll-hours-normally-worked.util', () => {
  it('accepts A–E codes only', () => {
    expect(isPayrollHoursNormallyWorked('A')).toBe(true)
    expect(isPayrollHoursNormallyWorked('E')).toBe(true)
    expect(isPayrollHoursNormallyWorked('F')).toBe(false)
    expect(isPayrollHoursNormallyWorked(null)).toBe(false)
  })

  it('maps contracted hours to A–D (not E)', () => {
    expect(mapContractedHoursToBand(10)).toBe('A')
    expect(mapContractedHoursToBand(20)).toBe('B')
    expect(mapContractedHoursToBand(26)).toBe('C')
    expect(mapContractedHoursToBand(35)).toBe('D')
    expect(mapContractedHoursToBand(null)).toBeNull()
  })
})
