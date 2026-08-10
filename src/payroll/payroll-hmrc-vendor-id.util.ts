import type { ConfigService } from '@nestjs/config'

/** Local/dev placeholder until HMRC Software Developers Support issues a real vendor ID. */
export const HMRC_DEV_DUMMY_VENDOR_ID = 'CARE-DEV-DUMMY-VENDOR-ID'

/**
 * Resolves HMRC_VENDOR_ID for GovTalk envelopes.
 * Falls back to a dummy in non-production when unset (local QA).
 * Production still requires a real env value.
 */
export function resolveHmrcVendorId(
  config: ConfigService,
  options?: { allowDevDummy?: boolean },
): string {
  const configured = (config.get<string>('HMRC_VENDOR_ID') ?? '').trim()
  if (configured) return configured

  const allowDummy = options?.allowDevDummy !== false
  const nodeEnv = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development')
    .trim()
    .toLowerCase()
  const isProd = nodeEnv === 'production'

  if (allowDummy && !isProd) {
    return HMRC_DEV_DUMMY_VENDOR_ID
  }

  return ''
}
