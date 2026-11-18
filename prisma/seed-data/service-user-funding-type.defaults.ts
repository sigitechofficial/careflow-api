/**
 * Funding routes offered for a home care service (how the care is paid for), grouped by funder type.
 * Trimmed from 111 in migration 20270119100000: care settings (residential, day care...), benefits
 * (PIP, DLA...) and rarely used variants were switched off. Managers can add more in Settings.
 */
export const DEFAULT_SERVICE_USER_FUNDING_TYPES: Array<{ name: string; code: string }> = [
  // —— Local authority ——
  { name: 'Local authority — spot purchase', code: 'LA_SPOT_PURCHASE' },
  { name: 'Local authority — framework contract', code: 'LA_FRAMEWORK' },
  { name: 'Local authority — block contract', code: 'LA_BLOCK_CONTRACT' },
  { name: 'Local authority — enablement / reablement', code: 'LA_ENABLEMENT' },
  { name: 'Local authority — respite / short break', code: 'LA_RESPITE' },
  { name: 'Local authority — emergency / crisis', code: 'LA_EMERGENCY' },
  // —— NHS ——
  { name: 'NHS Continuing Healthcare (CHC)', code: 'NHS_CHC' },
  { name: 'NHS CHC — fast track (end of life)', code: 'NHS_CHC_FAST_TRACK' },
  { name: 'NHS Section 117 aftercare', code: 'NHS_SECTION_117' },
  { name: 'NHS discharge to assess', code: 'NHS_DISCHARGE_TO_ASSESS' },
  { name: 'Personal health budget', code: 'PERSONAL_HEALTH_BUDGET' },
  // —— Direct payment ——
  { name: 'Direct payment — self-managed', code: 'DP_SELF_MANAGED' },
  { name: 'Direct payment — managed account', code: 'DP_MANAGED_ACCOUNT' },
  { name: 'Individual service fund (ISF)', code: 'INDIVIDUAL_SERVICE_FUND' },
  // —— Self-funded / private ——
  { name: 'Self-funded — full cost', code: 'SELF_FULL' },
  { name: 'Self-funded — third-party top-up', code: 'SELF_THIRD_PARTY_TOP_UP' },
  { name: 'Court of Protection deputy', code: 'COURT_OF_PROTECTION' },
  { name: 'Attorney / lasting power of attorney funds', code: 'LPA_FUNDS' },
  // —— Not known yet ——
  { name: 'Not yet assessed', code: 'NOT_YET_ASSESSED' },
];
