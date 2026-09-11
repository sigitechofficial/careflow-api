import {
  ecmExceptionQueueHref,
  isUrgentOfficeAlertKind,
} from './ecm-urgent-alert.util'

describe('ecm-urgent-alert.util', () => {
  it('flags SOS, left visit area, and unable to start', () => {
    expect(isUrgentOfficeAlertKind('CARER_SOS')).toBe(true)
    expect(isUrgentOfficeAlertKind('LEFT_VISIT_AREA')).toBe(true)
    expect(isUrgentOfficeAlertKind('UNABLE_TO_START')).toBe(true)
    expect(isUrgentOfficeAlertKind('LATE_ARRIVAL')).toBe(false)
    expect(isUrgentOfficeAlertKind(null)).toBe(false)
  })

  it('builds exception-queue deep link for a visit', () => {
    expect(ecmExceptionQueueHref('job-1')).toBe(
      '/ecm/live?tab=exceptions&period=today&jobId=job-1',
    )
  })
})
