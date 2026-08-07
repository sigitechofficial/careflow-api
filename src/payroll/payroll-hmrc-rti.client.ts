import { Injectable, Logger } from '@nestjs/common'
import { transactionEngineSubmitUrl } from './payroll-hmrc-govtalk.util'

export type HmrcRtiHttpResult = {
  ok: boolean
  httpStatus: number
  body: string
  timedOut: boolean
  networkError: string | null
}

/**
 * Thin HTTPS client for HMRC Transaction Engine submit (T16).
 * T17 attaches WEB_APP_VIA_SERVER fraud-prevention Gov-* headers on every POST.
 */
@Injectable()
export class PayrollHmrcRtiClient {
  private readonly logger = new Logger(PayrollHmrcRtiClient.name)

  async postSubmission(params: {
    environment: 'TEST' | 'LIVE'
    xml: string
    /** Fraud-prevention + other HTTP headers (T17). */
    extraHeaders?: Record<string, string>
    timeoutMs?: number
  }): Promise<HmrcRtiHttpResult> {
    const url = transactionEngineSubmitUrl(params.environment)
    const timeoutMs = params.timeoutMs ?? 60_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=UTF-8',
          Accept: 'text/xml',
          ...(params.extraHeaders ?? {}),
        },
        body: params.xml,
        signal: controller.signal,
      })
      const body = await res.text()
      return {
        ok: res.ok,
        httpStatus: res.status,
        body,
        timedOut: false,
        networkError: null,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const timedOut = err instanceof Error && err.name === 'AbortError'
      this.logger.warn(
        `HMRC RTI ${params.environment} submit failed: ${timedOut ? 'timeout' : message}`,
      )
      return {
        ok: false,
        httpStatus: 0,
        body: '',
        timedOut,
        networkError: timedOut ? `Timed out after ${timeoutMs}ms` : message,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
