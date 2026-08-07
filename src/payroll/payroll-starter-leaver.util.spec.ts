import {
  deriveStarterLeaverIndicators,
  isoDateInInclusiveRange,
  starterLeaverFpsIssues,
} from './payroll-starter-leaver.util'

describe('payroll-starter-leaver.util', () => {
  it('detects dates inside the pay period', () => {
    expect(isoDateInInclusiveRange('2026-04-15', '2026-04-01', '2026-04-30')).toBe(true)
    expect(isoDateInInclusiveRange('2026-05-01', '2026-04-01', '2026-04-30')).toBe(false)
    expect(isoDateInInclusiveRange(null, '2026-04-01', '2026-04-30')).toBe(false)
  })

  it('marks first and last pay when start/leave fall in the period', () => {
    const indicators = deriveStarterLeaverIndicators({
      startDate: '2026-04-06',
      endDate: '2026-04-28',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      p45Received: false,
    })
    expect(indicators.isStarterInPeriod).toBe(true)
    expect(indicators.isLeaverInPeriod).toBe(true)
    expect(indicators.isFirstPayOfEmployment).toBe(true)
    expect(indicators.isLastPayOfEmployment).toBe(true)
  })

  it('warns when first pay has UNKNOWN starter declaration and no P45', () => {
    const indicators = deriveStarterLeaverIndicators({
      startDate: '2026-04-10',
      endDate: null,
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
    })
    const issues = starterLeaverFpsIssues({
      displayName: 'Jane Carer',
      starterDeclaration: 'UNKNOWN',
      indicators,
    })
    expect(issues.some((i) => /starter declaration/i.test(i))).toBe(true)
  })
})
