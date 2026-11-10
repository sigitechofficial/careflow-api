/** The ways CareFlow contacts people. WhatsApp has no sender yet; its switch is ready for when one is added. */
export const MESSAGE_CHANNELS = ['EMAIL', 'TEXT', 'WHATSAPP', 'PUSH'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export type MessageKind = {
  /** Stored in settings as "<CHANNEL>:<key>" when switched off. */
  key: string;
  channel: MessageChannel;
  label: string;
  description: string;
  /**
   * Goes only to the person who asked for it (a password reset or account invitation), so the allowed list never
   * holds it back: otherwise nobody outside the list could sign in while sending is limited. It can still be
   * switched off, with a warning on the settings page.
   */
  essential?: boolean;
};

/** Every kind of message CareFlow sends. A sender that names no kind is treated as "other" for its channel. */
export const MESSAGE_KINDS: MessageKind[] = [
  // Email
  { channel: 'EMAIL', key: 'account', essential: true, label: 'Sign-in and password emails', description: 'Account invitations and password reset links.' },
  { channel: 'EMAIL', key: 'referral-replies', label: 'Referral replies', description: 'Replies to referrers from the referral mailbox, sent by staff or automatically.' },
  { channel: 'EMAIL', key: 'referral-test-copies', label: 'Referral test copies', description: 'Copies of test referrals and replies to the testers (outside production only).' },
  { channel: 'EMAIL', key: 'quotes', label: 'Quotes', description: 'Quotes emailed to enquirers from an enquiry.' },
  { channel: 'EMAIL', key: 'invoices', label: 'Invoices', description: 'Invoices emailed to funders and service users from an invoice run.' },
  { channel: 'EMAIL', key: 'surveys', label: 'Surveys', description: 'Survey invitations and reminders to service users, families, staff, applicants and outside people.' },
  { channel: 'EMAIL', key: 'absences', label: 'Staff absence emails', description: 'Absence requests and decisions.' },
  { channel: 'EMAIL', key: 'compliance-reminders', label: 'Compliance reminders', description: 'Staff documents and checks about to expire.' },
  { channel: 'EMAIL', key: 'supervision-reminders', label: 'Supervision reminders', description: 'Supervisions and appraisals due.' },
  { channel: 'EMAIL', key: 'platform-reports', label: 'Azure cost reports and alerts', description: 'Monthly Azure cost report and spend alerts to the platform team.' },
  { channel: 'EMAIL', key: 'test', label: 'Test messages', description: 'Sent from this page to check delivery.' },
  { channel: 'EMAIL', key: 'other', label: 'Other emails', description: 'Any email not listed above.' },
  // Text messages (SMS)
  { channel: 'TEXT', key: 'surveys', label: 'Survey texts', description: 'Survey invitations and reminders by text.' },
  { channel: 'TEXT', key: 'test', label: 'Test messages', description: 'Sent from this page to check delivery.' },
  { channel: 'TEXT', key: 'other', label: 'Other texts', description: 'Any text not listed above.' },
  // WhatsApp
  { channel: 'WHATSAPP', key: 'other', label: 'WhatsApp messages', description: 'All WhatsApp messages (no WhatsApp sender is set up yet).' },
  // Push notifications (carer app)
  { channel: 'PUSH', key: 'visits', label: 'Visit updates', description: 'New, changed and cancelled visits for carers.' },
  { channel: 'PUSH', key: 'carer-messages', label: 'Messages to carers', description: 'Messages sent to carers from Settings › Carer notifications.' },
  { channel: 'PUSH', key: 'care-plans', label: 'Care plan updates', description: 'A care plan changed for someone the carer visits.' },
  { channel: 'PUSH', key: 'policies', label: 'Policies to read', description: 'Policies the carer needs to read and acknowledge.' },
  { channel: 'PUSH', key: 'compliance-reminders', label: 'Compliance reminders', description: 'Carer documents and checks about to expire.' },
  { channel: 'PUSH', key: 'supervision-reminders', label: 'Supervision reminders', description: 'Supervisions and appraisals due.' },
  { channel: 'PUSH', key: 'surveys', label: 'Surveys', description: 'Staff surveys to fill in.' },
  { channel: 'PUSH', key: 'test', label: 'Test messages', description: 'Sent from this page to check delivery.' },
  { channel: 'PUSH', key: 'other', label: 'Other notifications', description: 'Any push notification not listed above.' },
];

export const kindId = (channel: MessageChannel, key: string) => `${channel}:${key}`;

/** The catalogue entry for a sender's kind; unknown kinds fall back to the channel's "other". */
export function findKind(channel: MessageChannel, key: string | undefined): MessageKind {
  return (
    MESSAGE_KINDS.find((k) => k.channel === channel && k.key === key) ??
    MESSAGE_KINDS.find((k) => k.channel === channel && k.key === 'other')!
  );
}
