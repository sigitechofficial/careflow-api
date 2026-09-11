import { fcmReport } from './fcm-send-report'

describe('fcmReport', () => {
  it('builds a FIREBASE_NOT_READY report', () => {
    expect(
      fcmReport({ ready: false, tokens: 1, skipped: 1, reason: 'FIREBASE_NOT_READY' }),
    ).toEqual({
      ready: false,
      tokens: 1,
      sent: 0,
      skipped: 1,
      reason: 'FIREBASE_NOT_READY',
    })
  })
})
