import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { isSuperAdminRequest } from '../common/request-context/super-admin-context'
import { Prisma } from '@prisma/client'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { AuditAction } from '../audit-logs/enums/audit-action.enum'
import { AuditModule } from '../audit-logs/enums/audit-module.enum'
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util'
import { PrismaService } from '../prisma/prisma.service'
import { parseGovTalkAcknowledgement } from './payroll-hmrc-ack.util'
import { fingerprintCareEpsPayload } from './payroll-eps-fingerprint.util'
import {
  buildCareRtiEpsBodyXml,
  epsMessageClass,
} from './payroll-hmrc-eps-xml.util'
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
import type { PreviewEpsQueryDto, SubmitHmrcEpsDto } from './dto/payroll.dto'
import { PAYROLL_EMPLOYER_SETTINGS_ID } from './payroll-settings.service'
import { PayrollSettingsService } from './payroll-settings.service'
import { hmrcSubmissionLifecycleFields } from './payroll-hmrc-submission-lifecycle.util'
import {
  appendHmrcSubmissionAuditEvent,
  hmrcSubmissionGatewayUpdateData,
  mapHmrcSubmissionAuditEvent,
  responseBodySha256,
} from './payroll-hmrc-submission-audit.util'
import { resolveHmrcVendorId } from './payroll-hmrc-vendor-id.util'
import type { CareEpsPayload } from './types/eps-payload.types'

type HmrcSubmitMode = 'DRY_RUN' | 'SUBMIT'

function asWrite<T>(data: T): T {
  return data
}

function mapRow(row: {
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
export class PayrollHmrcEpsSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly settings: PayrollSettingsService,
    private readonly rtiClient: PayrollHmrcRtiClient,
    private readonly config: ConfigService,
  ) {}

  private envFlag(name: string): boolean {
    return String(this.config.get<string>(name) ?? '').trim().toLowerCase() === 'true'
  }

  private buildFraudHeaders(params: {
    userId: string
    clientContext?: HmrcFraudClientContext | null
    meta?: RequestAuditMeta
  }) {
    const built = buildWebAppViaServerFraudHeaders({
      client: params.clientContext ?? {},
      clientPublicIp: params.meta?.ipAddress ?? null,
      careUserId: params.userId,
      productName: this.config.get<string>('HMRC_VENDOR_PRODUCT_NAME')?.trim() || 'Care Payroll',
      vendorPublicIp: this.config.get<string>('HMRC_VENDOR_PUBLIC_IP')?.trim() || null,
      backendVersion: this.config.get<string>('HMRC_BACKEND_VERSION')?.trim() || '0.0.1',
      adminVersion: this.config.get<string>('HMRC_ADMIN_VERSION')?.trim() || '1.0.0',
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

  private async loadReadyEps(query: PreviewEpsQueryDto) {
    const preview = await this.settings.buildEpsPreview(query)
    const payload = preview.data as CareEpsPayload
    if (!payload.validation?.isReadyToSubmit) {
      throw new BadRequestException(
        'EPS is not ready to send. Fix the Must-fix items on the EPS preview first.',
      )
    }
    const taxYear = query.taxYearId
      ? await this.prisma.payrollTaxYear.findFirst({
          where: { id: query.taxYearId, deletedAt: null },
        })
      : await this.prisma.payrollTaxYear.findFirst({
          where: { deletedAt: null, isCurrent: true },
        })
    if (!taxYear) throw new NotFoundException('Tax year not found')
    return { payload, taxYearId: taxYear.id, taxMonth: query.taxMonth }
  }

  private buildEnvelope(params: {
    payload: CareEpsPayload
    gatewayUserId: string
    password: string
    environment: HmrcGatewayEnvironment
    vendorId: string
  }) {
    const bodyXml = buildCareRtiEpsBodyXml(params.payload)
    const requestXml = buildGovTalkSubmitEnvelope({
      messageClass: epsMessageClass(),
      gatewayUserId: params.gatewayUserId,
      gatewayPassword: params.password,
      taxOfficeNumber: params.payload.employer.hmrcOfficeNumber,
      taxOfficeReference: params.payload.employer.employerPayeReference,
      vendorId: params.vendorId,
      gatewayTest: params.environment === 'LIVE' ? '0' : '1',
      bodyXml,
    })
    return {
      requestXml,
      requestXmlRedacted: redactGovTalkPassword(requestXml),
      submissionUrl: transactionEngineSubmitUrl(params.environment),
    }
  }

  async list(query: { taxYearId?: string; taxMonth?: number }) {
    const rows = await this.prisma.payrollHmrcSubmission.findMany({
      where: asWrite({
        documentType: 'EPS',
        ...(query.taxYearId ? { taxYearId: query.taxYearId } : {}),
        ...(query.taxMonth != null ? { taxMonth: query.taxMonth } : {}),
      }) as never,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return {
      message: 'HMRC EPS submission history',
      data: rows.map(mapRow),
    }
  }

  async getById(submissionId: string) {
    const row = await this.prisma.payrollHmrcSubmission.findFirst({
      where: { id: submissionId, documentType: 'EPS' },
    })
    if (!row) throw new NotFoundException('EPS submission not found')
    const events = await (this.prisma as unknown as {
      payrollHmrcSubmissionEvent: {
        findMany: (args: unknown) => Promise<Array<Parameters<typeof mapHmrcSubmissionAuditEvent>[0]>>
      }
    }).payrollHmrcSubmissionEvent.findMany({
      where: { submissionId: row.id },
      orderBy: { createdAt: 'asc' },
    })
    return {
      message: 'HMRC EPS submission detail',
      data: {
        ...mapRow(row),
        requestXmlRedacted: row.requestXmlRedacted,
        responseXml: row.responseXml,
        responseSha256: responseBodySha256(row.responseXml),
        auditEvents: events.map(mapHmrcSubmissionAuditEvent),
      },
    }
  }

  private async postAndPersist(params: {
    taxYearId: string
    taxMonth: number
    userId: string
    mode: HmrcSubmitMode
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
          data: asWrite(
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
          data: asWrite({
            documentType: 'EPS',
            ukPayrollRunId: null,
            taxYearId: params.taxYearId,
            taxMonth: params.taxMonth,
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
        detail: {
          environment: params.environment,
          taxYearId: params.taxYearId,
          taxMonth: params.taxMonth,
        },
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
        detail: {
          environment: params.environment,
          taxYearId: params.taxYearId,
          taxMonth: params.taxMonth,
        },
      })
    }

    await this.audit.logAudit({
      userId: params.userId,
      module: AuditModule.PAYROLL,
      action: params.approvedById
        ? AuditAction.PAYROLL_HMRC_EPS_LIVE_APPROVED
        : AuditAction.PAYROLL_HMRC_EPS_SUBMITTED,
      recordType: 'PayrollHmrcSubmission',
      recordId: row.id,
      newValues: {
        documentType: 'EPS',
        taxYearId: params.taxYearId,
        taxMonth: params.taxMonth,
        environment: params.environment,
        status,
        correlationId,
        payloadFingerprint: params.payloadFingerprint,
        responseSha256: responseSha,
      },
      ipAddress: params.meta?.ipAddress,
      userAgent: params.meta?.userAgent,
    })

    return {
      message:
        status === 'ACKNOWLEDGED' || status === 'ACCEPTED'
          ? `EPS submitted to HMRC ${params.environment === 'LIVE' ? 'live' : 'test'} gateway`
          : `EPS submit finished with errors — see submission detail`,
      data: {
        ...mapRow(row),
        requestXmlRedacted: row.requestXmlRedacted,
        responseXml: row.responseXml,
        responseSha256: responseSha,
      },
    }
  }

  async submitEps(
    userId: string,
    dto: SubmitHmrcEpsDto,
    meta?: RequestAuditMeta,
  ) {
    const mode = dto.mode
    const environment: HmrcGatewayEnvironment = dto.environment === 'LIVE' ? 'LIVE' : 'TEST'
    const previewQuery: PreviewEpsQueryDto = {
      taxYearId: dto.taxYearId,
      taxMonth: dto.taxMonth,
      noPaymentThisPeriod: dto.noPaymentThisPeriod,
      employmentAllowanceClaimed: dto.employmentAllowanceClaimed,
      smpRecovered: dto.smpRecovered,
      sppRecovered: dto.sppRecovered,
      sapRecovered: dto.sapRecovered,
      shppRecovered: dto.shppRecovered,
      spbpRecovered: dto.spbpRecovered,
      nicCompensationOnStatutory: dto.nicCompensationOnStatutory,
    }
    const { payload, taxYearId, taxMonth } = await this.loadReadyEps(previewQuery)
    const fingerprint = fingerprintCareEpsPayload(payload)

    const employerRow = await this.prisma.payrollEmployerSettings.findUnique({
      where: { id: PAYROLL_EMPLOYER_SETTINGS_ID },
    })
    if (!employerRow) {
      throw new BadRequestException('Employer PAYE settings not found.')
    }

    const creds = resolveGatewayCredentialsForEnvironment(employerRow, environment)
    if (!creds.ready || !creds.userId || !creds.password) {
      throw new BadRequestException(
        environment === 'LIVE'
          ? 'HMRC Gateway LIVE login is incomplete.'
          : 'HMRC Gateway test login is incomplete.',
      )
    }

    if (environment === 'LIVE') {
      if (normalizeHmrcEnvironment(employerRow.activeHmrcEnvironment) !== 'LIVE') {
        throw new BadRequestException(
          'Switch Employer PAYE active environment to Live before a live EPS dry-run or send request.',
        )
      }
      if (!this.envFlag('HMRC_RTI_LIVE_ENABLED')) {
        throw new BadRequestException(
          'Live HMRC is switched off (set HMRC_RTI_LIVE_ENABLED=true).',
        )
      }
    }

    const vendorId = resolveHmrcVendorId(this.config)
    if (mode === 'SUBMIT' && !vendorId) {
      throw new BadRequestException('HMRC_VENDOR_ID is not set on the server.')
    }

    const fraud = this.buildFraudHeaders({
      userId,
      clientContext: dto.clientContext ?? null,
      meta,
    })
    const envelope = this.buildEnvelope({
      payload,
      gatewayUserId: creds.userId,
      password: creds.password,
      environment,
      vendorId: vendorId || resolveHmrcVendorId(this.config),
    })

    if (mode === 'DRY_RUN') {
      const row = await this.prisma.payrollHmrcSubmission.create({
        data: asWrite({
          documentType: 'EPS',
          ukPayrollRunId: null,
          taxYearId,
          taxMonth,
          mode: 'DRY_RUN',
          environment,
          status: 'DRAFT_BUILT',
          gatewayUserId: creds.userId,
          vendorId: vendorId || null,
          submissionUrl: envelope.submissionUrl,
          requestXmlRedacted: envelope.requestXmlRedacted,
          acknowledgement: {
            note: `EPS dry run for tax month ${taxMonth} (${environment}) — not sent.`,
            epsQuery: previewQuery,
          } as unknown as Prisma.InputJsonValue,
          fraudPreventionHeaders: fraud.snapshot,
          payloadFingerprint: fingerprint,
          createdById: userId,
        }) as never,
      })

      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_HMRC_EPS_DRY_RUN,
        recordType: 'PayrollHmrcSubmission',
        recordId: row.id,
        newValues: {
          taxYearId,
          taxMonth,
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
        detail: { environment, taxYearId, taxMonth, documentType: 'EPS' },
      })

      return {
        message: `EPS GovTalk envelope built (${environment} dry run — not sent)`,
        data: { ...mapRow(row), requestXmlRedacted: row.requestXmlRedacted },
      }
    }

    if (environment === 'LIVE') {
      const existingPending = await this.prisma.payrollHmrcSubmission.findFirst({
        where: asWrite({
          documentType: 'EPS',
          taxYearId,
          taxMonth,
          environment: 'LIVE',
          status: 'PENDING_APPROVAL',
        }) as never,
      })
      if (existingPending) {
        throw new BadRequestException(
          'A live EPS send is already waiting for approval for this tax month.',
        )
      }

      const row = await this.prisma.payrollHmrcSubmission.create({
        data: asWrite({
          documentType: 'EPS',
          ukPayrollRunId: null,
          taxYearId,
          taxMonth,
          mode: 'SUBMIT',
          environment: 'LIVE',
          status: 'PENDING_APPROVAL',
          gatewayUserId: creds.userId,
          vendorId,
          submissionUrl: envelope.submissionUrl,
          requestXmlRedacted: envelope.requestXmlRedacted,
          acknowledgement: {
            note: 'Waiting for a different user to approve this live EPS send.',
            fingerprint,
            epsQuery: previewQuery,
          } as unknown as Prisma.InputJsonValue,
          fraudPreventionHeaders: fraud.snapshot,
          payloadFingerprint: fingerprint,
          createdById: userId,
        }) as never,
      })

      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_HMRC_EPS_LIVE_REQUESTED,
        recordType: 'PayrollHmrcSubmission',
        recordId: row.id,
        newValues: {
          taxYearId,
          taxMonth,
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
        detail: { environment: 'LIVE', taxYearId, taxMonth, documentType: 'EPS' },
      })

      return {
        message:
          'Live EPS send requested — a different user must approve before Care contacts HMRC live.',
        data: { ...mapRow(row), requestXmlRedacted: row.requestXmlRedacted },
      }
    }

    if (!this.envFlag('HMRC_RTI_HTTP_ENABLED')) {
      throw new BadRequestException(
        'Real HMRC HTTP submit is switched off (set HMRC_RTI_HTTP_ENABLED=true). Use Dry run instead.',
      )
    }

    return this.postAndPersist({
      taxYearId,
      taxMonth,
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

  async approveLive(
    approverUserId: string,
    submissionId: string,
    confirmPhrase: string,
    meta?: RequestAuditMeta,
    clientContext?: HmrcFraudClientContext | null,
  ) {
    if (confirmPhrase !== 'SEND LIVE EPS') {
      throw new BadRequestException('Confirmation phrase must be exactly: SEND LIVE EPS')
    }
    if (!this.envFlag('HMRC_RTI_LIVE_ENABLED') || !this.envFlag('HMRC_RTI_HTTP_ENABLED')) {
      throw new BadRequestException(
        'Live HTTP submit requires HMRC_RTI_LIVE_ENABLED=true and HMRC_RTI_HTTP_ENABLED=true.',
      )
    }

    const row = await this.prisma.payrollHmrcSubmission.findFirst({
      where: { id: submissionId, documentType: 'EPS' },
    })
    if (!row) throw new NotFoundException('EPS submission not found')
    if (row.environment !== 'LIVE' || row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only a pending live EPS request can be approved.')
    }
    if (row.createdById && row.createdById === approverUserId && !isSuperAdminRequest()) {
      throw new ForbiddenException(
        'You requested this live EPS send. A different user must approve it.',
      )
    }
    const rowTax = row as { taxYearId?: string | null; taxMonth?: number | null }
    if (!rowTax.taxYearId || rowTax.taxMonth == null) {
      throw new BadRequestException('EPS submission is missing tax year / month.')
    }

    const ack = row.acknowledgement as { epsQuery?: PreviewEpsQueryDto } | null
    const { payload, taxYearId, taxMonth } = await this.loadReadyEps(
      ack?.epsQuery ?? {
        taxYearId: rowTax.taxYearId,
        taxMonth: rowTax.taxMonth,
      },
    )
    const fingerprint = fingerprintCareEpsPayload(payload)
    const stored = (row as { payloadFingerprint?: string | null }).payloadFingerprint
    if (!stored || stored !== fingerprint) {
      throw new BadRequestException(
        'The EPS figures changed since this live send was requested. Reject and create a new request.',
      )
    }

    const employerRow = await this.prisma.payrollEmployerSettings.findUnique({
      where: { id: PAYROLL_EMPLOYER_SETTINGS_ID },
    })
    if (!employerRow) throw new BadRequestException('Employer PAYE settings not found.')
    if (normalizeHmrcEnvironment(employerRow.activeHmrcEnvironment) !== 'LIVE') {
      throw new BadRequestException('Employer PAYE active environment must be Live.')
    }
    const creds = resolveGatewayCredentialsForEnvironment(employerRow, 'LIVE')
    if (!creds.ready || !creds.userId || !creds.password) {
      throw new BadRequestException('HMRC Gateway LIVE credentials are incomplete.')
    }
    const vendorId = resolveHmrcVendorId(this.config)
    if (!vendorId) throw new BadRequestException('HMRC_VENDOR_ID is not set on the server.')

    const fraud = this.buildFraudHeaders({
      userId: approverUserId,
      clientContext,
      meta,
    })
    const envelope = this.buildEnvelope({
      payload,
      gatewayUserId: creds.userId,
      password: creds.password,
      environment: 'LIVE',
      vendorId,
    })

    return this.postAndPersist({
      taxYearId,
      taxMonth,
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

  async rejectLive(
    userId: string,
    submissionId: string,
    reason?: string | null,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.payrollHmrcSubmission.findFirst({
      where: { id: submissionId, documentType: 'EPS' },
    })
    if (!row) throw new NotFoundException('EPS submission not found')
    if (row.environment !== 'LIVE' || row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only a pending live EPS request can be rejected.')
    }

    const updated = await this.prisma.payrollHmrcSubmission.update({
      where: { id: row.id },
      data: asWrite({
        status: 'REJECTED_APPROVAL',
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectionNote: reason?.trim() || null,
        acknowledgement: {
          note: 'Live EPS send rejected — nothing was sent to HMRC.',
          reason: reason?.trim() || null,
        } as Prisma.InputJsonValue,
      }) as never,
    })

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_HMRC_EPS_LIVE_REJECTED,
      recordType: 'PayrollHmrcSubmission',
      recordId: updated.id,
      newValues: {
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
      detail: { reason: reason?.trim() || null, documentType: 'EPS' },
    })

    return {
      message: 'Live EPS send request rejected — nothing was sent to HMRC',
      data: mapRow(updated),
    }
  }
}
