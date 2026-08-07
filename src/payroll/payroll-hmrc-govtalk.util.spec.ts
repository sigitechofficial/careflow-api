import {
  buildGovTalkSubmitEnvelope,
  redactGovTalkPassword,
  transactionEngineSubmitUrl,
} from './payroll-hmrc-govtalk.util'

describe('payroll-hmrc-govtalk.util', () => {
  it('builds a GovTalk envelope with GatewayTest=1 for TEST', () => {
    const xml = buildGovTalkSubmitEnvelope({
      messageClass: 'HMRC-PAYE-RTI-FPS',
      gatewayUserId: 'user-1',
      gatewayPassword: 'secret-pass',
      taxOfficeNumber: '123',
      taxOfficeReference: 'AB45678',
      vendorId: '9999',
      gatewayTest: '1',
      bodyXml: '<IRenvelope/>',
    })
    expect(xml).toContain('<Class>HMRC-PAYE-RTI-FPS</Class>')
    expect(xml).toContain('<GatewayTest>1</GatewayTest>')
    expect(xml).toContain('<SenderID>user-1</SenderID>')
    expect(xml).toContain('<Value>secret-pass</Value>')
    expect(xml).toContain('<Key Type="TaxOfficeNumber">123</Key>')
    expect(xml).toContain('<IRenvelope/>')
  })

  it('redacts the authentication password for storage', () => {
    const xml = buildGovTalkSubmitEnvelope({
      messageClass: 'HMRC-PAYE-RTI-FPS',
      gatewayUserId: 'user-1',
      gatewayPassword: 'secret-pass',
      taxOfficeNumber: '123',
      taxOfficeReference: 'AB45678',
      vendorId: '9999',
      gatewayTest: '1',
      bodyXml: '<Body/>',
    })
    const redacted = redactGovTalkPassword(xml)
    expect(redacted).toContain('***REDACTED***')
    expect(redacted).not.toContain('secret-pass')
  })

  it('points TEST and LIVE at the Transaction Engine URLs', () => {
    expect(transactionEngineSubmitUrl('TEST')).toContain('test-transaction-engine')
    expect(transactionEngineSubmitUrl('LIVE')).toBe(
      'https://transaction-engine.tax.service.gov.uk/submission',
    )
  })
})
