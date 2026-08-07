/**
 * HMRC fraud-prevention headers for WEB_APP_VIA_SERVER (T17).
 * Spec: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/connection-method/web-app-via-server/
 * Missing values are omitted — never invent data.
 */

export const HMRC_CONNECTION_METHOD_WEB_APP_VIA_SERVER = 'WEB_APP_VIA_SERVER'

/** Percent-encode a key or value; leave = & , separators alone (caller joins). */
export function hmrcPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function formatHmrcUtcTimezoneFromOffsetMinutes(offsetMinutes: number): string {
  // JS getTimezoneOffset: minutes behind UTC. HMRC wants local as UTC±HH:MM.
  const total = -offsetMinutes
  const sign = total >= 0 ? '+' : '-'
  const abs = Math.abs(total)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hh}:${mm}`
}

export function isLikelyPublicIp(ip: string | null | undefined): boolean {
  if (!ip) return false
  const v = ip.trim().replace(/^::ffff:/i, '')
  if (!v || v === '::1' || v === '127.0.0.1') return false
  if (/^10\./.test(v)) return false
  if (/^192\.168\./.test(v)) return false
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(v)) return false
  if (/^fc/i.test(v) || /^fd/i.test(v) || /^fe80:/i.test(v)) return false
  return true
}

export type HmrcFraudClientContext = {
  deviceId?: string | null
  browserJsUserAgent?: string | null
  timezone?: string | null
  screens?: string | null
  windowSize?: string | null
  publicPort?: number | null
  /** Optional MFA header already formatted; omit when password-only login. */
  multiFactor?: string | null
}

export type BuildHmrcFraudHeadersInput = {
  client: HmrcFraudClientContext
  /** Public IP of the browser / originating device (from proxy or socket). */
  clientPublicIp?: string | null
  /** When clientPublicIp was observed (ISO). Defaults to now. */
  clientPublicIpTimestamp?: string | null
  /** Signed-in Care user id (internal). */
  careUserId: string
  /** Optional username/email for Gov-Client-User-IDs. */
  careUserLogin?: string | null
  productName?: string | null
  vendorPublicIp?: string | null
  backendVersion?: string | null
  adminVersion?: string | null
  vendorLicenseIds?: string | null
}

export type HmrcFraudHeadersBuildResult = {
  connectionMethod: typeof HMRC_CONNECTION_METHOD_WEB_APP_VIA_SERVER
  /** Headers to attach to the HMRC HTTP request (only non-empty). */
  headers: Record<string, string>
  /** Keys that could not be collected (for dry-run / ops visibility). */
  omitted: string[]
}

function setHeader(
  headers: Record<string, string>,
  omitted: string[],
  name: string,
  value: string | null | undefined,
) {
  const v = value?.trim()
  if (v) headers[name] = v
  else omitted.push(name)
}

/**
 * Build WEB_APP_VIA_SERVER fraud-prevention headers for an HMRC API / Transaction Engine call.
 */
export function buildWebAppViaServerFraudHeaders(
  input: BuildHmrcFraudHeadersInput,
): HmrcFraudHeadersBuildResult {
  const headers: Record<string, string> = {
    'Gov-Client-Connection-Method': HMRC_CONNECTION_METHOD_WEB_APP_VIA_SERVER,
  }
  const omitted: string[] = []

  setHeader(headers, omitted, 'Gov-Client-Device-ID', input.client.deviceId)
  setHeader(
    headers,
    omitted,
    'Gov-Client-Browser-JS-User-Agent',
    input.client.browserJsUserAgent,
  )
  setHeader(headers, omitted, 'Gov-Client-Timezone', input.client.timezone)
  setHeader(headers, omitted, 'Gov-Client-Screens', input.client.screens)
  setHeader(headers, omitted, 'Gov-Client-Window-Size', input.client.windowSize)

  const port =
    input.client.publicPort != null &&
    Number.isInteger(input.client.publicPort) &&
    input.client.publicPort >= 1 &&
    input.client.publicPort <= 65535
      ? String(input.client.publicPort)
      : null
  setHeader(headers, omitted, 'Gov-Client-Public-Port', port)

  const clientIp = input.clientPublicIp?.trim() ?? null
  if (isLikelyPublicIp(clientIp)) {
    headers['Gov-Client-Public-IP'] = clientIp!
    headers['Gov-Client-Public-IP-Timestamp'] =
      input.clientPublicIpTimestamp?.trim() || new Date().toISOString()
  } else {
    omitted.push('Gov-Client-Public-IP', 'Gov-Client-Public-IP-Timestamp')
  }

  // MFA only when we truly have it — password-only Care login → omit.
  setHeader(headers, omitted, 'Gov-Client-Multi-Factor', input.client.multiFactor)

  const userParts: string[] = []
  if (input.careUserId.trim()) {
    userParts.push(`care-user-id=${hmrcPercentEncode(input.careUserId.trim())}`)
  }
  if (input.careUserLogin?.trim()) {
    userParts.push(`care-login=${hmrcPercentEncode(input.careUserLogin.trim())}`)
  }
  setHeader(headers, omitted, 'Gov-Client-User-IDs', userParts.join('&') || null)

  const product =
    input.productName?.trim() || 'Care Payroll'
  headers['Gov-Vendor-Product-Name'] = hmrcPercentEncode(product)

  const versionParts: string[] = []
  if (input.adminVersion?.trim()) {
    versionParts.push(`care-admin=${hmrcPercentEncode(input.adminVersion.trim())}`)
  }
  if (input.backendVersion?.trim()) {
    versionParts.push(
      `careadmin-backend=${hmrcPercentEncode(input.backendVersion.trim())}`,
    )
  }
  setHeader(headers, omitted, 'Gov-Vendor-Version', versionParts.join('&') || null)

  setHeader(headers, omitted, 'Gov-Vendor-License-IDs', input.vendorLicenseIds)

  const vendorIp = input.vendorPublicIp?.trim() ?? null
  if (isLikelyPublicIp(vendorIp)) {
    headers['Gov-Vendor-Public-IP'] = vendorIp!
  } else {
    omitted.push('Gov-Vendor-Public-IP')
  }

  if (isLikelyPublicIp(vendorIp) && isLikelyPublicIp(clientIp)) {
    headers['Gov-Vendor-Forwarded'] =
      `by=${hmrcPercentEncode(vendorIp!)}&for=${hmrcPercentEncode(clientIp!)}`
  } else {
    omitted.push('Gov-Vendor-Forwarded')
  }

  return {
    connectionMethod: HMRC_CONNECTION_METHOD_WEB_APP_VIA_SERVER,
    headers,
    omitted,
  }
}
