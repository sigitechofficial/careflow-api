import { createHash } from 'crypto'
import type { CareFpsPayload } from './types/fps-payload.types'

/**
 * Stable fingerprint of FPS money/identity content for dual-control (T18).
 * Ignores generatedAt so approve can rebuild from a fresh preview.
 */
export function fingerprintCareFpsPayload(payload: CareFpsPayload): string {
  const slice = {
    employer: payload.employer,
    submission: payload.submission,
    totals: payload.totals,
    employees: payload.employees.map((e) => ({
      employeeId: e.employeeId,
      payId: e.payId,
      nino: e.nino,
      name: e.name,
      employment: e.employment,
      payment: e.payment,
    })),
  }
  return createHash('sha256').update(JSON.stringify(slice)).digest('hex')
}
