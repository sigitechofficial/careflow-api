/** XML helpers for HMRC GovTalk envelopes (T16). Never log plaintext passwords. */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Strip Gateway password from stored / logged GovTalk XML. */
export function redactGovTalkPassword(xml: string): string {
  return xml.replace(
    /(<Authentication>\s*<Method>[^<]*<\/Method>\s*(?:<Role>[^<]*<\/Role>\s*)?<Value>)([^<]*)(<\/Value>)/gi,
    '$1***REDACTED***$3',
  )
}

export type GovTalkBuildInput = {
  messageClass: string
  gatewayUserId: string
  gatewayPassword: string
  taxOfficeNumber: string
  taxOfficeReference: string
  vendorId: string
  productName?: string
  productVersion?: string
  /** 1 = External Test Service; 0 = live. */
  gatewayTest: '0' | '1'
  bodyXml: string
  correlationId?: string
}

/**
 * Build a GovTalk 2.0 submit envelope for the HMRC Transaction Engine.
 * Body must already be well-formed XML (no XML declaration).
 */
export function buildGovTalkSubmitEnvelope(input: GovTalkBuildInput): string {
  const product = escapeXml(input.productName ?? 'Care Payroll')
  const version = escapeXml(input.productVersion ?? '1.0')
  const correlation = input.correlationId ? escapeXml(input.correlationId) : ''

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">`,
    `<EnvelopeVersion>2.0</EnvelopeVersion>`,
    `<Header>`,
    `<MessageDetails>`,
    `<Class>${escapeXml(input.messageClass)}</Class>`,
    `<Qualifier>request</Qualifier>`,
    `<Function>submit</Function>`,
    `<CorrelationID>${correlation}</CorrelationID>`,
    `<Transformation>XML</Transformation>`,
    `<GatewayTest>${input.gatewayTest}</GatewayTest>`,
    `</MessageDetails>`,
    `<SenderDetails>`,
    `<IDAuthentication>`,
    `<SenderID>${escapeXml(input.gatewayUserId)}</SenderID>`,
    `<Authentication>`,
    `<Method>clear</Method>`,
    `<Role>principal</Role>`,
    `<Value>${escapeXml(input.gatewayPassword)}</Value>`,
    `</Authentication>`,
    `</IDAuthentication>`,
    `</SenderDetails>`,
    `</Header>`,
    `<GovTalkDetails>`,
    `<Keys>`,
    `<Key Type="TaxOfficeNumber">${escapeXml(input.taxOfficeNumber)}</Key>`,
    `<Key Type="TaxOfficeReference">${escapeXml(input.taxOfficeReference)}</Key>`,
    `</Keys>`,
    `<ChannelRouting>`,
    `<Channel>`,
    `<URI>${escapeXml(input.vendorId)}</URI>`,
    `<Product>${product}</Product>`,
    `<Version>${version}</Version>`,
    `</Channel>`,
    `</ChannelRouting>`,
    `</GovTalkDetails>`,
    `<Body>`,
    input.bodyXml,
    `</Body>`,
    `</GovTalkMessage>`,
  ].join('')
}

export const HMRC_TRANSACTION_ENGINE_URLS = {
  TEST: 'https://test-transaction-engine.tax.service.gov.uk/submission',
  LIVE: 'https://transaction-engine.tax.service.gov.uk/submission',
  TEST_POLL: 'https://test-transaction-engine.tax.service.gov.uk/poll',
  LIVE_POLL: 'https://transaction-engine.tax.service.gov.uk/poll',
} as const

export function transactionEngineSubmitUrl(environment: 'TEST' | 'LIVE'): string {
  return environment === 'LIVE'
    ? HMRC_TRANSACTION_ENGINE_URLS.LIVE
    : HMRC_TRANSACTION_ENGINE_URLS.TEST
}
