import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'

/** Append-only HMRC submission lifecycle events (T21). */
export type HmrcSubmissionAuditEventType =
  | 'DRAFT_BUILT'
  | 'LIVE_REQUESTED'
  | 'LIVE_APPROVED'
  | 'LIVE_REJECTED'
  | 'GATEWAY_POSTED'
  | 'GATEWAY_RESPONSE'

export type HmrcSubmissionAuditEventInput = {
  submissionId: string
  eventType: HmrcSubmissionAuditEventType
  actorUserId?: string | null
  fromStatus?: string | null
  toStatus: string
  payloadFingerprint?: string | null
  correlationId?: string | null
  responseSha256?: string | null
  httpStatus?: number | null
  detail?: Prisma.InputJsonValue | null
}

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function responseBodySha256(body: string | null | undefined): string | null {
  if (!body) return null
  return sha256Hex(body)
}

/**
 * Gateway / approval updates must never rewrite the original GovTalk payload
 * or fingerprint — those are fixed at create / live-request time.
 */
export function hmrcSubmissionGatewayUpdateData(params: {
  status: string
  correlationId: string | null
  responseXml: string | null
  httpStatus: number | null
  qualifier: string | null
  functionCode: string | null
  errorCode: string | null
  errorMessage: string | null
  acknowledgement: Prisma.InputJsonValue
  fraudPreventionHeaders?: Prisma.InputJsonValue
  approvedById?: string | null
  approvedAt?: Date | null
  gatewayUserId?: string | null
  vendorId?: string | null
  submissionUrl?: string | null
}) {
  return {
    status: params.status,
    correlationId: params.correlationId,
    responseXml: params.responseXml,
    httpStatus: params.httpStatus,
    qualifier: params.qualifier,
    functionCode: params.functionCode,
    errorCode: params.errorCode,
    errorMessage: params.errorMessage,
    acknowledgement: params.acknowledgement,
    ...(params.fraudPreventionHeaders !== undefined
      ? { fraudPreventionHeaders: params.fraudPreventionHeaders }
      : {}),
    ...(params.approvedById !== undefined ? { approvedById: params.approvedById } : {}),
    ...(params.approvedAt !== undefined ? { approvedAt: params.approvedAt } : {}),
    ...(params.gatewayUserId !== undefined ? { gatewayUserId: params.gatewayUserId } : {}),
    ...(params.vendorId !== undefined ? { vendorId: params.vendorId } : {}),
    ...(params.submissionUrl !== undefined ? { submissionUrl: params.submissionUrl } : {}),
  }
}

export function mapHmrcSubmissionAuditEvent(row: {
  id: string
  submissionId: string
  eventType: string
  actorUserId: string | null
  fromStatus: string | null
  toStatus: string
  payloadFingerprint: string | null
  correlationId: string | null
  responseSha256: string | null
  httpStatus: number | null
  detail: Prisma.JsonValue | null
  createdAt: Date
}) {
  return {
    id: row.id,
    submissionId: row.submissionId,
    eventType: row.eventType,
    actorUserId: row.actorUserId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    payloadFingerprint: row.payloadFingerprint,
    correlationId: row.correlationId,
    responseSha256: row.responseSha256,
    httpStatus: row.httpStatus,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  }
}

type EventCreateClient = {
  payrollHmrcSubmissionEvent: {
    create: (args: { data: unknown }) => Promise<unknown>
  }
}

/** Append-only write — never update or delete these rows from application code. */
export async function appendHmrcSubmissionAuditEvent(
  db: EventCreateClient,
  input: HmrcSubmissionAuditEventInput,
) {
  return db.payrollHmrcSubmissionEvent.create({
    data: {
      submissionId: input.submissionId,
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus,
      payloadFingerprint: input.payloadFingerprint ?? null,
      correlationId: input.correlationId ?? null,
      responseSha256: input.responseSha256 ?? null,
      httpStatus: input.httpStatus ?? null,
      detail: input.detail ?? undefined,
    } as never,
  })
}
