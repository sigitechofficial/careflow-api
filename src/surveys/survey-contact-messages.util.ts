/**
 * Wording of survey invitations and reminders by email, carer-app notification and text message.
 *
 * Anonymous surveys: never a personal link (whoever holds a person's own link can see whether they
 * have answered, A7), only where they can answer signed in: Surveys in the carer app, My surveys in the
 * CareFlow web app (staff with a login), or their portal; never "you
 * have not answered" either — the reminder says the survey is still open and thanks anyone who has
 * answered since. No message ever holds an answer.
 */

import { surveyEmail } from './survey-email-content';

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
  /** "Monday 30 November 2026" for emails; and whole days left (reminder subjects). */
  closesDate?: string | null;
  daysLeft?: number | null;
  /** Footer and colours: legal name, company number, CQC provider ID, website, brand colour. */
  brand?: {
    legalName?: string | null;
    companyNumber?: string | null;
    cqcProviderId?: string | null;
    website?: string | null;
    brandColour?: string | null;
  } | null;
  /** A ready-made survey's own invitation wording, when it has some ({{firstName}} allowed in the subject). */
  inviteSubject?: string | null;
  inviteIntro?: string | null;
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

  const { subject: emailSubject, text: emailText, html: emailHtml } = surveyEmail(input, link, where);

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
