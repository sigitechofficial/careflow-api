import { parseGovTalkAcknowledgement } from './payroll-hmrc-ack.util'

describe('payroll-hmrc-ack.util', () => {
  it('parses an acknowledgement with correlation id', () => {
    const xml = `<?xml version="1.0"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <Header>
    <MessageDetails>
      <Class>HMRC-PAYE-RTI-FPS</Class>
      <Qualifier>acknowledgement</Qualifier>
      <Function>submit</Function>
      <CorrelationID>ABC123DEF456</CorrelationID>
      <ResponseEndPoint PollInterval="10">https://test-transaction-engine.tax.service.gov.uk/poll</ResponseEndPoint>
      <GatewayTimestamp>2026-08-07T10:00:00.000</GatewayTimestamp>
    </MessageDetails>
  </Header>
</GovTalkMessage>`
    const ack = parseGovTalkAcknowledgement(xml)
    expect(ack.qualifier).toBe('acknowledgement')
    expect(ack.correlationId).toBe('ABC123DEF456')
    expect(ack.derivedStatus).toBe('ACKNOWLEDGED')
    expect(ack.pollIntervalSeconds).toBe(10)
  })

  it('parses error qualifier and error text', () => {
    const xml = `<GovTalkMessage>
  <Header><MessageDetails>
    <Qualifier>error</Qualifier>
    <Function>submit</Function>
    <CorrelationID></CorrelationID>
  </MessageDetails></Header>
  <GovTalkDetails>
    <GovTalkErrors>
      <Error>
        <RaisedBy>Gateway</RaisedBy>
        <Number>1046</Number>
        <Type>fatal</Type>
        <Text>Authentication Failure</Text>
      </Error>
    </GovTalkErrors>
  </GovTalkDetails>
</GovTalkMessage>`
    const ack = parseGovTalkAcknowledgement(xml)
    expect(ack.derivedStatus).toBe('REJECTED')
    expect(ack.errors[0]?.code).toBe('1046')
    expect(ack.errors[0]?.message).toBe('Authentication Failure')
  })
})
