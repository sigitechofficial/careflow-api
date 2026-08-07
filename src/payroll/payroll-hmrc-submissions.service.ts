import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { AuditAction } from '../audit-logs/enums/audit-action.enum'
import { AuditModule } from '../audit-logs/enums/audit-module.enum'
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util'
import { PrismaService } from '../prisma/prisma.service'
import { parseGovTalkAcknowledgement } from './payroll-hmrc-ack.util'
import { fingerprintCareFpsPayload } from './payroll-fps-fingerprint.util'
import {
  buildCareRtiFpsBodyXml,
  fpsMessageClassForTaxYear,
} from './payroll-hmrc-fps-xml.util'
import {
  buildWebAppViaServerFraudHeaders,
  type HmrcFraudClientContext,
} from './payroll-hmrc-fraud-headers.util'
import {
  buildGovTalkSubmitEnvelope,
  redactGovTalkPassword,
  transactionEngineSubmitUrl,
} from './payroll-hmrc-govtalk.util'
import { PayrollHmrcRtiClient } from './payroll-hmrc-rti.client'
import {
  normalizeHmrcEnvironment,
  resolveGatewayCredentialsForEnvironment,
  type HmrcGatewayEnvironment,
} from './payroll-gateway-credentials.util'
import { PAYROLL_EMPLOYER_SETTINGS_ID } from './payroll-settings.service'
import { PayrollRunsService } from './payroll-runs.service'
import { hmrcSubmissionLifecycleFields } from './payroll-hmrc-submission-lifecycle.util'
import {
  appendHmrcSubmissionAuditEvent,
  hmrcSubmissionGatewayUpdateData,
  mapHmrcSubmissionAuditEvent,
  responseBodySha256,
} from './payroll-hmrc-submission-audit.util'
import type { CareFpsPayload } from './types/fps-payload.types'

export type HmrcFpsSubmitMode = 'DRY_RUN' | 'SUBMIT'

/** Prisma write cast — regenerate client after T17/T18 migrations if Nest locked the engine DLL. */
function asHmrcSubmissionWrite<T>(data: T): T {
  return data
}

function mapSubmissionRow(row: {
  id: string
  ukPayrollRunId: string | null
  taxYearId?: string | null
  taxMonth?: number | null
  documentType: string
  mode: string
  environment: string
  status: string
  correlationId: string | null
  gatewayUserId: string | null
  vendorId: string | null
  submissionUrl: string | null
  requestXmlRedacted: string | null
  responseXml: string | null
  httpStatus: number | null
  qualifier: string | null
  functionCode: string | null
  errorCode: string | null
  errorMessage: string | null
  acknowledgement: Prisma.JsonValue | null
  fraudPreventionHeaders?: Prisma.JsonValue | null
  payloadFingerprint?: string | null
  approvedById?: string | null
  approvedAt?: Date | null
  rejectedById?: string | null
  rejectedAt?: Date | null
  rejectionNote?: string | null
  createdAt: Date
  createdById: string | null
}) {
  return {
    id: row.id,
    ukPayrollRunId: row.ukPayrollRunId,
    taxYearId: row.taxYearId ?? null,
    taxMonth: row.taxMonth ?? null,
    documentType: row.documentType,
    mode: row.mode,
    environment: row.environment,
    status: row.status,
    correlationId: row.correlationId,
    gatewayUserId: row.gatewayUserId,
    vendorId: row.vendorId,
    submissionUrl: row.submissionUrl,
    hasRequestXml: Boolean(row.requestXmlRedacted),
    hasResponseXml: Boolean(row.responseXml),
    httpStatus: row.httpStatus,
    qualifier: row.qualifier,
    functionCode: row.functionCode,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    acknowledgement: row.acknowledgement,
    fraudPreventionHeaders: row.fraudPreventionHeaders ?? null,
    payloadFingerprint: row.payloadFingerprint ?? null,
    approvedById: row.approvedById ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedById: row.rejectedById ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
    rejectionNote: row.rejectionNote ?? null,
    createdAt: row.createdAt.toISOString(),
    createdById: row.createdById,
    ...hmrcSubmissionLifecycleFields(row.status, Boolean(row.requestXmlRedacted)),
  }
}

@Injectable()
export class PayrollHmrcSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly runs: PayrollRunsService,
    private readonly rtiClient: PayrollHmrcRtiClient,
    private readonly config: ConfigService,
  ) {}

  async listForRun(runId: string) {
    const run = await this.prisma.ukPayrollRun.findFirst({
      where: { id: runId, deletedAt: null },
      select: { id: true },
    })
    if (!run) throw new NotFoundException('UK payroll run not found')

    const rows = await this.prisma.payrollHmrcSubmission.findMany({
      where: { ukPayrollRunId: runId, documentType: 'FPS' },
      orderBy: { createdAt: 'desc' },
    })

    return {
      message: 'HMRC RTI submission history for this run',
      data: rows.map(mapSubmissionRow),
    }
  }

  async getSubmission(runId: string, submissionId: string) {
    const row = await this.prisma.payrollHmrcSubmission.findFirst({
      where: { id: submissionId, ukPayrollRunId: runId },
    })
    if (!row) throw new NotFoundException('HMRC submission not found')
    const events = await (this.prisma as unknown as {
      payrollHmrcSubmissionEvent: {
        findMany: (args: unknown) => Promise<Array<Parameters<typeof mapHmrcSubmissionAuditEvent>[0]>>
      }
    }).payrollHmrcSubmissionEvent.findMany({
      where: { submissionId: row.id },
      orderBy: { createdAt: 'asc' },
    })
    return {
      message: 'HMRC RTI submission detail',
      data: {
        ...mapSubmissionRow(row),
        requestXmlRedacted: row.requestXmlRedacted,
        responseXml: row.responseXml,
        responseSha256: responseBodySha256(row.responseXml),
        auditEvents: events.map(mapHmrcSubmissionAuditEvent),
      },
    }
  }

  private envFlag(name: string): boolean {
    return String(this.config.get<string>(name) ?? '').trim().toLowerCase() === 'true'
  }

  private buildFraudHeaders(params: {
    userId: string
    clientContext?: HmrcFraudClientContext | null
    meta?: RequestAuditMeta
  }) {
    const productName =
      this.config.get<string>('HMRC_VENDOR_PRODUCT_NAME')?.trim() || 'Care Payroll'
    const vendorPublicIp = this.config.get<string>('HMRC_VENDOR_PUBLIC_IP')?.trim() || null
    const backendVersion =
      this.config.get<string>('HMRC_BACKEND_VERSION')?.trim() || '0.0.1'
    const adminVersion = this.config.get<string>('HMRC_ADMIN_VERSION')?.trim() || '1.0.0'

    const built = buildWebAppViaServerFraudHeaders({
      client: params.clientContext ?? {},
      clientPublicIp: params.meta?.ipAddress ?? null,
      careUserId: params.userId,
      productName,
      vendorPublicIp,
      backendVersion,
      adminVersion,
    })

    return {
      headers: built.headers,
      snapshot: {
        connectionMethod: built.connectionMethod,
        headers: built.headers,
        omitted: built.omitted,
        collectedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    }
  }

  private async loadReadyPayload(runId: string) {
    const preview = await this.runs.buildFpsPreview(runId)
    const payload = preview.data as CareFpsPayload
    if (!payload.validation?.isReadyToSubmit) {
      throw new BadRequestException(
        'FPS is not ready to send. Fix the Must-fix items on the FPS preview first.',
      )
    }
    return payload
  }

  private async loadEmployer() {
    const employerRow = await this.prisma.payrollEmployerSettings.findUnique({
      where: { id: PAYROLL_EMPLOYER_SETTINGS_ID },
    })
    if (!employerRow) {
      throw new BadRequestException(
        'Employer PAYE settings not found. Configure them under Payroll → Employer PAYE.',
      )
    }
    return employerRow
  }

  private buildEnvelope(params: {
    payload: CareFpsPayload
    userId: string
    password: string
    environment: HmrcGatewayEnvironment
    vendorId: string
  }) {
    const bodyXml = buildCareRtiFpsBodyXml(params.payload)
    const messageClass = fpsMessageClassForTaxYear(params.payload.submission.relatedTaxYear)
    const employer = params.payload.employer
    const requestXml = buildGovTalkSubmitEnvelope({
      messageClass,
      gatewayUserId: params.userId,
      gatewayPassword: params.password,
      taxOfficeNumber: employer.hmrcOfficeNumber,
      taxOfficeReference: employer.employerPayeReference,
      vendorId: params.vendorId,
      gatewayTest: params.environment === 'LIVE' ? '0' : '1',
      bodyXml,
    })
    return {
      messageClass,
      requestXml,
      requestXmlRedacted: redactGovTalkPassword(requestXml),
      submissionUrl: transactionEngineSubmitUrl(params.environment),
    }
  }

  private async postAndPersist(params: {
    runId: string
    userId: string
    mode: HmrcFpsSubmitMode
    environment: HmrcGatewayEnvironment
    requestXml: string
    requestXmlRedacted: string
    submissionUrl: string
    gatewayUserId: string
    vendorId: string
    fraudHeaders: Record<string, string>
    fraudSnapshot: Prisma.InputJsonValue
    payloadFingerprint: string
    meta?: RequestAuditMeta
    /** When approving a pending row, update it instead of creating. */
    existingSubmissionId?: string
    approvedById?: string
  }) {
    const http = await this.rtiClient.postSubmission({
      environment: params.environment,
      xml: params.requestXml,
      extraHeaders: params.fraudHeaders,
    })

    let status = 'ERROR'
    let ack = null as ReturnType<typeof parseGovTalkAcknowledgement> | null
    let errorCode: string | null = null
    let errorMessage: string | null = null
    let qualifier: string | null = null
    let functionCode: string | null = null
    let correlationId: string | null = null

    if (http.networkError) {
      status = 'ERROR'
      errorMessage = http.networkError
    } else if (http.body) {
      ack = parseGovTalkAcknowledgement(http.body)
      qualifier = ack.qualifier
      functionCode = ack.functionCode
      correlationId = ack.correlationId
      status =
        ack.derivedStatus === 'UNKNOWN' ? (http.ok ? 'SUBMITTED' : 'ERROR') : ack.derivedStatus
      if (ack.errors[0]) {
        errorCode = ack.errors[0].code
        errorMessage = ack.errors[0].message ?? ack.rawSummary
      } else if (!http.ok && !errorMessage) {
        errorMessage = `HMRC returned HTTP ${http.httpStatus}`
      }
    } else {
      errorMessage = `Empty response from HMRC (HTTP ${http.httpStatus})`
    }

    const acknowledgement = (ack ?? {
      networkError: http.networkError,
      timedOut: http.timedOut,
    }) as Prisma.InputJsonValue
    const responseXml = http.body || null
    const responseSha = responseBodySha256(responseXml)
    const fromStatus = params.existingSubmissionId ? 'PENDING_APPROVAL' : null

    const row = params.existingSubmissionId
      ? await this.prisma.payrollHmrcSubmission.update({
          where: { id: params.existingSubmissionId },
          data: asHmrcSubmissionWrite(
            hmrcSubmissionGatewayUpdateData({
              status,
              correlationId,
              responseXml,
              httpStatus: http.httpStatus || null,
              qualifier,
              functionCode,
              errorCode,
              errorMessage,
              acknowledgement,
              fraudPreventionHeaders: params.fraudSnapshot,
              approvedById: params.approvedById ?? null,
              approvedAt: params.approvedById ? new Date() : null,
              gatewayUserId: params.gatewayUserId,
              vendorId: params.vendorId,
              submissionUrl: params.submissionUrl,
            }),
          ) as never,
        })
      : await this.prisma.payrollHmrcSubmission.create({
          data: asHmrcSubmissionWrite({
            ukPayrollRunId: params.runId,
            documentType: 'FPS',
            mode: params.mode,
            environment: params.environment,
            status,
            correlationId,
            gatewayUserId: params.gatewayUserId,
            vendorId: params.vendorId,
            submissionUrl: params.submissionUrl,
            requestXmlRedacted: params.requestXmlRedacted,
            responseXml,
            httpStatus: http.httpStatus || null,
            qualifier,
            functionCode,
            errorCode,
            errorMessage,
            acknowledgement,
            fraudPreventionHeaders: params.fraudSnapshot,
            payloadFingerprint: params.payloadFingerprint,
            approvedById: params.approvedById ?? null,
            approvedAt: params.approvedById ? new Date() : null,
            createdById: params.userId,
          }) as never,
        })

    if (params.approvedById) {
      await appendHmrcSubmissionAuditEvent(this.prisma as never, {
        submissionId: row.id,
        eventType: 'LIVE_APPROVED',
        actorUserId: params.approvedById,
        fromStatus,
        toStatus: status,
        payloadFingerprint: params.payloadFingerprint,
        correlationId,
        responseSha256: responseSha,
        httpStatus: http.httpStatus || null,
        detail: { environment: params.environment, mode: params.mode },
      })
    } else if (!params.existingSubmissionId) {
      await appendHmrcSubmissionAuditEvent(this.prisma as never, {
        submissionId: row.id,
        eventType: 'GATEWAY_RESPONSE',
        actorUserId: params.userId,
        fromStatus: null,
        toStatus: status,
        payloadFingerprint: params.payloadFingerprint,
        correlationId,
        responseSha256: responseSha,
        httpStatus: http.httpStatus || null,
        detail: { environment: params.environment, mode: params.mode },
      })
    }

    await this.audit.logAudit({
      userId: params.userId,
      module: AuditModule.PAYROLL,
      action: params.approvedById
        ? AuditAction.PAYROLL_HMRC_FPS_LIVE_APPROVED
        : AuditAction.PAYROLL_HMRC_FPS_SUBMITTED,
      recordType: 'PayrollHmrcSubmission',
      recordId: row.id,
      newValues: {
        ukPayrollRunId: params.runId,
        mode: params.mode,
        environment: params.environment,
        status,
        correlationId,
        httpStatus: http.httpStatus,
        errorCode,
        payloadFingerprint: params.payloadFingerprint,
        responseSha256: responseSha,
      },
      ipAddress: params.meta?.ipAddress,
      userAgent: params.meta?.userAgent,
    })

    return {
      message:
        status === 'ACKNOWLEDGED' || status === 'ACCEPTED'
          ? `FPS submitted to HMRC ${params.environment === 'LIVE' ? 'live' : 'test'} gateway`
          : `FPS submit to HMRC ${params.environment === 'LIVE' ? 'live' : 'test'} finished with errors — see submission detail`,
      data: {
        ...mapSubmissionRow(row),
        requestXmlRedacted: row.requestXmlRedacted,
        responseXml: row.responseXml,
        responseSha256: responseSha,
      },
    }
  }

  /**
   * T16–T18 — DRY_RUN / TEST submit / LIVE dual-control request.
   */
  async submitFps(
    userId: string,
    runId: string,
    mode: HmrcFpsSubmitMode,
    meta?: RequestAuditMeta,
    clientContext?: HmrcFraudClientContext | null,
    environment: HmrcGatewayEnvironment = 'TEST',
  ) {
    const payload = await this.loadReadyPayload(runId)
    const employerRow = await this.loadEmployer()
    const fingerprint = fingerprintCareFpsPayload(payload)

    const creds = resolveGatewayCredentialsForEnvironment(employerRow, environment)
    if (!creds.ready || !creds.userId || !creds.password) {
      throw new BadRequestException(
        environment === 'LIVE'
          ? 'HMRC Gateway LIVE login is incomplete. Save the live user ID and password under Payroll → Employer PAYE.'
          : 'HMRC Gateway test login is incomplete. Save the test user ID and password under Payroll → Employer PAYE.',
      )
    }

    if (environment === 'LIVE') {
      if (normalizeHmrcEnvironment(employerRow.activeHmrcEnvironment) !== 'LIVE') {
        throw new BadRequestException(
          'Switch Employer PAYE active environment to Live before a live dry-run or live send request.',
        )
      }
      if (!this.envFlag('HMRC_RTI_LIVE_ENABLED')) {
        throw new BadRequestException(
          'Live HMRC is switched off on the server (set HMRC_RTI_LIVE_ENABLED=true). Keep using Test until ops enables live.',
        )
      }
    }

    const vendorId = (this.config.get<string>('HMRC_VENDOR_ID') ?? '').trim()
    if (mode === 'SUBMIT' && !vendorId) {
      throw new BadRequestException(
        'HMRC_VENDOR_ID is not set on the server. Ask your ops team for the Software Developers Support vendor ID.',
      )
    }

    const fraud = this.buildFraudHeaders({ userId, clientContext, meta })
    const envelope = this.buildEnvelope({
      payload,
      userId: creds.userId,
      password: creds.password,
      environment,
      vendorId: vendorId || 'CARE-PENDING-VENDOR-ID',
    })

    if (mode === 'DRY_RUN') {
      const row = await this.prisma.payrollHmrcSubmission.create({
        data: asHmrcSubmissionWrite({
          ukPayrollRunId: runId,
          documentType: 'FPS',
          mode: 'DRY_RUN',
          environment,
          status: 'DRAFT_BUILT',
          correlationId: null,
          gatewayUserId: creds.userId,
          vendorId: vendorId || null,
          submissionUrl: envelope.submissionUrl,
          requestXmlRedacted: envelope.requestXmlRedacted,
          responseXml: null,
          httpStatus: null,
          qualifier: null,
          functionCode: null,
          errorCode: null,
          errorMessage: null,
          acknowledgement: {
            note: `Dry run only — GovTalk XML for ${environment} built locally; nothing was sent to HMRC.`,
            messageClass: envelope.messageClass,
            employeeCount: payload.totals.employeeCount,
            fraudPreventionOmitted: (fraud.snapshot as { omitted?: string[] }).omitted ?? [],
          } as Prisma.InputJsonValue,
          fraudPreventionHeaders: fraud.snapshot,
          payloadFingerprint: fingerprint,
          createdById: userId,
        }) as never,
      })

      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_HMRC_FPS_DRY_RUN,
        recordType: 'PayrollHmrcSubmission',
        recordId: row.id,
        newValues: {
          ukPayrollRunId: runId,
          mode: 'DRY_RUN',
          environment,
          status: 'DRAFT_BUILT',
          payloadFingerprint: fingerprint,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      })

      await appendHmrcSubmissionAuditEvent(this.prisma as never, {
        submissionId: row.id,
        eventType: 'DRAFT_BUILT',
        actorUserId: userId,
        fromStatus: null,
        toStatus: 'DRAFT_BUILT',
        payloadFingerprint: fingerprint,
        detail: { environment, mode: 'DRY_RUN', documentType: 'FPS' },
      })

      return {
        message: `FPS GovTalk envelope built (${environment} dry run — not sent to HMRC)`,
        data: {
          ...mapSubmissionRow(row),
          requestXmlRedacted: row.requestXmlRedacted,
        },
      }
    }

    // LIVE SUBMIT → dual-control request only (T18)
    if (environment === 'LIVE') {
      const existingPending = await this.prisma.payrollHmrcSubmission.findFirst({
        where: {
          ukPayrollRunId: runId,
          environment: 'LIVE',
          status: 'PENDING_APPROVAL',
        },
      })
      if (existingPending) {
        throw new BadRequestException(
          'A live FPS send is already waiting for a second person’s approval on this run. Approve or reject it first.',
        )
      }

      const row = await this.prisma.payrollHmrcSubmission.create({
        data: asHmrcSubmissionWrite({
          ukPayrollRunId: runId,
          documentType: 'FPS',
          mode: 'SUBMIT',
          environment: 'LIVE',
          status: 'PENDING_APPROVAL',
          correlationId: null,
          gatewayUserId: creds.userId,
          vendorId,
          submissionUrl: envelope.submissionUrl,
          requestXmlRedacted: envelope.requestXmlRedacted,
          responseXml: null,
          httpStatus: null,
          qualifier: null,
          functionCode: null,
          errorCode: null,
          errorMessage: null,
          acknowledgement: {
            note: 'Waiting for a different user to approve this live FPS send (dual control).',
            messageClass: envelope.messageClass,
            employeeCount: payload.totals.employeeCount,
            fingerprint,
          } as Prisma.InputJsonValue,
          fraudPreventionHeaders: fraud.snapshot,
          payloadFingerprint: fingerprint,
          createdById: userId,
        }) as never,
      })

      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_HMRC_FPS_LIVE_REQUESTED,
        recordType: 'PayrollHmrcSubmission',
        recordId: row.id,
        newValues: {
          ukPayrollRunId: runId,
          environment: 'LIVE',
          status: 'PENDING_APPROVAL',
          payloadFingerprint: fingerprint,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      })

      await appendHmrcSubmissionAuditEvent(this.prisma as never, {
        submissionId: row.id,
        eventType: 'LIVE_REQUESTED',
        actorUserId: userId,
        fromStatus: null,
        toStatus: 'PENDING_APPROVAL',
        payloadFingerprint: fingerprint,
        detail: { environment: 'LIVE', documentType: 'FPS' },
      })

      return {
        message:
          'Live FPS send requested — a different user must approve before Care contacts HMRC live.',
        data: {
          ...mapSubmissionRow(row),
          requestXmlRedacted: row.requestXmlRedacted,
        },
      }
    }

    // TEST SUBMIT → immediate post
    if (!this.envFlag('HMRC_RTI_HTTP_ENABLED')) {
      throw new BadRequestException(
        'Real HMRC HTTP submit is switched off (set HMRC_RTI_HTTP_ENABLED=true). Use Dry run to build GovTalk XML without contacting HMRC.',
      )
    }

    return this.postAndPersist({
      runId,
      userId,
      mode: 'SUBMIT',
      environment: 'TEST',
      requestXml: envelope.requestXml,
      requestXmlRedacted: envelope.requestXmlRedacted,
      submissionUrl: envelope.submissionUrl,
      gatewayUserId: creds.userId,
      vendorId,
      fraudHeaders: fraud.headers,
      fraudSnapshot: fraud.snapshot,
      payloadFingerprint: fingerprint,
      meta,
    })
  }

  /** T18 — second user approves pending LIVE send and posts to HMRC. */
  async approveLiveSubmission(
    approverUserId: string,
    runId: string,
    submissionId: string,
    confirmPhrase: string,
    meta?: RequestAuditMeta,
    clientContext?: HmrcFraudClientContext | null,
  ) {
    if (confirmPhrase !== 'SEND LIVE FPS') {
      throw new BadRequestException('Confirmation phrase must be exactly: SEND LIVE FPS')
    }
    if (!this.envFlag('HMRC_RTI_LIVE_ENABLED') || !this.envFlag('HMRC_RTI_HTTP_ENABLED')) {
      throw new BadRequestException(
        'Live HTTP submit requires HMRC_RTI_LIVE_ENABLED=true and HMRC_RTI_HTTP_ENABLED=true.',
      )
    }

    const row = await this.prisma.payrollHmrcSubmission.findFirst({
      where: { id: submissionId, ukPayrollRunId: runId },
    })
    if (!row) throw new NotFoundException('HMRC submission not found')
    if (row.environment !== 'LIVE' || row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only a pending live FPS request can be approved.')
    }
    if (row.createdById && row.createdById === approverUserId) {
      throw new ForbiddenException(
        'You requested this live send. A different user must approve it (dual control).',
      )
    }

    const payload = await this.loadReadyPayload(runId)
    const fingerprint = fingerprintCareFpsPayload(payload)
    const storedFingerprint = (row as { payloadFingerprint?: string | null }).payloadFingerprint
    if (!storedFingerprint || storedFingerprint !== fingerprint) {
      throw new BadRequestException(
        'The FPS figures changed since this live send was requested. Reject this request and create a new one.',
      )
    }

    const employerRow = await this.loadEmployer()
    if (normalizeHmrcEnvironment(employerRow.activeHmrcEnvironment) !== 'LIVE') {
      throw new BadRequestException(
        'Employer PAYE active environment must be Live to approve a live send.',
      )
    }
    const creds = resolveGatewayCredentialsForEnvironment(employerRow, 'LIVE')
    if (!creds.ready || !creds.userId || !creds.password) {
      throw new BadRequestException('HMRC Gateway LIVE credentials are incomplete.')
    }
    const vendorId = (this.config.get<string>('HMRC_VENDOR_ID') ?? '').trim()
    if (!vendorId) {
      throw new BadRequestException('HMRC_VENDOR_ID is not set on the server.')
    }

    const fraud = this.buildFraudHeaders({
      userId: approverUserId,
      clientContext,
      meta,
    })
    const envelope = this.buildEnvelope({
      payload,
      userId: creds.userId,
      password: creds.password,
      environment: 'LIVE',
      vendorId,
    })

    return this.postAndPersist({
      runId,
      userId: approverUserId,
      mode: 'SUBMIT',
      environment: 'LIVE',
      requestXml: envelope.requestXml,
      requestXmlRedacted: envelope.requestXmlRedacted,
      submissionUrl: envelope.submissionUrl,
      gatewayUserId: creds.userId,
      vendorId,
      fraudHeaders: fraud.headers,
      fraudSnapshot: fraud.snapshot,
      payloadFingerprint: fingerprint,
      meta,
      existingSubmissionId: row.id,
      approvedById: approverUserId,
    })
  }

  /** T18 — reject or cancel a pending LIVE send. */
  async rejectLiveSubmission(
    userId: string,
    runId: string,
    submissionId: string,
    reason?: string | null,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.payrollHmrcSubmission.findFirst({
      where: { id: submissionId, ukPayrollRunId: runId },
    })
    if (!row) throw new NotFoundException('HMRC submission not found')
    if (row.environment !== 'LIVE' || row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only a pending live FPS request can be rejected.')
    }

    const updated = await this.prisma.payrollHmrcSubmission.update({
      where: { id: row.id },
      data: asHmrcSubmissionWrite({
        status: 'REJECTED_APPROVAL',
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectionNote: reason?.trim() || null,
        acknowledgement: {
          note: 'Live FPS send rejected — nothing was sent to HMRC.',
          rejectedById: userId,
          reason: reason?.trim() || null,
        } as Prisma.InputJsonValue,
      }) as never,
    })

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_HMRC_FPS_LIVE_REJECTED,
      recordType: 'PayrollHmrcSubmission',
      recordId: updated.id,
      newValues: {
        ukPayrollRunId: runId,
        status: 'REJECTED_APPROVAL',
        reason: reason?.trim() || null,
        payloadFingerprint: (row as { payloadFingerprint?: string | null }).payloadFingerprint ?? null,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    })

    await appendHmrcSubmissionAuditEvent(this.prisma as never, {
      submissionId: updated.id,
      eventType: 'LIVE_REJECTED',
      actorUserId: userId,
      fromStatus: 'PENDING_APPROVAL',
      toStatus: 'REJECTED_APPROVAL',
      payloadFingerprint:
        (row as { payloadFingerprint?: string | null }).payloadFingerprint ?? null,
      detail: { reason: reason?.trim() || null, documentType: 'FPS' },
    })

    return {
      message: 'Live FPS send request rejected — nothing was sent to HMRC',
      data: mapSubmissionRow(updated),
    }
  }
}
