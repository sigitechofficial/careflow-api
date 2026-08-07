/**
 * Parse HMRC Transaction Engine GovTalk acknowledgements / errors (T16).
 */

export type HmrcAckError = {
  code: string | null
  message: string | null
  location?: string | null
}

export type HmrcAcknowledgement = {
  qualifier: string | null
  functionCode: string | null
  correlationId: string | null
  gatewayTimestamp: string | null
  responseEndpoint: string | null
  pollIntervalSeconds: number | null
  errors: HmrcAckError[]
  /** High-level Care status derived from Qualifier. */
  derivedStatus: 'ACKNOWLEDGED' | 'ACCEPTED' | 'REJECTED' | 'ERROR' | 'UNKNOWN'
  rawSummary: string | null
}

function firstMatch(xml: string, pattern: RegExp): string | null {
  const m = xml.match(pattern)
  return m?.[1]?.trim() || null
}

function allMatches(xml: string, pattern: RegExp): string[] {
  const out: string[] = []
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) out.push(m[1].trim())
  }
  return out
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseGovTalkAcknowledgement(xml: string): HmrcAcknowledgement {
  const qualifier = firstMatch(xml, /<Qualifier>\s*([^<]+)\s*<\/Qualifier>/i)
  const functionCode = firstMatch(xml, /<Function>\s*([^<]+)\s*<\/Function>/i)
  const correlationId = firstMatch(xml, /<CorrelationID>\s*([^<]*)\s*<\/CorrelationID>/i)
  const gatewayTimestamp = firstMatch(xml, /<GatewayTimestamp>\s*([^<]+)\s*<\/GatewayTimestamp>/i)
  const responseEndpoint = firstMatch(
    xml,
    /<ResponseEndPoint[^>]*>\s*([^<]+)\s*<\/ResponseEndPoint>/i,
  )
  const pollAttr = firstMatch(xml, /<ResponseEndPoint[^>]*PollInterval="(\d+)"/i)
  const pollIntervalSeconds = pollAttr ? Number(pollAttr) : null

  const errorBlocks = allMatches(
    xml,
    /<Error>([\s\S]*?)<\/Error>/i,
  )
  const errors: HmrcAckError[] = errorBlocks.map((block) => ({
    code: firstMatch(block, /<Number>\s*([^<]+)\s*<\/Number>/i),
    message: (() => {
      const raw = firstMatch(block, /<Text>\s*([^<]+)\s*<\/Text>/i)
      return raw ? decodeXmlEntities(raw) : null
    })(),
    location: firstMatch(block, /<Location>\s*([^<]+)\s*<\/Location>/i),
  }))

  // Also catch simple RaisedBy / ErrorMessage patterns
  if (errors.length === 0) {
    const simpleMsg = firstMatch(xml, /<ErrorMessage>\s*([^<]+)\s*<\/ErrorMessage>/i)
    const simpleCode = firstMatch(xml, /<ErrorCode>\s*([^<]+)\s*<\/ErrorCode>/i)
    if (simpleMsg || simpleCode) {
      errors.push({
        code: simpleCode,
        message: simpleMsg ? decodeXmlEntities(simpleMsg) : null,
      })
    }
  }

  const q = (qualifier ?? '').toLowerCase()
  let derivedStatus: HmrcAcknowledgement['derivedStatus'] = 'UNKNOWN'
  if (q === 'acknowledgement') derivedStatus = 'ACKNOWLEDGED'
  else if (q === 'response') derivedStatus = 'ACCEPTED'
  else if (q === 'error') derivedStatus = 'REJECTED'
  else if (errors.length > 0) derivedStatus = 'ERROR'

  const rawSummary =
    errors
      .map((e) => [e.code, e.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ') || null

  return {
    qualifier,
    functionCode,
    correlationId: correlationId || null,
    gatewayTimestamp,
    responseEndpoint,
    pollIntervalSeconds:
      pollIntervalSeconds != null && Number.isFinite(pollIntervalSeconds)
        ? pollIntervalSeconds
        : null,
    errors,
    derivedStatus,
    rawSummary,
  }
}
