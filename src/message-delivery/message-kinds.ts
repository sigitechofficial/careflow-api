/** The ways CareFlow contacts people. WhatsApp has no sender yet; its switches are ready for when one is added. */
export const MESSAGE_CHANNELS = ['EMAIL', 'TEXT', 'WHATSAPP', 'PUSH'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** Who a message goes to, in the order the settings page lists them. */
export const MESSAGE_AUDIENCES = {
  FUNDERS: { label: 'Councils, NHS & other funders', hint: 'Commissioners and finance teams who pay for care.' },
  REGULATORS: { label: 'CQC & safeguarding teams', hint: 'Notifications the law or our registration requires.' },
  REFERRERS: { label: 'Referrers & partner organisations', hint: 'Hospital discharge teams, social workers, charities and NGOs, and families who refer.' },
  PROFESSIONALS: { label: 'GPs, pharmacies & other professionals', hint: 'Health and social care professionals involved in someone’s care.' },
  PEOPLE: { label: 'Service users & families', hint: 'The people we support, their families and representatives.' },
  CARERS: { label: 'Carers & staff', hint: 'Everyone who works for us, in the field or the office.' },
  MANAGERS: { label: 'Managers & office', hint: 'Registered managers, supervisors, coordinators and on-call staff.' },
  APPLICANTS: { label: 'Job applicants & referees', hint: 'People applying to work for us, and their referees.' },
  PLATFORM: { label: 'Platform team', hint: 'The people who run CareFlow itself.' },
  ANY: { label: 'Anyone', hint: 'Test messages and anything not listed.' },
} as const;
export type MessageAudience = keyof typeof MESSAGE_AUDIENCES;

export type MessageKind = {
  /** Stored in settings as "<CHANNEL>:<key>" when switched off. Senders pass the key. */
  key: string;
  channel: MessageChannel;
  label: string;
  audience: MessageAudience[];
  /** Why it is sent: what it is for. */
  why: string;
  /** What makes CareFlow send it. */
  when: string;
  /** LIVE: CareFlow sends it today. TO_BUILD: needed, not built yet; its switch is ready and applies once built. */
  status: 'LIVE' | 'TO_BUILD';
  /** What goes wrong while it is switched off (shown as a warning). */
  ifOff?: string;
  /**
   * Goes only to the person who asked for it (a password reset or account invitation), so the allowed list never
   * holds it back: otherwise nobody outside the list could sign in while sending is limited. It can still be
   * switched off, with a warning on the settings page.
   */
  essential?: boolean;
};

const live = 'LIVE' as const;
const toBuild = 'TO_BUILD' as const;

/** Every message CareFlow sends, or will need to send. A sender that names no kind counts as its channel's "other". */
export const MESSAGE_KINDS: MessageKind[] = [
  /* ─── Email ─────────────────────────────────────────────────── */
  // Councils, NHS & funders
  { channel: 'EMAIL', key: 'invoices', status: live, audience: ['FUNDERS', 'PEOPLE'], label: 'Invoices', why: 'To get paid for the care we deliver: the invoice PDF for a service user and period.', when: 'Staff email an invoice from an invoice run (to the funder’s billing contact, or a private payer).', ifOff: 'Invoices are not emailed; send them another way or payment is delayed.' },
  { channel: 'EMAIL', key: 'invoice-reminders', status: toBuild, audience: ['FUNDERS', 'PEOPLE'], label: 'Overdue invoice reminders', why: 'To chase invoices that are past their due date.', when: 'An invoice passes its due date unpaid.' },
  { channel: 'EMAIL', key: 'package-start', status: toBuild, audience: ['FUNDERS', 'REFERRERS'], label: 'Care package start confirmation', why: 'Commissioners need to know care has started, from when, and at what hours, to authorise payment.', when: 'The first visit of a new package is completed.' },
  { channel: 'EMAIL', key: 'package-changes', status: toBuild, audience: ['FUNDERS'], label: 'Care package changes, suspensions and endings', why: 'Contracts require telling the funder when care is suspended (e.g. hospital admission), changed or ended.', when: 'A package is suspended, its hours change, or care ends.' },
  { channel: 'EMAIL', key: 'contract-missed-visits', status: toBuild, audience: ['FUNDERS'], label: 'Missed and late visit notices to commissioners', why: 'Most council contracts require missed or very late visits to be reported within a set time.', when: 'A visit is confirmed missed, or very late, for a council-funded person.' },
  { channel: 'EMAIL', key: 'monthly-statements', status: toBuild, audience: ['FUNDERS'], label: 'Monthly hours statements', why: 'Contract monitoring: planned against delivered hours per person.', when: 'Each month, after the invoice run.' },
  { channel: 'EMAIL', key: 'review-reports', status: toBuild, audience: ['FUNDERS', 'PROFESSIONALS'], label: 'Care review reports', why: 'Social workers need the outcome of reviews to keep the care plan and funding right.', when: 'A care review is completed for a funded person.' },
  // Regulators
  { channel: 'EMAIL', key: 'cqc-notifications', status: toBuild, audience: ['REGULATORS'], essential: true, label: 'CQC statutory notifications', why: 'The law requires notifying CQC of deaths, serious injuries, abuse allegations and police incidents without delay.', when: 'An incident of a notifiable type is recorded.', ifOff: 'You must still notify CQC yourself: not doing so is an offence.' },
  { channel: 'EMAIL', key: 'safeguarding-referrals', status: toBuild, audience: ['REGULATORS'], essential: true, label: 'Safeguarding referrals', why: 'Concerns of abuse or neglect must be referred to the local authority safeguarding team.', when: 'A safeguarding concern is raised and the manager decides to refer.', ifOff: 'Referrals must be made by phone or the council’s portal instead.' },
  // Referrers & partner organisations
  { channel: 'EMAIL', key: 'referral-replies', status: live, audience: ['REFERRERS'], label: 'Referral replies', why: 'To answer referrals quickly: acknowledge, ask for missing details, confirm we can help, quote, or decline with a reason.', when: 'A referral email is read and replied to by staff or automatically.', ifOff: 'Referrers hear nothing back; replies stay as drafts in the referral inbox.' },
  { channel: 'EMAIL', key: 'discharge-confirmations', status: toBuild, audience: ['REFERRERS'], label: 'Hospital discharge confirmations', why: 'Discharge teams need written confirmation of the start date and first visit to release the patient.', when: 'A hospital discharge package is accepted and its first visit booked.' },
  { channel: 'EMAIL', key: 'quotes', status: live, audience: ['PEOPLE', 'REFERRERS'], label: 'Quotes', why: 'To give people paying for care the price before they decide.', when: 'Staff email a quotation from an enquiry, or the referral automation attaches one to its reply.', ifOff: 'Quotes are not emailed; staff see “Not sent” and must send them another way.' },
  // Professionals
  { channel: 'EMAIL', key: 'gp-concerns', status: toBuild, audience: ['PROFESSIONALS'], label: 'Health concerns to GPs and district nurses', why: 'To ask for a review when carers see deterioration: falls, weight loss, skin damage, new confusion.', when: 'A carer’s observation or a body map is flagged for GP attention.' },
  { channel: 'EMAIL', key: 'pharmacy-requests', status: toBuild, audience: ['PROFESSIONALS'], label: 'Pharmacy requests', why: 'Repeat prescriptions, missing stock and MAR changes are sorted with the pharmacy.', when: 'Medication stock runs low or a MAR change needs the pharmacy.' },
  { channel: 'EMAIL', key: 'surveys-outside', status: live, audience: ['PROFESSIONALS', 'FUNDERS', 'PEOPLE'], label: 'Surveys to outside people', why: 'Feedback from GPs, social workers, commissioners and family contacts (CQC asks providers to seek it).', when: 'A survey is sent to outside people, and its reminders.' },
  // Service users & families
  { channel: 'EMAIL', key: 'surveys-people', status: live, audience: ['PEOPLE'], label: 'Surveys to service users and families', why: 'To hear how care is going, as CQC expects (including people whose care has ended).', when: 'A service user survey is sent (own email or portal), and its reminders.' },
  { channel: 'EMAIL', key: 'welcome-pack', status: toBuild, audience: ['PEOPLE'], label: 'Welcome pack and contract', why: 'People must receive the service user guide, terms and contract before care starts.', when: 'An enquiry becomes a service user.' },
  { channel: 'EMAIL', key: 'portal-invites', status: toBuild, audience: ['PEOPLE'], essential: true, label: 'Portal invitations', why: 'Service users and families sign in to the portal to see visits, care plans and invoices.', when: 'Staff give someone portal access.' },
  { channel: 'EMAIL', key: 'weekly-schedule', status: toBuild, audience: ['PEOPLE'], label: 'Weekly visit schedule', why: 'So people know who is coming and when.', when: 'Each week, once the rota is published.' },
  { channel: 'EMAIL', key: 'visit-changes', status: toBuild, audience: ['PEOPLE'], label: 'Visit changes', why: 'So people aren’t surprised by a different carer or time, or a cancelled visit.', when: 'A visit’s time or carer changes, or it is cancelled.' },
  { channel: 'EMAIL', key: 'missed-visit-apology', status: toBuild, audience: ['PEOPLE'], label: 'Missed visit apologies', why: 'Duty of candour: tell the person (or family) what happened and what we are doing.', when: 'A visit is confirmed missed.' },
  { channel: 'EMAIL', key: 'care-plan-sign-off', status: toBuild, audience: ['PEOPLE'], label: 'Care plans to read and agree', why: 'People should read and agree their care plan and reviews.', when: 'A care plan or review is ready to sign.' },
  { channel: 'EMAIL', key: 'complaint-responses', status: toBuild, audience: ['PEOPLE', 'REFERRERS'], label: 'Complaint acknowledgements and outcomes', why: 'Complaints must be acknowledged (usually within 3 working days) and answered in writing.', when: 'A complaint is logged, and when its outcome is recorded.' },
  { channel: 'EMAIL', key: 'payment-receipts', status: toBuild, audience: ['PEOPLE'], label: 'Payment receipts', why: 'Private payers need a receipt for what they paid.', when: 'A payment is recorded against an invoice.' },
  // Carers & staff
  { channel: 'EMAIL', key: 'account', status: live, audience: ['CARERS', 'MANAGERS', 'PROFESSIONALS'], essential: true, label: 'Sign-in and password emails', why: 'So staff (and independent survey reviewers) can set or reset their password.', when: 'An account is created, or someone asks to reset their password.', ifOff: 'Nobody can set or reset a password until it is switched back on.' },
  { channel: 'EMAIL', key: 'absences', status: live, audience: ['CARERS'], label: 'Absence recorded', why: 'So the carer knows an absence (holiday, sickness…) was put on their record and can query it.', when: 'Staff record an absence and tick “email the carer”.' },
  { channel: 'EMAIL', key: 'surveys-staff', status: live, audience: ['CARERS', 'MANAGERS'], label: 'Staff surveys', why: 'Staff feedback, and exit surveys for people who have left.', when: 'A staff survey is sent, and its reminders.' },
  { channel: 'EMAIL', key: 'rota', status: toBuild, audience: ['CARERS'], label: 'Rota emails', why: 'Carers without the app still need their visits for the week.', when: 'The rota is published or a carer’s visits change.' },
  { channel: 'EMAIL', key: 'payslips', status: toBuild, audience: ['CARERS'], label: 'Payslips', why: 'Staff must get a payslip each pay period.', when: 'Payroll is closed for a period.' },
  { channel: 'EMAIL', key: 'training-due', status: toBuild, audience: ['CARERS'], label: 'Training due and expired', why: 'Mandatory training must stay in date (CQC Regulation 18).', when: 'A course is due within 30 days, or has expired.' },
  { channel: 'EMAIL', key: 'document-expiry-staff', status: toBuild, audience: ['CARERS'], label: 'Your documents are expiring', why: 'Carers renew their own DBS, right to work and licences in time.', when: 'A document of theirs is about to expire (managers are told separately).' },
  // Managers & office
  { channel: 'EMAIL', key: 'compliance-reminders', status: live, audience: ['MANAGERS'], label: 'Compliance reminders', why: 'Supervisors and managers make sure staff documents and checks are renewed before they lapse.', when: 'A staff document or check reaches each reminder stage before expiry.' },
  { channel: 'EMAIL', key: 'supervision-reminders', status: live, audience: ['MANAGERS'], label: 'Supervision reminders', why: 'Supervisions and appraisals must happen on time (CQC Regulation 18).', when: 'A supervision or appraisal is due or overdue.' },
  { channel: 'EMAIL', key: 'referral-test-copies', status: live, audience: ['MANAGERS'], label: 'Referral test copies', why: 'Testers see exactly what CareFlow read and replied for a test referral.', when: 'A test referral is added, and when it is replied to.' },
  { channel: 'EMAIL', key: 'visit-alerts', status: toBuild, audience: ['MANAGERS'], label: 'Visit alerts by email', why: 'On-call managers away from CareFlow still hear about SOS, missed and late visits.', when: 'A visit alert is raised and “email” is on in the visit alert settings (today these are only logged).' },
  { channel: 'EMAIL', key: 'new-enquiries', status: toBuild, audience: ['MANAGERS'], label: 'New enquiries and referrals', why: 'So a manager picks up urgent referrals (hospital discharges) at once.', when: 'A new enquiry or referral arrives.' },
  { channel: 'EMAIL', key: 'incident-reports', status: toBuild, audience: ['MANAGERS'], label: 'Incidents and complaints received', why: 'Managers must review incidents and complaints quickly.', when: 'An incident or complaint is recorded.' },
  { channel: 'EMAIL', key: 'daily-summary', status: toBuild, audience: ['MANAGERS'], label: 'Daily summary', why: 'One email a day: unallocated visits, missed visits, overdue medication, expiring documents.', when: 'Every morning.' },
  // Applicants & referees
  { channel: 'EMAIL', key: 'surveys-applicants', status: live, audience: ['APPLICANTS'], label: 'Applicant surveys', why: 'Feedback on how we recruit.', when: 'An applicant survey is sent.' },
  { channel: 'EMAIL', key: 'recruitment', status: toBuild, audience: ['APPLICANTS'], label: 'Application updates', why: 'Applicants hear we have their application, interview times, offers and outcomes.', when: 'An application moves stage.' },
  { channel: 'EMAIL', key: 'reference-requests', status: toBuild, audience: ['APPLICANTS'], label: 'Reference requests', why: 'Safe recruitment needs written references before someone starts.', when: 'An offer is made and referees are added.' },
  // Platform
  { channel: 'EMAIL', key: 'platform-reports', status: live, audience: ['PLATFORM'], label: 'Azure cost reports and alerts', why: 'To keep hosting costs in check.', when: 'Each month, and when daily spend jumps.' },
  { channel: 'EMAIL', key: 'job-failures', status: toBuild, audience: ['PLATFORM'], label: 'System job failures', why: 'So the team knows when a scheduled job (rota, invoices, reminders) stops working.', when: 'A scheduled job fails.' },
  // Anyone
  { channel: 'EMAIL', key: 'test', status: live, audience: ['ANY'], label: 'Test messages', why: 'To check email delivery from this page.', when: 'Someone sends a test from this page.' },
  { channel: 'EMAIL', key: 'other', status: live, audience: ['ANY'], label: 'Other emails', why: 'Anything not listed above.', when: 'A sender that names no type.' },

  /* ─── Text messages (SMS) ───────────────────────────────────── */
  { channel: 'TEXT', key: 'surveys-people', status: live, audience: ['PEOPLE'], label: 'Surveys to service users and families', why: 'Many people we support don’t use email.', when: 'A service user survey is sent by text, and its reminders.' },
  { channel: 'TEXT', key: 'surveys-outside', status: live, audience: ['PROFESSIONALS', 'PEOPLE'], label: 'Surveys to outside people', why: 'Feedback from professionals and family contacts by text.', when: 'An outside-people survey is sent by text.' },
  { channel: 'TEXT', key: 'surveys-staff', status: live, audience: ['CARERS'], label: 'Staff surveys', why: 'Reaches former staff who no longer have the app.', when: 'A staff survey reminder is sent by text.' },
  { channel: 'TEXT', key: 'visit-changes', status: toBuild, audience: ['PEOPLE'], label: 'Visit changes', why: 'A quick text when the carer or time changes, or a visit is cancelled.', when: 'A visit changes on the day.' },
  { channel: 'TEXT', key: 'carer-running-late', status: toBuild, audience: ['PEOPLE'], label: 'Carer running late', why: 'So people aren’t left waiting without knowing.', when: 'A visit is late starting.' },
  { channel: 'TEXT', key: 'rota', status: toBuild, audience: ['CARERS'], label: 'Rota and visit changes for carers', why: 'Carers without the app (or signal) still get changes.', when: 'A carer’s visits change at short notice.' },
  { channel: 'TEXT', key: 'open-shifts', status: toBuild, audience: ['CARERS'], label: 'Open visits to cover', why: 'To fill unallocated visits quickly.', when: 'Staff offer an unallocated visit to available carers.' },
  { channel: 'TEXT', key: 'on-call-alerts', status: toBuild, audience: ['MANAGERS'], label: 'SOS and missed visits to on-call', why: 'The on-call manager must hear about an SOS or missed visit even with CareFlow closed.', when: 'An urgent visit alert is raised out of hours.' },
  { channel: 'TEXT', key: 'test', status: live, audience: ['ANY'], label: 'Test messages', why: 'To check text delivery from this page.', when: 'Someone sends a test from this page.' },
  { channel: 'TEXT', key: 'other', status: live, audience: ['ANY'], label: 'Other texts', why: 'Anything not listed above.', when: 'A sender that names no type.' },

  /* ─── WhatsApp (no sender yet) ──────────────────────────────── */
  { channel: 'WHATSAPP', key: 'family-updates', status: toBuild, audience: ['PEOPLE'], label: 'Visit updates for families', why: 'Many families prefer WhatsApp for visit changes and “care completed” notes.', when: 'A visit changes or is completed (if the family opts in).' },
  { channel: 'WHATSAPP', key: 'carer-updates', status: toBuild, audience: ['CARERS'], label: 'Rota updates for carers', why: 'Carers already use WhatsApp; changes reach them fastest there.', when: 'A carer’s visits change.' },
  { channel: 'WHATSAPP', key: 'other', status: toBuild, audience: ['ANY'], label: 'Other WhatsApp messages', why: 'Anything not listed above.', when: 'A sender that names no type.' },

  /* ─── Push notifications (carer app) ────────────────────────── */
  { channel: 'PUSH', key: 'visits', status: live, audience: ['CARERS'], label: 'Visit updates', why: 'Carers must know at once about new, changed and cancelled visits, and that the office saw their SOS.', when: 'A carer’s visit is added, changed, cancelled or their SOS is acknowledged.', ifOff: 'Carers only see changes when they open the app.' },
  { channel: 'PUSH', key: 'carer-messages', status: live, audience: ['CARERS'], label: 'Messages to carers', why: 'Office announcements and urgent messages.', when: 'Staff send a message from Settings › Carer notifications.' },
  { channel: 'PUSH', key: 'care-plans', status: live, audience: ['CARERS'], label: 'Care plan updates', why: 'Carers must follow the latest plan for the people they visit.', when: 'A care plan changes for someone the carer visits.' },
  { channel: 'PUSH', key: 'policies', status: live, audience: ['CARERS'], label: 'Policies to read', why: 'Staff must read and acknowledge new and updated policies.', when: 'A policy is published, and daily reminders until acknowledged.' },
  { channel: 'PUSH', key: 'compliance-reminders', status: live, audience: ['CARERS'], label: 'Your documents are expiring', why: 'Carers renew their DBS, right to work and other documents in time.', when: 'A carer’s document reaches a reminder stage.' },
  { channel: 'PUSH', key: 'supervision-reminders', status: live, audience: ['CARERS'], label: 'Supervision due', why: 'Carers know a supervision or appraisal is coming up.', when: 'A supervision or appraisal is due.' },
  { channel: 'PUSH', key: 'surveys', status: live, audience: ['CARERS'], label: 'Staff surveys', why: 'Staff answer surveys in the app.', when: 'A staff survey is sent, and its reminders.' },
  { channel: 'PUSH', key: 'rota-published', status: toBuild, audience: ['CARERS'], label: 'Rota published', why: 'Carers know their next week is ready.', when: 'The rota is published.' },
  { channel: 'PUSH', key: 'open-shifts', status: toBuild, audience: ['CARERS'], label: 'Open visits to cover', why: 'To fill unallocated visits quickly.', when: 'Staff offer an unallocated visit.' },
  { channel: 'PUSH', key: 'training-due', status: toBuild, audience: ['CARERS'], label: 'Training due', why: 'Mandatory training stays in date.', when: 'A course is due or expired.' },
  { channel: 'PUSH', key: 'absence-decisions', status: toBuild, audience: ['CARERS'], label: 'Holiday and absence decisions', why: 'Carers hear at once whether their request was approved.', when: 'A holiday or absence request is decided.' },
  { channel: 'PUSH', key: 'payslips', status: toBuild, audience: ['CARERS'], label: 'Payslip ready', why: 'Carers know their payslip is in the app.', when: 'Payroll is closed.' },
  { channel: 'PUSH', key: 'test', status: live, audience: ['ANY'], label: 'Test messages', why: 'To check push delivery from this page.', when: 'Someone sends a test from this page.' },
  { channel: 'PUSH', key: 'other', status: live, audience: ['ANY'], label: 'Other notifications', why: 'Anything not listed above.', when: 'A sender that names no type.' },
];

export const kindId = (channel: MessageChannel, key: string) => `${channel}:${key}`;

/** The catalogue entry for a sender's kind; unknown kinds fall back to the channel's "other". */
export function findKind(channel: MessageChannel, key: string | undefined): MessageKind {
  return (
    MESSAGE_KINDS.find((k) => k.channel === channel && k.key === key) ??
    MESSAGE_KINDS.find((k) => k.channel === channel && k.key === 'other')!
  );
}
