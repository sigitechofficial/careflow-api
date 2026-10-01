/**
 * Legal authority coverage — which registered authority (if any) lets someone else make a decision for
 * the person. Pure rules, mirrored in careflow-admin `utils/legal-authority-coverage.ts` — change both.
 *
 * - An attorney / deputy acts only for decisions the person lacks capacity to make (MCA 2005 s9, s16).
 * - A Property & Finance LPA, an EPA, a property deputy or a DWP appointee never gives authority over
 *   care or health; next of kin is never an authority.
 * - An attorney or deputy cannot authorise a deprivation of liberty — only the Court of Protection
 *   (or DoLS in a care home / hospital).
 * - Only an authority whose document was seen or checked with the issuer counts; "reported" does not.
 */

export type LegalAuthorityCategory =
  | 'LPA_HEALTH_WELFARE'
  | 'LPA_PROPERTY_FINANCE'
  | 'EPA'
  | 'DEPUTY_HEALTH_WELFARE'
  | 'DEPUTY_PROPERTY_AFFAIRS'
  | 'COURT_ORDER'
  | 'APPOINTEE'
  | 'OTHER';

export type LegalAuthorityVerification = 'REPORTED' | 'DOCUMENT_SEEN' | 'VERIFIED' | 'NOT_VALID';

export type LegalAuthorityDomain = 'care' | 'finance' | 'liberty';

export const LEGAL_AUTHORITY_CATEGORY_LABEL: Record<LegalAuthorityCategory, string> = {
  LPA_HEALTH_WELFARE: 'Health & welfare LPA',
  LPA_PROPERTY_FINANCE: 'Property & financial affairs LPA',
  EPA: 'Enduring power of attorney (finances only)',
  DEPUTY_HEALTH_WELFARE: 'Court-appointed deputy — health & welfare',
  DEPUTY_PROPERTY_AFFAIRS: 'Court-appointed deputy — property & affairs',
  COURT_ORDER: 'Court of Protection order',
  APPOINTEE: 'DWP appointee (benefits only)',
  OTHER: 'Other',
};

export const LEGAL_AUTHORITY_VERIFICATION_LABEL: Record<LegalAuthorityVerification, string> = {
  REPORTED: 'Reported — not yet seen',
  DOCUMENT_SEEN: 'Document seen',
  VERIFIED: 'Verified with issuer',
  NOT_VALID: 'Not valid (revoked / expired / not registered)',
};

/** What each category can ever cover. A court order covers only what the order says (checked by a manager). */
const CATEGORY_DOMAINS: Record<LegalAuthorityCategory, LegalAuthorityDomain[]> = {
  LPA_HEALTH_WELFARE: ['care'],
  DEPUTY_HEALTH_WELFARE: ['care'],
  COURT_ORDER: ['care', 'liberty'],
  LPA_PROPERTY_FINANCE: ['finance'],
  EPA: ['finance'],
  DEPUTY_PROPERTY_AFFAIRS: ['finance'],
  APPOINTEE: ['finance'],
  OTHER: [],
};

/** Capacity decision types (see capacity-decisions) → the domain of authority they need. */
const DECISION_DOMAIN: Record<string, LegalAuthorityDomain> = {
  finance_support: 'finance',
  care_arrangements: 'liberty',
};

export function decisionDomain(decision: string | undefined): LegalAuthorityDomain {
  return (decision && DECISION_DOMAIN[decision]) || 'care';
}

export function categoryGivesCareAuthority(category: LegalAuthorityCategory): boolean {
  return CATEGORY_DOMAINS[category].includes('care');
}

export type LegalAuthorityRow = {
  id: string;
  category: LegalAuthorityCategory;
  holderName: string;
  verificationStatus: LegalAuthorityVerification;
  /** YYYY-MM-DD or ISO; an order past this date no longer counts. */
  expiresOn?: string | null;
  isActive?: boolean;
  scope?: string;
};

export type LegalAuthorityCoverage =
  | { status: 'covered'; authority: LegalAuthorityRow; note: string }
  | { status: 'unverified'; authority: LegalAuthorityRow; note: string }
  | { status: 'none'; note: string };

function inForce(a: LegalAuthorityRow, today: string): boolean {
  if (a.isActive === false || a.verificationStatus === 'NOT_VALID') return false;
  if (a.expiresOn && a.expiresOn.slice(0, 10) < today) return false;
  return true;
}

const EVIDENCED: LegalAuthorityVerification[] = ['DOCUMENT_SEEN', 'VERIFIED'];

/** Does any authority on the register cover this decision? `today` = YYYY-MM-DD. */
export function authorityCoverage(
  authorities: LegalAuthorityRow[],
  decision: string | undefined,
  today: string,
): LegalAuthorityCoverage {
  const domain = decisionDomain(decision);
  const candidates = authorities.filter((a) => inForce(a, today) && CATEGORY_DOMAINS[a.category].includes(domain));
  const evidenced = candidates.find((a) => EVIDENCED.includes(a.verificationStatus));
  const onlyIfLacking = 'Only for decisions the person lacks capacity to make — still involve them.';
  if (evidenced) {
    const scopeNote =
      evidenced.category === 'COURT_ORDER' ? ' Check the order covers this decision.' : '';
    return {
      status: 'covered',
      authority: evidenced,
      note: `${LEGAL_AUTHORITY_CATEGORY_LABEL[evidenced.category]} (${evidenced.holderName}). ${onlyIfLacking}${scopeNote}`,
    };
  }
  if (candidates[0]) {
    return {
      status: 'unverified',
      authority: candidates[0],
      note: `${LEGAL_AUTHORITY_CATEGORY_LABEL[candidates[0].category]} reported but not yet seen — cannot be relied on until the document is checked.`,
    };
  }
  return {
    status: 'none',
    note:
      domain === 'liberty'
        ? 'Only the Court of Protection (or DoLS in a care home / hospital) can authorise a deprivation of liberty.'
        : domain === 'finance'
          ? 'No finance authority recorded.'
          : 'No health & welfare authority recorded — a best-interests decision is needed. Next of kin and finance attorneys cannot decide care.',
  };
}

/** Carer-facing list: only evidenced, in-force authorities; finance ones say they do not cover care. */
export function carerAuthorityCards(authorities: LegalAuthorityRow[], today: string) {
  return authorities
    .filter((a) => inForce(a, today) && EVIDENCED.includes(a.verificationStatus) && a.category !== 'OTHER')
    .map((a) => ({
      id: a.id,
      typeLabel: LEGAL_AUTHORITY_CATEGORY_LABEL[a.category],
      holderName: a.holderName,
      coversCare: categoryGivesCareAuthority(a.category),
      scopeNote: categoryGivesCareAuthority(a.category)
        ? 'Can make care / health decisions only when the person lacks capacity for that decision. Always involve the person.'
        : 'Finances only — this does NOT give anyone authority over care or health decisions.',
    }));
}

/** Consent-tab `legalAuthority` answer → a register category proposal (never overwrites the register). */
export function categoryFromConsentAnswer(value: string | undefined): LegalAuthorityCategory | null {
  if (value === 'hw_lpa') return 'LPA_HEALTH_WELFARE';
  if (value === 'deputy') return 'DEPUTY_HEALTH_WELFARE';
  if (value === 'court_order_other') return 'COURT_ORDER';
  return null;
}
