import type { CareEpsPayload } from './types/eps-payload.types'
import { escapeXml } from './payroll-hmrc-govtalk.util'

/** Care → HMRC IR EPS body schema marker. */
export const CARE_RTI_EPS_BODY_VERSION = 'care-rti-eps-xml-1'

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

function relatedTaxYearYy(code: string): string {
  const m = code.trim().match(/^(\d{2})?(\d{2})-(\d{2})$/)
  if (m) return `${m[2]}-${m[3]}`
  if (/^\d{2}-\d{2}$/.test(code.trim())) return code.trim()
  return code.trim()
}

/**
 * Map Care EPS preview JSON into an RTI-shaped EPS XML body for GovTalk.
 */
export function buildCareRtiEpsBodyXml(payload: CareEpsPayload): string {
  const emp = payload.employer
  const period = payload.period
  const relatedYear = relatedTaxYearYy(period.relatedTaxYear)
  const rec = payload.recoveries

  const recoveriesXml = [
    rec.smpRecovered > 0 ? `<SMPRecovered>${money(rec.smpRecovered)}</SMPRecovered>` : '',
    rec.sppRecovered > 0 ? `<SPPRecovered>${money(rec.sppRecovered)}</SPPRecovered>` : '',
    rec.sapRecovered > 0 ? `<SAPRecovered>${money(rec.sapRecovered)}</SAPRecovered>` : '',
    rec.shppRecovered > 0 ? `<ShPPRecovered>${money(rec.shppRecovered)}</ShPPRecovered>` : '',
    rec.spbpRecovered > 0 ? `<SPBPRecovered>${money(rec.spbpRecovered)}</SPBPRecovered>` : '',
    rec.nicCompensationOnStatutory > 0
      ? `<NICCompensationOnStatutoryPay>${money(rec.nicCompensationOnStatutory)}</NICCompensationOnStatutoryPay>`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return [
    `<IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/PAYE/RTI/EmployerPaymentSummary/24-25/1" careBodyVersion="${CARE_RTI_EPS_BODY_VERSION}">`,
    `<IRheader>`,
    `<Keys>`,
    `<Key Type="TaxOfficeNumber">${escapeXml(emp.hmrcOfficeNumber)}</Key>`,
    `<Key Type="TaxOfficeReference">${escapeXml(emp.employerPayeReference)}</Key>`,
    `</Keys>`,
    `<PeriodEnd>${escapeXml(period.taxMonthEnd)}</PeriodEnd>`,
    `<DefaultCurrency>GBP</DefaultCurrency>`,
    `<IRmark Type="calculation">CarePreview</IRmark>`,
    `<Sender>Employer</Sender>`,
    `</IRheader>`,
    `<EmployerPaymentSummary>`,
    `<EmpRefs>`,
    `<OfficeNo>${escapeXml(emp.hmrcOfficeNumber)}</OfficeNo>`,
    `<PayeRef>${escapeXml(emp.employerPayeReference)}</PayeRef>`,
    `<AORef>${escapeXml(emp.accountsOfficeReference)}</AORef>`,
    emp.employerTradingName
      ? `<EmployerName>${escapeXml(emp.employerTradingName)}</EmployerName>`
      : '',
    `</EmpRefs>`,
    `<RelatedTaxYear>${escapeXml(relatedYear)}</RelatedTaxYear>`,
    `<PeriodNumber>${period.taxMonth}</PeriodNumber>`,
    payload.indicators.noPaymentThisPeriod ? `<NoPaymentForPeriod>yes</NoPaymentForPeriod>` : '',
    payload.indicators.employmentAllowanceClaimed
      ? `<EmpAllceInd>yes</EmpAllceInd>`
      : '',
    recoveriesXml ? `<RecoverableAmountsYTD>${recoveriesXml}</RecoverableAmountsYTD>` : '',
    `</EmployerPaymentSummary>`,
    `</IRenvelope>`,
  ]
    .filter(Boolean)
    .join('')
}

export function epsMessageClass(): string {
  return 'HMRC-PAYE-RTI-EPS'
}
