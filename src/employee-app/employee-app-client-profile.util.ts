import { InitialAssessmentRiskType } from '@prisma/client';

export function profileRiskLabel(risk: InitialAssessmentRiskType): string {
  switch (risk) {
    case InitialAssessmentRiskType.FALLS:
      return 'Falls risk';
    case InitialAssessmentRiskType.HYDRATION:
      return 'Dehydration risk';
    case InitialAssessmentRiskType.SKIN_INTEGRITY:
      return 'Pressure ulcer risk';
    case InitialAssessmentRiskType.MOVING_HANDLING:
      return 'Moving & handling risk';
    case InitialAssessmentRiskType.LONE_WORKER:
      return 'Lone worker risk';
    default:
      return 'Risk flagged';
  }
}

export function extractProfileCommunicationNotes(text: string): string[] {
  const items: string[] = [];
  const lower = text.toLowerCase();
  if (/glasses|spectacle/.test(lower)) items.push('Reading glasses');
  if (/hard of hearing|hearing aid|deaf/.test(lower)) items.push('Hard of hearing');
  if (/announce yourself|knock before/.test(lower)) items.push('Announce yourself');
  return items;
}

export function mapProfileCommunication(careInstructions?: string | null): {
  items: string[];
  chip: string | null;
  note: string | null;
} | null {
  const text = careInstructions?.trim() || '';
  const items = extractProfileCommunicationNotes(text);
  if (!items.length && !text) return null;
  const chip = items[0] ?? null;
  const rest = items.slice(1).join(' · ');
  const note = text && text !== chip ? text : rest || null;
  return { items, chip, note };
}

export function mapProfileContact(c: {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  relationshipType: { name: string } | null;
}): { title: string; subtitle: string | null; type: string } {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const phone = c.mobile?.trim() || c.phone?.trim() || null;
  const rel = c.relationshipType?.name?.trim() || null;
  const title = name || rel || (c.isEmergencyContact ? 'Emergency contact' : 'Contact');
  const subtitle =
    [rel && rel !== title ? rel : null, phone].filter(Boolean).join(' · ') || null;
  const type = c.isEmergencyContact ? 'emergency' : c.isPrimary ? 'primary' : 'nok';
  return { title, subtitle, type };
}

export function mapProfileGp(pack?: { gpName: string | null; gpSurgery: string | null } | null): {
  name: string | null;
  surgery: string | null;
} | null {
  const name = pack?.gpName?.trim() || null;
  const surgery = pack?.gpSurgery?.trim() || null;
  if (!name && !surgery) return null;
  return { name, surgery };
}

export function gpAsContact(gp: { name: string | null; surgery: string | null }): {
  title: string;
  subtitle: string | null;
  type: 'gp';
} {
  return {
    title: gp.name || 'GP',
    subtitle: gp.surgery,
    type: 'gp',
  };
}
