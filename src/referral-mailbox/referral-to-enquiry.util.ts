import { EnquiryFundingType, EnquiryKind, EnquiryReceivedVia, EnquirySource, EnquiryType } from '@prisma/client';
import type { CreateEnquiryDto } from '../crm/dto/create-enquiry.dto';
import type { ReferralExtraction } from './referral-extraction.service';

const t = (v: string | null | undefined) => (v ?? '').trim() || undefined;
const isoDate = (v: string | null | undefined) => {
  const s = t(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};
const num = (v: string | null | undefined) => {
  const n = Number(t(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Who sent it, from the referrer's organisation and role. */
export function enquirySourceFor(e: ReferralExtraction): EnquirySource {
  const s = `${e.referrer.organisation} ${e.referrer.role}`.toLowerCase();
  if (/hospital|discharge|ward/.test(s)) return EnquirySource.HOSPITAL;
  if (/social worker|social care/.test(s)) return EnquirySource.SOCIAL_WORKER;
  if (/\bgp\b|surgery|practice|medical centre/.test(s)) return EnquirySource.GP;
  if (/nhs|icb|trust|chc|community health/.test(s)) return EnquirySource.NHS;
  if (/council|borough|county|local authority|city of/.test(s)) return EnquirySource.LOCAL_AUTHORITY;
  if (e.contact.relationship && !e.referrer.organisation) return EnquirySource.FAMILY;
  return EnquirySource.OTHER;
}

function fundingFor(e: ReferralExtraction): { fundingType?: EnquiryFundingType; enquiryType?: EnquiryType } {
  switch (e.funding.type) {
    case 'LOCAL_AUTHORITY':
    case 'DIRECT_PAYMENT':
      return { fundingType: EnquiryFundingType.LOCAL_AUTHORITY, enquiryType: EnquiryType.LOCAL_AUTHORITY };
    case 'NHS':
      return { fundingType: EnquiryFundingType.NHS_CHC, enquiryType: EnquiryType.NHS };
    case 'PRIVATE':
      return { fundingType: EnquiryFundingType.SELF_FUNDED, enquiryType: EnquiryType.PRIVATE };
    case 'MIXED':
      return { fundingType: EnquiryFundingType.MIXED };
    default:
      return { fundingType: EnquiryFundingType.UNKNOWN };
  }
}

/** The "needs" text on the enquiry: care needs, conditions, risks, visit details and what is still missing. */
export function enquiryNeedsText(e: ReferralExtraction): string {
  const lines: string[] = [];
  if (t(e.careNeeds)) lines.push(e.careNeeds.trim());
  if (e.conditions.length) lines.push(`Conditions: ${e.conditions.join('; ')}`);
  if (e.risks.length) lines.push(`Risks: ${e.risks.join('; ')}`);
  const c = e.care;
  const visit = [
    t(c.visitTimes) && `Visits: ${c.visitTimes}`,
    t(c.carersPerVisit) && `Carers per visit: ${c.carersPerVisit}`,
    t(c.genderPreference) && `Carer preference: ${c.genderPreference}`,
    t(c.languageOrCulture) && `Language / culture: ${c.languageOrCulture}`,
    t(e.person.livesAlone) && `Lives alone: ${e.person.livesAlone}`,
  ].filter(Boolean);
  if (visit.length) lines.push(visit.join('. '));
  const tasks = (e.visits ?? []).filter((v) => t(v.tasks)).map((v) => `${v.label || 'Visit'}: ${v.tasks!.trim()}`);
  if (tasks.length) lines.push(`Tasks at each visit:\n- ${tasks.join('\n- ')}`);
  const d = e.details;
  if (d) {
    const k = d.keyFacts ?? ({} as Partial<NonNullable<ReferralExtraction['details']>['keyFacts']>);
    const fact = (section: string, label: RegExp) =>
      d.sections?.find((s) => s.section === section && label.test(s.label))?.value;
    const key = [
      t(k.packageType) && `Package: ${k.packageType}`,
      t(k.respondBy) && `Reply needed by: ${k.respondBy}`,
      t(k.currentLocation) && `Currently at: ${k.currentLocation}`,
      t(k.access) && `Access: ${k.access}`,
      d.allergies?.length && `Allergies: ${d.allergies.join('; ')}`,
      t(k.resuscitation) && `Resuscitation: ${k.resuscitation}`,
      t(k.medicationSupport) && `Medication support: ${k.medicationSupport}`,
      t(k.transfers) && `Transfers: ${k.transfers}`,
      d.equipment?.length && `Equipment: ${d.equipment.map((x) => (t(x.status) ? `${x.item} (${x.status})` : x.item)).join('; ')}`,
      t(fact('Capacity and consent', /capacity/i)) && `Capacity: ${fact('Capacity and consent', /capacity/i)}`,
      t(fact('Safeguarding', /./)) && `Safeguarding: ${fact('Safeguarding', /./)}`,
    ].filter(Boolean);
    if (key.length) lines.push(`Key details:\n- ${key.join('\n- ')}`);
  }
  if (t(e.funding.details)) lines.push(`Funding: ${e.funding.details}`);
  if (e.questionsAsked.length) lines.push(`Questions from the referrer:\n- ${e.questionsAsked.join('\n- ')}`);
  if (e.missingInformation.length) lines.push(`Still needed:\n- ${e.missingInformation.join('\n- ')}`);
  return lines.join('\n\n').slice(0, 10_000);
}

/** Enquiry fields from what Claude read; staff review the enquiry afterwards. */
export function enquiryFromReferral(
  e: ReferralExtraction,
  email: { fromName: string | null; fromEmail: string | null; receivedAt: Date },
  locationId: string,
): CreateEnquiryDto {
  const professional = Boolean(t(e.referrer.organisation));
  const contactName = professional ? t(e.referrer.name) ?? t(email.fromName) : t(e.contact.name) ?? t(email.fromName);
  return {
    kind: professional ? EnquiryKind.REFERRAL : EnquiryKind.ENQUIRY,
    referringOrganisation: professional ? t(e.referrer.organisation) : undefined,
    referrerRole: professional ? t(e.referrer.role) : undefined,
    referralReference: professional ? t(e.referrer.reference) : undefined,
    referralDate: professional ? email.receivedAt.toISOString().slice(0, 10) : undefined,
    firstName: t(e.person.firstName) ?? 'Unknown',
    lastName: t(e.person.lastName) ?? 'Unknown',
    dateOfBirth: isoDate(e.person.dateOfBirth),
    contactName,
    contactRelationship: professional ? t(e.referrer.role) : t(e.contact.relationship),
    contactPhone: professional ? t(e.referrer.phone) : t(e.contact.phone) ?? t(e.person.phone),
    contactEmail: professional ? t(e.referrer.email) ?? t(email.fromEmail) : t(e.contact.email) ?? t(email.fromEmail),
    source: enquirySourceFor(e),
    sourceDetail: 'Referrals mailbox',
    urgency: e.urgency,
    needs: enquiryNeedsText(e) || undefined,
    receivedVia: EnquiryReceivedVia.EMAIL,
    receivedAt: email.receivedAt.toISOString(),
    sentAt: email.receivedAt.toISOString(),
    addressLine: t(e.person.addressLine),
    postcode: t(e.person.postcode)?.toUpperCase(),
    ...fundingFor(e),
    funderName: t(e.funding.funderName),
    hoursPerWeek: num(e.care.hoursPerWeek),
    visitsPerDay: num(e.care.visitsPerDay),
    requestedStartDate: isoDate(e.care.requestedStartDate),
    locationId,
  } as CreateEnquiryDto;
}
