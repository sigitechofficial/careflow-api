/**
 * Which broad billing type (FundingType.code) a funding route (ServiceUserFundingType.code) comes under.
 * Mirrors migration 20261228093000_funding_route_billing_type. Routes with no clear type return null and are
 * set by a manager in Settings -> Funding types.
 */
const EXACT: Record<string, string> = {
  FUNDING_UNKNOWN: 'UNKNOWN',
  NOT_YET_ASSESSED: 'UNKNOWN',
  ORDINARY_RESIDENCE_DISPUTE: 'UNKNOWN',
  HOSPITAL_DISCHARGE_PENDING: 'UNKNOWN',
  CHC_CHECKLIST_NOT_PASSED: 'UNKNOWN',
  CHC_FAST_TRACK_ENDED: 'UNKNOWN',
  WALES_DIRECT_PAYMENT: 'DIRECT_PAYMENT',
  INDIVIDUAL_SERVICE_FUND: 'DIRECT_PAYMENT',
  NHS_DIRECT_PAYMENT_HEALTH: 'DIRECT_PAYMENT',
  SCOTLAND_SDS: 'DIRECT_PAYMENT',
  PERSONAL_BUDGET_MIXED: 'MIXED',
  INTEGRATED_PERSONAL_BUDGET: 'MIXED',
  LA_SECTION_75: 'MIXED',
  LA_PARTIAL: 'MIXED',
  PERSONAL_HEALTH_BUDGET: 'NHS',
  HOSPITAL_NHS_INPATIENT: 'NHS',
  MHA_S117_AFTERCARE: 'NHS',
  NI_HSC_TRUST: 'NHS',
  WALES_LA: 'LOCAL_AUTHORITY',
  CARE_ACT_ORDINARY_RESIDENCE: 'LOCAL_AUTHORITY',
  SCOTLAND_HSCP: 'LOCAL_AUTHORITY',
  DOLS_PLACEMENT: 'LOCAL_AUTHORITY',
  BRIDGING_SHORT_TERM: 'LOCAL_AUTHORITY',
  CONTINGENCY_FUND: 'LOCAL_AUTHORITY',
  MARKET_SUSTAINABILITY: 'LOCAL_AUTHORITY',
  NI_SELF_FUNDED: 'SELF_FUNDED',
  LPA_FUNDS: 'SELF_FUNDED',
  COURT_OF_PROTECTION: 'SELF_FUNDED',
  INSURANCE_PAYOUT: 'SELF_FUNDED',
  LEGAL_SETTLEMENT: 'SELF_FUNDED',
};

const BILLING_CODES = ['PRIVATE', 'LOCAL_AUTHORITY', 'NHS', 'DIRECT_PAYMENT', 'MIXED', 'SELF_FUNDED', 'FAMILY_FUNDED', 'UNKNOWN'];

export function billingCodeForFundingRoute(code: string): string | null {
  if (BILLING_CODES.includes(code)) return code;
  if (EXACT[code]) return EXACT[code];
  if (code.startsWith('DP_')) return 'DIRECT_PAYMENT';
  if (code.startsWith('MIXED_')) return 'MIXED';
  if (code.startsWith('NHS_')) return 'NHS';
  if (code.startsWith('LA_')) return 'LOCAL_AUTHORITY';
  if (code.startsWith('FAMILY_')) return 'FAMILY_FUNDED';
  if (code.startsWith('SELF_') || code.startsWith('BENEFIT_')) return 'SELF_FUNDED';
  return null;
}
