import { groupRotaGeneratedCarerPushes } from './visit-plan-rota-carer-push.util'

describe('groupRotaGeneratedCarerPushes', () => {
  const base = {
    scheduledJobId: 'job-1',
    jobName: 'Morning — Harry',
    serviceUserId: 'su-1',
    scheduledStartDateTime: new Date('2026-09-11T08:00:00.000Z'),
    scheduledEndDateTime: new Date('2026-09-11T09:00:00.000Z'),
  }

  it('sends one assign message when a carer gets a single visit', () => {
    expect(
      groupRotaGeneratedCarerPushes([{ ...base, employeeId: 'carer-1' }], 'Asia/Karachi'),
    ).toEqual([
      {
        employeeId: 'carer-1',
        scheduledJobId: 'job-1',
        serviceUserId: 'su-1',
        title: 'New visit assigned',
        body: 'You have been allocated to "Morning — Harry" (13:00–14:00).',
      },
    ])
  })

  it('sends one digest per carer when many visits are generated', () => {
    const pushes = groupRotaGeneratedCarerPushes([
      { ...base, employeeId: 'carer-1', scheduledJobId: 'job-2', jobName: 'Afternoon — Harry', scheduledStartDateTime: new Date('2026-09-11T14:00:00.000Z') },
      { ...base, employeeId: 'carer-1' },
      { ...base, employeeId: 'carer-2', scheduledJobId: 'job-3' },
    ], 'Asia/Karachi')
    expect(pushes).toEqual([
      {
        employeeId: 'carer-1',
        scheduledJobId: 'job-1',
        serviceUserId: 'su-1',
        title: 'New visits on your rota',
        body: '2 visits have been assigned, starting with "Morning — Harry".',
      },
      {
        employeeId: 'carer-2',
        scheduledJobId: 'job-3',
        serviceUserId: 'su-1',
        title: 'New visit assigned',
        body: 'You have been allocated to "Morning — Harry" (13:00–14:00).',
      },
    ])
  })

  it('formats visit times in the organisation timezone (Europe/London BST)', () => {
    const [push] = groupRotaGeneratedCarerPushes([{ ...base, employeeId: 'carer-1' }], 'Europe/London')
    expect(push.body).toBe('You have been allocated to "Morning — Harry" (09:00–10:00).')
  })
})
