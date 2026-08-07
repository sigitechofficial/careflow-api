import {
  hmrcSubmissionGatewayUpdateData,
  responseBodySha256,
  sha256Hex,
} from './payroll-hmrc-submission-audit.util'

describe('payroll-hmrc-submission-audit.util', () => {
  it('hashes UTF-8 content stably', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
    expect(responseBodySha256(null)).toBeNull()
    expect(responseBodySha256('<Ack/>')).toBe(sha256Hex('<Ack/>'))
  })

  it('gateway update data omits payload fields', () => {
    const data = hmrcSubmissionGatewayUpdateData({
      status: 'ACCEPTED',
      correlationId: 'CORR1',
      responseXml: '<ok/>',
      httpStatus: 200,
      qualifier: 'response',
      functionCode: 'submit',
      errorCode: null,
      errorMessage: null,
      acknowledgement: { ok: true },
      approvedById: 'user-1',
      approvedAt: new Date('2026-04-01T00:00:00.000Z'),
    })
    expect(data).not.toHaveProperty('requestXmlRedacted')
    expect(data).not.toHaveProperty('payloadFingerprint')
    expect(data).not.toHaveProperty('mode')
    expect(data).not.toHaveProperty('createdById')
    expect(data.status).toBe('ACCEPTED')
    expect(data.correlationId).toBe('CORR1')
    expect(data.approvedById).toBe('user-1')
  })
})
