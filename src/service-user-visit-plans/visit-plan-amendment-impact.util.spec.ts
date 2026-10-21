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
    const { start: newStart, end } = resolveEndFromStartAndTimes(start, '22:00', '06:00', 'UTC')
    expect(newStart.getUTCHours()).toBe(22)
    expect(end.getTime()).toBeGreaterThan(newStart.getTime())
  })

  describe('reschedule_time uses organisation wall clock (DST-aware)', () => {
    it('London BST 2026-07-15: 08:00–09:00 local = 07:00Z–08:00Z', () => {
      const jobStart = new Date('2026-07-15T06:00:00.000Z') // 07:00 BST
      const r = resolveEndFromStartAndTimes(jobStart, '08:00', '09:00', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-07-15T07:00:00.000Z')
      expect(r.end.toISOString()).toBe('2026-07-15T08:00:00.000Z')
    })

    it('London GMT 2026-01-15: 08:00–09:00 local = 08:00Z–09:00Z', () => {
      const jobStart = new Date('2026-01-15T07:00:00.000Z')
      const r = resolveEndFromStartAndTimes(jobStart, '08:00', '09:00', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-01-15T08:00:00.000Z')
      expect(r.end.toISOString()).toBe('2026-01-15T09:00:00.000Z')
    })

    it('late-evening London visit keeps its local day: 23:30 BST on the 15th = 22:30Z', () => {
      // existing job 23:00 BST on 2026-07-15 (22:00Z)
      const jobStart = new Date('2026-07-15T22:00:00.000Z')
      const r = resolveEndFromStartAndTimes(jobStart, '23:30', '23:59', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-07-15T22:30:00.000Z')
    })

    it('job at 00:30 BST (23:30Z previous UTC day) is moved within its London day', () => {
      const jobStart = new Date('2026-07-15T23:30:00.000Z') // 00:30 BST on the 16th
      const r = resolveEndFromStartAndTimes(jobStart, '07:00', '07:30', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-07-16T06:00:00.000Z')
    })

    it('overnight across spring-forward (2026-03-28 22:00 → 03-29 06:00 BST) is 7h', () => {
      const jobStart = new Date('2026-03-28T21:00:00.000Z')
      const r = resolveEndFromStartAndTimes(jobStart, '22:00', '06:00', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-03-28T22:00:00.000Z')
      expect(r.end.toISOString()).toBe('2026-03-29T05:00:00.000Z')
    })

    it('overnight across fall-back (2026-10-24 22:00 BST → 10-25 06:00 GMT) is 9h', () => {
      const jobStart = new Date('2026-10-24T20:00:00.000Z')
      const r = resolveEndFromStartAndTimes(jobStart, '22:00', '06:00', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-10-24T21:00:00.000Z')
      expect(r.end.toISOString()).toBe('2026-10-25T06:00:00.000Z')
    })

    it('Asia/Karachi: 08:00 PKT = 03:00Z (setting honoured both ways)', () => {
      const jobStart = new Date('2026-07-15T02:00:00.000Z') // 07:00 PKT
      const r = resolveEndFromStartAndTimes(jobStart, '08:00', '09:00', 'Asia/Karachi')
      expect(r.start.toISOString()).toBe('2026-07-15T03:00:00.000Z')
      expect(r.end.toISOString()).toBe('2026-07-15T04:00:00.000Z')
    })

    it('accepts HH:MM:SS times', () => {
      const jobStart = new Date('2026-07-15T06:00:00.000Z')
      const r = resolveEndFromStartAndTimes(jobStart, '08:00:00', '09:15:00', 'Europe/London')
      expect(r.start.toISOString()).toBe('2026-07-15T07:00:00.000Z')
      expect(r.end.toISOString()).toBe('2026-07-15T08:15:00.000Z')
    })
  })
})
