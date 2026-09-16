import {
  buildTimeSensitiveFlag,
  classifyTimeSensitiveTiming,
  medicineIsTimeSensitive,
  timeSensitiveChipLabel,
  timeSensitiveHoverLine,
  worstTimeSensitiveStatus,
} from './time-sensitive-visit.util'

describe('time-sensitive-visit.util', () => {
  const due = new Date('2026-09-15T08:00:00.000Z')

  it('classifies early, on-time, delayed, overdue, and missed', () => {
    expect(
      classifyTimeSensitiveTiming({
        due,
        given: new Date('2026-09-15T07:40:00.000Z'),
        toleranceMinutes: 15,
        now: due,
        visitEnded: false,
      }),
    ).toBe('early')
    expect(
      classifyTimeSensitiveTiming({
        due,
        given: new Date('2026-09-15T08:10:00.000Z'),
        toleranceMinutes: 15,
        now: due,
        visitEnded: false,
      }),
    ).toBe('due')
    expect(
      classifyTimeSensitiveTiming({
        due,
        given: new Date('2026-09-15T08:20:00.000Z'),
        toleranceMinutes: 15,
        now: due,
        visitEnded: false,
      }),
    ).toBe('delayed')
    expect(
      classifyTimeSensitiveTiming({
        due,
        given: null,
        toleranceMinutes: 15,
        now: new Date('2026-09-15T08:20:00.000Z'),
        visitEnded: false,
        visitStarted: true,
      }),
    ).toBe('delayed')
    expect(
      classifyTimeSensitiveTiming({
        due,
        given: null,
        toleranceMinutes: 15,
        now: new Date('2026-09-15T08:20:00.000Z'),
        visitEnded: false,
        visitStarted: false,
      }),
    ).toBe('due')
    expect(
      classifyTimeSensitiveTiming({
        due,
        given: null,
        toleranceMinutes: 15,
        now: due,
        visitEnded: true,
      }),
    ).toBe('missed')
  })

  it('uses official chip wording', () => {
    expect(timeSensitiveChipLabel('MEDICINE', 'early')).toBe('Medicine early')
    expect(timeSensitiveChipLabel('MEDICINE', 'delayed')).toBe('Medicine delayed')
    expect(timeSensitiveChipLabel('MEDICINE', 'missed')).toBe('Medicine missed')
    expect(timeSensitiveChipLabel('TASK', 'delayed')).toBe('Task delayed')
  })

  it('builds hover copy with due and given times', () => {
    expect(
      timeSensitiveHoverLine({
        kind: 'MEDICINE',
        name: 'Insulin',
        dueTime: '08:00',
        givenTime: '08:40',
        toleranceMinutes: 15,
        status: 'delayed',
      }),
    ).toBe('Time-sensitive medicine delayed · Insulin · due 08:00 · given 08:40')
  })

  it('dedupes chips and picks the worst clock', () => {
    const flag = buildTimeSensitiveFlag([
      {
        kind: 'MEDICINE',
        name: 'Insulin',
        dueTime: '08:00',
        givenTime: '08:40',
        toleranceMinutes: 15,
        status: 'delayed',
      },
      {
        kind: 'MEDICINE',
        name: 'Levodopa',
        dueTime: '08:00',
        givenTime: '08:50',
        toleranceMinutes: 15,
        status: 'delayed',
      },
      {
        kind: 'TASK',
        name: 'Blood glucose',
        dueTime: '08:00',
        givenTime: null,
        toleranceMinutes: 15,
        status: 'missed',
      },
    ])
    expect(flag.clock).toBe('missed')
    expect(flag.chips.map((chip) => chip.label)).toEqual(['Medicine delayed', 'Task missed'])
    expect(worstTimeSensitiveStatus(['early', 'delayed'])).toBe('delayed')
  })

  it('treats pack adminRules as time-sensitive', () => {
    expect(medicineIsTimeSensitive({ timeCritical: false, adminRules: { timeCritical: true } })).toBe(
      true,
    )
    expect(medicineIsTimeSensitive({ timeCritical: true, adminRules: null })).toBe(true)
    expect(medicineIsTimeSensitive({ timeCritical: false, adminRules: {} })).toBe(false)
  })
})
