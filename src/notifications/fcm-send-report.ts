export type FcmSendReason =
  | 'SENT'
  | 'FIREBASE_NOT_READY'
  | 'NO_DEVICE_TOKEN'
  | 'NO_EMPLOYEE'
  | 'SEND_FAILED'
  | 'NOT_FIRST_ACK'
  | 'NOT_SOS'

export type FcmSendReport = {
  ready: boolean
  tokens: number
  sent: number
  skipped: number
  reason: FcmSendReason
  error?: string
}

export function fcmReport(input: {
  ready: boolean
  tokens?: number
  sent?: number
  skipped?: number
  reason: FcmSendReason
  error?: string
}): FcmSendReport {
  return {
    ready: input.ready,
    tokens: input.tokens ?? 0,
    sent: input.sent ?? 0,
    skipped: input.skipped ?? 0,
    reason: input.reason,
    ...(input.error ? { error: input.error } : {}),
  }
}
