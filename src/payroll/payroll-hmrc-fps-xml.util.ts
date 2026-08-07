import type { CareFpsPayload } from './types/fps-payload.types'
import { escapeXml } from './payroll-hmrc-govtalk.util'

/** Care → HMRC IR FPS body schema marker (full XSD recognition is iterative). */
export const CARE_RTI_FPS_BODY_VERSION = 'care-rti-fps-xml-1'

function money(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2)
}

function mapPayFrequency(code: string): string {
  switch (code.trim().toUpperCase()) {
    case 'WEEKLY':
      return 'W1'
    case 'FORTNIGHTLY':
      return 'W2'
    case 'FOUR_WEEKLY':
      return 'W4'
    case 'MONTHLY':
      return 'M1'
    default:
      return code.trim() || 'M1'
  }
}

function relatedTaxYearYy(code: string): string {
  // Care tax year code e.g. 2026-27 → HMRC relatedTaxYear 26-27
  const m = code.trim().match(/^(\d{2})?(\d{2})-(\d{2})$/)
  if (m) return `${m[2]}-${m[3]}`
  if (/^\d{2}-\d{2}$/.test(code.trim())) return code.trim()
  return code.trim()
}

/**
 * Map Care FPS preview JSON into an RTI-shaped FPS XML body for GovTalk.
 * Not a claim of full HMRC XSD recognition — field names follow common IR-FPS layout.
 */
export function buildCareRtiFpsBodyXml(payload: CareFpsPayload): string {
  const emp = payload.employer
  const sub = payload.submission
  const relatedYear = relatedTaxYearYy(sub.relatedTaxYear)
  const freq = mapPayFrequency(sub.payFrequency)

  const employeeBlocks = payload.employees
    .map((e) => {
      const starter =
        e.employment.isFirstPayOfEmployment && !e.employment.p45Received
          ? `<Starter><StartDate>${escapeXml(e.employment.startingDate ?? '')}</StartDate>${
              e.employment.starterDeclaration
                ? `<StarterDeclaration>${escapeXml(e.employment.starterDeclaration)}</StarterDeclaration>`
                : ''
            }</Starter>`
          : ''
      const leaver = e.employment.isLastPayOfEmployment
        ? `<LeavingDate>${escapeXml(e.employment.leavingDate ?? sub.paymentDate)}</LeavingDate>`
        : ''

      return [
        `<Employee>`,
        `<EmployeeDetails>`,
        e.nino ? `<NINO>${escapeXml(e.nino.replace(/\s+/g, '').toUpperCase())}</NINO>` : '',
        `<Name>`,
        `<Forename>${escapeXml(e.name.forename)}</Forename>`,
        `<Surname>${escapeXml(e.name.surname)}</Surname>`,
        `</Name>`,
        e.birthDate ? `<BirthDate>${escapeXml(e.birthDate)}</BirthDate>` : '',
        e.gender ? `<Gender>${escapeXml(e.gender)}</Gender>` : '',
        `<Address>`,
        e.address.line1 ? `<Line>${escapeXml(e.address.line1)}</Line>` : '',
        e.address.line2 ? `<Line>${escapeXml(e.address.line2)}</Line>` : '',
        e.address.city ? `<Line>${escapeXml(e.address.city)}</Line>` : '',
        e.address.county ? `<Line>${escapeXml(e.address.county)}</Line>` : '',
        e.address.postcode ? `<UKPostcode>${escapeXml(e.address.postcode)}</UKPostcode>` : '',
        `</Address>`,
        `</EmployeeDetails>`,
        `<Employment>`,
        e.payId ? `<PayId>${escapeXml(e.payId)}</PayId>` : '',
        `<Payment>`,
        `<PayFreq>${escapeXml(freq)}</PayFreq>`,
        `<PmtDate>${escapeXml(sub.paymentDate)}</PmtDate>`,
        `<PeriodNumber>${sub.taxMonthOrWeekNumber}</PeriodNumber>`,
        e.employment.hoursNormallyWorked
          ? `<HoursWorked>${escapeXml(e.employment.hoursNormallyWorked)}</HoursWorked>`
          : '',
        `<TaxCode>${escapeXml(e.employment.taxCode ?? '')}</TaxCode>`,
        e.employment.week1Month1 ? `<Week1Month1Indicator>yes</Week1Month1Indicator>` : '',
        `<TaxablePay>${money(e.payment.taxablePay)}</TaxablePay>`,
        `<TaxDeductedOrRefunded>${money(e.payment.taxDeductedOrRefunded)}</TaxDeductedOrRefunded>`,
        `<TaxablePayToDate>${money(e.payment.taxablePayYtd)}</TaxablePayToDate>`,
        `<TotalTaxToDate>${money(e.payment.totalTaxYtd)}</TotalTaxToDate>`,
        `<GrossEarningsForNICsInPd>${money(e.payment.periodGross)}</GrossEarningsForNICsInPd>`,
        `<GrossEarningsForNICsYTD>${money(e.payment.grossPayYtd)}</GrossEarningsForNICsYTD>`,
        e.employment.niCategory
          ? `<NIlettersAndValues><NIletter>${escapeXml(e.employment.niCategory)}</NIletter><EmpeeContribnsInPd>${money(e.payment.employeeNiContribution)}</EmpeeContribnsInPd><EmpeeContribnsYTD>${money(e.payment.employeeNiYtd)}</EmpeeContribnsYTD><EmperContribnsInPd>${money(e.payment.employerNiContribution)}</EmperContribnsInPd><EmperContribnsYTD>${money(e.payment.employerNiYtd)}</EmperContribnsYTD></NIlettersAndValues>`
          : '',
        `</Payment>`,
        starter,
        leaver,
        `</Employment>`,
        `</Employee>`,
      ]
        .filter(Boolean)
        .join('')
    })
    .join('')

  return [
    `<IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/PAYE/RTI/FullPaymentSubmission/24-25/1" careBodyVersion="${CARE_RTI_FPS_BODY_VERSION}">`,
    `<IRheader>`,
    `<Keys>`,
    `<Key Type="TaxOfficeNumber">${escapeXml(emp.hmrcOfficeNumber)}</Key>`,
    `<Key Type="TaxOfficeReference">${escapeXml(emp.employerPayeReference)}</Key>`,
    `</Keys>`,
    `<PeriodEnd>${escapeXml(sub.periodEnd)}</PeriodEnd>`,
    `<DefaultCurrency>GBP</DefaultCurrency>`,
    `<IRmark Type="calculation">CarePreview</IRmark>`,
    `<Sender>Employer</Sender>`,
    `</IRheader>`,
    `<FullPaymentSubmission>`,
    `<RelatedTaxYear>${escapeXml(relatedYear)}</RelatedTaxYear>`,
    emp.employerTradingName
      ? `<EmpRefs><OfficeNo>${escapeXml(emp.hmrcOfficeNumber)}</OfficeNo><PayeRef>${escapeXml(emp.employerPayeReference)}</PayeRef><AORef>${escapeXml(emp.accountsOfficeReference)}</AORef><EmployerName>${escapeXml(emp.employerTradingName)}</EmployerName></EmpRefs>`
      : `<EmpRefs><OfficeNo>${escapeXml(emp.hmrcOfficeNumber)}</OfficeNo><PayeRef>${escapeXml(emp.employerPayeReference)}</PayeRef><AORef>${escapeXml(emp.accountsOfficeReference)}</AORef></EmpRefs>`,
    employeeBlocks,
    `</FullPaymentSubmission>`,
    `</IRenvelope>`,
  ].join('')
}

export function fpsMessageClassForTaxYear(relatedTaxYear: string): string {
  // HMRC message class is stable for FPS; year is in the body schema namespace.
  void relatedTaxYear
  return 'HMRC-PAYE-RTI-FPS'
}
