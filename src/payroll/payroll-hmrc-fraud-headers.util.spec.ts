import {
  buildWebAppViaServerFraudHeaders,
  formatHmrcUtcTimezoneFromOffsetMinutes,
  hmrcPercentEncode,
  isLikelyPublicIp,
} from './payroll-hmrc-fraud-headers.util'

describe('payroll-hmrc-fraud-headers.util', () => {
  it('percent-encodes values without touching separators', () => {
    expect(hmrcPercentEncode('Care Payroll')).toBe('Care%20Payroll')
    expect(hmrcPercentEncode('a=b')).toBe('a%3Db')
  })

  it('formats timezone from JS offset minutes', () => {
    expect(formatHmrcUtcTimezoneFromOffsetMinutes(0)).toBe('UTC+00:00')
    expect(formatHmrcUtcTimezoneFromOffsetMinutes(-60)).toBe('UTC+01:00')
    expect(formatHmrcUtcTimezoneFromOffsetMinutes(300)).toBe('UTC-05:00')
  })

  it('rejects private IPs for public header fields', () => {
    expect(isLikelyPublicIp('127.0.0.1')).toBe(false)
    expect(isLikelyPublicIp('10.0.0.1')).toBe(false)
    expect(isLikelyPublicIp('192.168.1.1')).toBe(false)
    expect(isLikelyPublicIp('198.51.100.0')).toBe(true)
  })

  it('builds WEB_APP_VIA_SERVER headers and lists omissions', () => {
    const result = buildWebAppViaServerFraudHeaders({
      client: {
        deviceId: 'beec798b-b366-47fa-b1f8-92cede14a1ce',
        browserJsUserAgent: 'Mozilla/5.0',
        timezone: 'UTC+01:00',
        screens: 'width=1920&height=1080&scaling-factor=1&colour-depth=24',
        windowSize: 'width=1256&height=803',
        publicPort: null,
        multiFactor: null,
      },
      clientPublicIp: '198.51.100.0',
      clientPublicIpTimestamp: '2026-08-07T10:00:00.000Z',
      careUserId: 'user-1',
      careUserLogin: 'ada@example.com',
      productName: 'Care Payroll',
      vendorPublicIp: '203.0.113.6',
      backendVersion: '0.0.1',
      adminVersion: '1.0.0',
    })

    expect(result.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER')
    expect(result.headers['Gov-Client-Device-ID']).toBe(
      'beec798b-b366-47fa-b1f8-92cede14a1ce',
    )
    expect(result.headers['Gov-Client-Public-IP']).toBe('198.51.100.0')
    expect(result.headers['Gov-Vendor-Product-Name']).toBe('Care%20Payroll')
    expect(result.headers['Gov-Vendor-Forwarded']).toContain('by=203.0.113.6')
    expect(result.headers['Gov-Client-User-IDs']).toContain('care-user-id=user-1')
    expect(result.omitted).toEqual(
      expect.arrayContaining(['Gov-Client-Public-Port', 'Gov-Client-Multi-Factor']),
    )
    expect(result.headers['Gov-Client-Multi-Factor']).toBeUndefined()
  })

  it('omits public IP chain when client is on a private network', () => {
    const result = buildWebAppViaServerFraudHeaders({
      client: { deviceId: 'd1', timezone: 'UTC+00:00' },
      clientPublicIp: '192.168.0.10',
      careUserId: 'u1',
      vendorPublicIp: '203.0.113.6',
      backendVersion: '0.0.1',
    })
    expect(result.headers['Gov-Client-Public-IP']).toBeUndefined()
    expect(result.omitted).toEqual(
      expect.arrayContaining([
        'Gov-Client-Public-IP',
        'Gov-Vendor-Forwarded',
      ]),
    )
  })
})
