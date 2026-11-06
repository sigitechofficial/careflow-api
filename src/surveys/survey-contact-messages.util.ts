/**
 * Wording of survey invitations and reminders by email, carer-app notification and text message.
 *
 * Anonymous surveys: never a personal link (whoever holds a person's own link can see whether they
 * have answered, A7), only where they can answer signed in: Surveys in the carer app, My surveys in the
 * CareFlow web app (staff with a login), or their portal; never "you
 * have not answered" either — the reminder says the survey is still open and thanks anyone who has
 * answered since. No message ever holds an answer.
 */

import { renderSurveyEmailHtml } from './survey-email-html.util';

export type ContactMessageInput = {
  /** EXTERNAL: an outside person (family, professional, commissioner) on a named public survey. */
  kind: 'EMPLOYEE' | 'SERVICE_USER' | 'EXTERNAL';
  anonymous: boolean;
  reminder: boolean;
  title: string;
  firstName: string | null;
  /** The person's own link (named surveys only; ignored on anonymous surveys). */
  link: string | null;
  /** Where people we support answer (base/portal/surveys), when known. */
  portalLink: string | null;
  /** "30 Nov 2026, 17:00", when the survey has an end date. */
  closesOn: string | null;
  organisation: string | null;
  /** The text provider handles replies, so "Reply STOP" may be offered. */
  textRepliesSupported: boolean;
  /**
   * Staff without a personal link (anonymous surveys): where they can answer signed in. Absent = the carer
   * app only (older callers). webLink: the web app's My surveys page (base/my-surveys), when known.
   */
  staffPlaces?: { app: boolean; web: boolean; webLink: string | null };
  /** Former people (left, or care ended): a one-click "unsubscribe from all surveys" link in every message. */
  unsubscribeLink?: string | null;
  /** About how long it takes (the ready-made survey's estimate, else from the number of questions). */
  minutes?: number | null;
  /** The organisation's office phone and email, for help and other formats (paper, phone, large print). */
  contactPhone?: string | null;
  contactEmail?: string | null;
  /** An https logo for the email header (ignored otherwise). */
  logoUrl?: string | null;
  /** No portal or app to answer in (care has ended): paper or phone, unless they have their own link. */
  paperOnly?: boolean;
};

/** Where a member of staff answers without a personal link, in words (never a token). */
export function staffAnswerWhere(places: ContactMessageInput['staffPlaces'], short = false): string {
  const p = places ?? { app: true, web: false, webLink: null };
  const web = p.webLink ? `sign in to CareFlow and open My surveys: ${p.webLink}` : 'sign in to CareFlow and open My surveys';
  if (short) {
    if (p.app && p.web) return `Open Surveys in the carer app, or ${web}.`;
    if (p.web) return `${web[0].toUpperCase()}${web.slice(1)}.`;
    if (p.app) return 'Open Surveys in the carer app.';
    return 'Ask the office for a paper copy.';
  }
  if (p.app && p.web) return `Open Surveys in the carer app, or ${web}, to answer it. You can also ask the office for a paper copy.`;
  if (p.web) return `To answer it, ${web}. You can also ask the office for a paper copy.`;
  if (p.app) return 'Open Surveys in the carer app to answer it, or ask the office for a paper copy.';
  return 'Please ask the office for a paper copy to answer it.';
}

export type ContactMessages = {
  emailSubject: string;
  emailText: string;
  /** The same email as accessible, branded HTML (send with emailText as the plain-text part). */
  emailHtml: string;
  pushTitle: string;
  pushBody: string;
  text: string;
};

const MAX_TITLE_IN_TEXT = 60;

function shortTitle(title: string): string {
  const t = title.trim();
  return t.length > MAX_TITLE_IN_TEXT ? `${t.slice(0, MAX_TITLE_IN_TEXT - 1).trimEnd()}…` : t;
}

export function surveyContactMessages(input: ContactMessageInput): ContactMessages {
  const link = input.anonymous ? null : input.link;
  const hello = input.firstName?.trim() ? `Hello ${input.firstName.trim()},` : 'Hello,';
  const until = input.closesOn ? ` It is open until ${input.closesOn}.` : '';
  const where =
    input.paperOnly && !link
      ? 'Please contact us for a paper copy, or to answer by phone.'
      : input.kind === 'EXTERNAL'
      ? link
        ? `Open your survey: ${link}`
        : 'Please contact us for a paper copy or to answer by phone.'
      : input.kind === 'EMPLOYEE'
      ? link
        ? `Open your survey: ${link}`
        : staffAnswerWhere(input.staffPlaces)
      : link
        ? `Open your survey: ${link}`
        : input.portalLink
          ? `Log in to your portal to answer it: ${input.portalLink}`
          : 'Log in to your portal and open Surveys to answer it, or ask the office for a paper copy or a call.';
  const privacy = input.anonymous
    ? 'Your answers are anonymous: they are not linked to your name.'
    : link
      ? 'This link is personal to you. Please do not share it.'
      : '';
  const onBehalf = input.kind === 'SERVICE_USER' ? 'A family member or representative can answer on your behalf.' : '';
  const thanksIfDone = input.reminder ? 'If you have answered since this was sent, thank you, and please ignore this message.' : '';

  const org = input.organisation?.trim() || null;
  const minutes = input.minutes && input.minutes > 0 ? Math.round(input.minutes) : null;
  const about =
    input.kind === 'EMPLOYEE'
      ? 'Your answers help us improve how we support you at work.'
      : input.kind === 'SERVICE_USER'
        ? 'Your answers help us improve your care and support.'
        : 'Your answers help us improve our service.';
  const takes = minutes ? ` It takes about ${minutes} minute${minutes === 1 ? '' : 's'}.` : '';
  const emailSubject = input.reminder
    ? `Reminder: ${input.title}${input.closesOn ? ` (open until ${input.closesOn})` : ''}`
    : org
      ? `${org} would value your views: ${input.title}`
      : `We would value your views: ${input.title}`;
  const opening = input.reminder
    ? `This is a reminder that the survey "${input.title}" is still open and we would value your answers.${until}`
    : `We would value your answers to the survey "${input.title}".${takes}${until}`;
  const stopAll = input.unsubscribeLink ? `To stop all survey messages from us, for good: ${input.unsubscribeLink}` : '';
  const contactBits = [input.contactPhone?.trim(), input.contactEmail?.trim()].filter(Boolean) as string[];
  const help = contactBits.length
    ? `Questions, or would you like it on paper, by phone or in large print? Contact ${org ?? 'us'} on ${contactBits.join(' or ')}.`
    : 'Questions, or would you like it on paper, by phone or in large print? Please contact the office.';
  const emailText = [hello, '', opening, about, '', where, '', privacy, onBehalf, thanksIfDone, '', help, '', stopAll, 'Thank you.', org ?? '']
    .filter((line, i, all) => line !== '' || (all[i - 1] !== '' && i > 0))
    .join('\n')
    .trim();

  // HTML: a button only for a named survey's own link, or a sign-in page that holds no token.
  const webOnlyLink =
    input.kind === 'EMPLOYEE' && !link && input.staffPlaces?.web && input.staffPlaces.webLink ? input.staffPlaces.webLink : null;
  const button = link
    ? { label: input.reminder ? 'Answer the survey' : 'Start the survey', href: link }
    : input.kind === 'SERVICE_USER' && input.portalLink
      ? { label: 'Open your portal', href: input.portalLink }
      : webOnlyLink && !input.staffPlaces?.app
        ? { label: 'Open My surveys', href: webOnlyLink }
        : null;
  const howToAnswer = button ? null : where;
  const details: Array<{ label: string; value: string }> = [];
  if (minutes) details.push({ label: 'Takes about', value: `${minutes} minute${minutes === 1 ? '' : 's'}` });
  if (input.closesOn) details.push({ label: 'Open until', value: input.closesOn });
  details.push({
    label: 'Your answers',
    value: input.anonymous ? 'Anonymous: not linked to your name' : link ? 'Linked to your name, so we can follow up if needed' : 'Linked to your name',
  });
  const notes = [privacy && !input.anonymous ? privacy : '', onBehalf, thanksIfDone].filter(Boolean);
  const footer = [
    org
      ? input.kind === 'EMPLOYEE'
        ? `You are receiving this because you work with ${org}.`
        : input.kind === 'SERVICE_USER'
          ? `You are receiving this because ${org} provides your care.`
          : `You are receiving this from ${org}.`
      : '',
    'Please do not reply to this email.',
  ].filter(Boolean);
  const emailHtml = renderSurveyEmailHtml({
    organisation: org,
    logoUrl: input.logoUrl,
    preheader: [minutes ? `About ${minutes} minutes` : '', input.closesOn ? `open until ${input.closesOn}` : '', input.anonymous ? 'anonymous' : '']
      .filter(Boolean)
      .join(' · ') || about,
    heading: input.reminder ? `Reminder: ${input.title}` : input.title,
    greeting: hello,
    paragraphs: [opening, about],
    button,
    howToAnswer,
    details,
    notes,
    help,
    footer,
    unsubscribe: input.unsubscribeLink ? { label: 'Stop all survey messages from us, for good', href: input.unsubscribeLink } : null,
  });

  const pushTitle = input.reminder ? 'Survey reminder' : 'New survey';
  const pushBody = input.reminder
    ? `"${shortTitle(input.title)}" is still open. We would value your answers.`
    : `Please complete "${shortTitle(input.title)}".`;

  const from = input.organisation ? `${input.organisation}: ` : '';
  const textWhere = link
    ? link
    : input.kind === 'EXTERNAL'
      ? 'Contact us to answer by phone or on paper.'
      : input.kind === 'EMPLOYEE'
      ? staffAnswerWhere(input.staffPlaces, true)
      : input.portalLink
        ? `Log in to your portal: ${input.portalLink}`
        : 'Log in to your portal and open Surveys.';
  const text = [
    `${from}${input.reminder ? 'Reminder: ' : ''}please answer our survey "${shortTitle(input.title)}".`,
    input.anonymous ? 'It is anonymous.' : '',
    textWhere,
    input.textRepliesSupported ? 'Reply STOP to stop survey texts.' : input.unsubscribeLink ? `Stop all surveys: ${input.unsubscribeLink}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { emailSubject, emailText, emailHtml, pushTitle, pushBody, text };
}
