import { diffVisitPlanSnapshots, resolveEndFromStartAndTimes } from './visit-plan-amendment-impact.util'

describe('visit-plan-amendment-impact.util', () => {
  const baseSlot = {
    id: 'slot-1',
    slotCode: 'MORNING',
    label: 'Morning',
    daysOfWeek: [1, 2, 3, 4, 5],
    plannedStartTime: '08:00',
    plannedEndTime: '09:00',
    isEnabled: true,
    exceptions: [],
  }

  it('detects disabled slot', () => {
    const actions = diffVisitPlanSnapshots(
      { slots: [baseSlot] },
      { slots: [{ ...baseSlot, isEnabled: false }] },
    )
    expect(actions.some((a) => a.type === 'cancel_slot_disabled')).toBe(true)
  })

  it('detects removed weekdays', () => {
    const actions = diffVisitPlanSnapshots(
      { slots: [baseSlot] },
      { slots: [{ ...baseSlot, daysOfWeek: [1, 3, 5] }] },
    )
    const weekday = actions.find((a) => a.type === 'cancel_weekdays_removed')
    expect(weekday?.removedWeekdays).toEqual([2, 4])
  })

  it('resolves overnight end time', () => {
    const start = new Date('2026-07-08T12:00:00.000Z')
    const { start: newStart, end } = resolveEndFromStartAndTimes(start, '22:00', '06:00')
    expect(newStart.getUTCHours()).toBe(22)
    expect(end.getTime()).toBeGreaterThan(newStart.getTime())
  })
})
