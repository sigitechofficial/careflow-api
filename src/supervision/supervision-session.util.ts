import type { SupervisionSessionStatus } from '@prisma/client';
import type { SupervisionSettings } from '../organisation-general-settings/supervision-settings.util';

/** Content (form answers, summary, dates, attendees) can change only before the supervisor signs. */
export function isSessionEditable(status: SupervisionSessionStatus): boolean {
  return status === 'SCHEDULED' || status === 'IN_PROGRESS';
}

/** Text in a rich-text (HTML) note, so an empty editor ("<p></p>", "<p><br></p>") counts as empty. */
export function richTextHasContent(html: string | null | undefined): boolean {
  if (!html?.trim()) return false;
  if (/<(img|table)\b/i.test(html)) return true;
  return (
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim().length > 0
  );
}

/**
 * Status after a signature: COMPLETED once the supervisor has signed and, when the setting asks
 * for it, every carer has signed or commented; otherwise AWAITING_SIGN_OFF.
 */
export function statusAfterSignature(
  session: {
    supervisorSignedAt: Date | null;
    attendees: Array<{ signedAt: Date | null }>;
  },
  settings: Pick<SupervisionSettings, 'requireCarerSignature'>,
): SupervisionSessionStatus {
  if (!session.supervisorSignedAt) return 'IN_PROGRESS';
  const carersDone =
    !settings.requireCarerSignature || session.attendees.every((a) => a.signedAt != null);
  return carersDone ? 'COMPLETED' : 'AWAITING_SIGN_OFF';
}
