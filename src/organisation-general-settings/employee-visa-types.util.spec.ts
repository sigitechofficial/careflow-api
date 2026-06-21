import {
  labelForVisaTypeId,
  parseEmployeeVisaTypes,
} from './employee-visa-types.util'
describe('labelForVisaTypeId', () => {
  const types = parseEmployeeVisaTypes(null)

  it('resolves enterprise immigration status ids', () => {
    expect(labelForVisaTypeId(types, 'british_citizen')).toBe('British citizen')
  })

  it('maps legacy ids to enterprise labels', () => {
    expect(labelForVisaTypeId(types, 'student')).toBe('Student visa')
  })

  it('returns null when unset', () => {
    expect(labelForVisaTypeId(types, null)).toBeNull()
  })
})

describe('parseEmployeeVisaTypes', () => {
  it('drops legacy catalog rows and keeps enterprise statuses', () => {
    const types = parseEmployeeVisaTypes([
      { id: 'full_time', label: 'Full time visa', weeklyHours: 40 },
      { id: 'student', label: 'Student visa', weeklyHours: 20 },
    ])
    expect(types.some((row) => row.id === 'full_time')).toBe(false)
    expect(types.some((row) => row.id === 'student')).toBe(false)
    expect(types.some((row) => row.id === 'british_citizen')).toBe(true)
  })

  it('reads maxWeeklyHours from stored catalog rows', () => {
    const types = parseEmployeeVisaTypes([
      { id: 'settled_status', label: 'Settled status / ILR', maxWeeklyHours: 40 },
    ])
    expect(types.find((row) => row.id === 'settled_status')?.label).toBe('Settled status / ILR')
  })
})
