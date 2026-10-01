import type { SubmissionAnswerForRules } from '../../initial-assessments/initial-assessment-care-plan-rules.util';
import { findIaAnswer, resolveIaBooleanValue, resolveIaRawValue } from './ia-answer-resolver.util';

const CONSENT_METHOD_LABEL: Record<string, string> = {
  written: 'written',
  verbal: 'verbal',
  non_verbal: 'non-verbal / implied',
  other: 'other',
};

const LEGAL_AUTHORITY_LABEL: Record<string, string> = {
  no: 'None',
  hw_lpa: 'Health & Welfare LPA',
  deputy: 'Court-appointed Deputy',
  court_order_other: 'Court Order / other legal authority',
  unsure: 'Unsure — to be checked',
};

function text(answers: SubmissionAnswerForRules[], fieldKey: string): string | null {
  const raw = findIaAnswer(answers, { fieldKey })?.textValue;
  const plain = raw?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return plain || null;
}

function yesNo(answers: SubmissionAnswerForRules[], fieldKey: string): boolean | null {
  return resolveIaBooleanValue(findIaAnswer(answers, { fieldKey }));
}

function selected(answers: SubmissionAnswerForRules[], fieldKey: string): string | null {
  return resolveIaRawValue(findIaAnswer(answers, { fieldKey }));
}

/**
 * Readable IA consent / capacity summary for care plans (Consent tab questions). Older IAs used
 * "Consent given by" and "Capacity … appears intact?" — those still read through the legacy lines.
 */
export function iaConsentCapacitySummary(answers: SubmissionAnswerForRules[]): string | null {
  const lines: string[] = [];

  const consent = yesNo(answers, 'consentToAssessment');
  if (consent === true) {
    const method = selected(answers, 'consentMethod');
    lines.push(`Consented to assessment${method ? ` (${CONSENT_METHOD_LABEL[method] ?? method})` : ''}`);
  } else if (consent === false) {
    const reason = text(answers, 'consentToAssessmentNoReason');
    lines.push(`Did not consent to assessment${reason ? ` — ${reason}` : ''}`);
  }

  const doubt = yesNo(answers, 'capacityDoubt');
  if (doubt === true) {
    const reason = text(answers, 'capacityDoubtReason');
    lines.push(`Reason to doubt capacity${reason ? `: ${reason}` : ''} — MCA required`);
  } else if (doubt === false) {
    lines.push('No reason to doubt capacity for this decision');
  } else {
    const legacyIntact = resolveIaBooleanValue(
      findIaAnswer(answers, { specRef: '2.4', questionTextContains: 'capacity to consent' }),
    );
    if (legacyIntact != null) {
      lines.push(legacyIntact ? 'Capacity to consent appears intact' : 'Capacity to consent does not appear intact');
    }
  }

  const authority = selected(answers, 'legalAuthority');
  if (authority && authority !== 'no') {
    const name = text(answers, 'legalAuthorityName');
    const role = text(answers, 'legalAuthorityRole');
    const who = [name, role ? `(${role})` : null].filter(Boolean).join(' ');
    lines.push(`Legal authority: ${LEGAL_AUTHORITY_LABEL[authority] ?? authority}${who ? ` — ${who}` : ''}`);
  } else if (!authority) {
    const legacyGivenBy = selected(answers, 'consentGivenBy');
    if (legacyGivenBy) {
      // Older IAs only — a family member / representative is never a legal decision-maker on their own.
      const label =
        legacyGivenBy === 'representative'
          ? 'representative (no legal authority recorded)'
          : legacyGivenBy.replace(/_/g, ' ');
      lines.push(`Consent given by: ${label}`);
    }
  }

  const support = text(answers, 'communicationSupportDetails');
  if (yesNo(answers, 'communicationSupportRequired') === true && support) {
    lines.push(`Communication support: ${support}`);
  }
  const refused = text(answers, 'partialConsentRefusalDetails');
  if (yesNo(answers, 'partialConsentRefusal') === true && refused) lines.push(`Does not consent to / conditions: ${refused}`);
  const restrictions = text(answers, 'consentRestrictionsDetails');
  if (yesNo(answers, 'consentRestrictions') === true && restrictions) {
    lines.push(`Consent restrictions / preferences: ${restrictions}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}
