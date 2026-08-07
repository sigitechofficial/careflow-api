import { createHash } from 'crypto'
import type { CareEpsPayload } from './types/eps-payload.types'

/** Stable fingerprint of EPS content for dual-control (T19). */
export function fingerprintCareEpsPayload(payload: CareEpsPayload): string {
  const slice = {
    employer: payload.employer,
    period: {
      relatedTaxYear: payload.period.relatedTaxYear,
      taxMonth: payload.period.taxMonth,
      taxMonthStart: payload.period.taxMonthStart,
      taxMonthEnd: payload.period.taxMonthEnd,
    },
    indicators: payload.indicators,
    recoveries: payload.recoveries,
  }
  return createHash('sha256').update(JSON.stringify(slice)).digest('hex')
}
