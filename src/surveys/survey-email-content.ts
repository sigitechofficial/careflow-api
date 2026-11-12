import type { ContactMessageInput } from './survey-contact-messages.util';
import { renderSurveyEmailHtml } from './survey-email-html.util';

/**
 * The wording of survey invitation and reminder emails (agreed with the user, 7 Nov 2026): subject,
 * plain text and HTML from the same words. Warm, short, plain English; one clear action; what happens
 * to answers; other formats; a proper footer. Never a personal link on an anonymous survey (A7).
 */
export function surveyEmail(
  input: ContactMessageInput,
  link: string | null,
  where: string,
): { subject: string; text: string; html: string } {
  const org = input.organisation?.trim() || null;
  const first = input.firstName?.trim() || null;
  const staff = input.kind === 'EMPLOYEE';
  const supported = input.kind === 'SERVICE_USER';
  const minutes = input.minutes && input.minutes > 0 ? Math.round(input.minutes) : null;
  const mins = minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : null;
  const closes = input.closesDate?.trim() || input.closesOn?.trim() || null;
  const title = input.title.trim();

  // Subject: short and personal; the full detail is in the email.
  let subject: string;
  if (input.reminder) {
    const d = input.daysLeft;
    subject =
      d === 0
        ? `Last day to share your views: ${title}`
        : d === 1
          ? `Reminder: 1 day left to share your views on ${title}`
          : d != null && d <= 14
            ? `Reminder: ${d} days left to share your views on ${title}`
            : `Reminder: ${title}`;
  } else if (input.inviteSubject?.trim()) {
    subject = input.inviteSubject
      .trim()
      .replace(/\{\{\s*firstName\s*\}\}/g, first ?? '')
      .replace(/^[\s,]+/, '');
    subject = subject.charAt(0).toUpperCase() + subject.slice(1);
  } else if (input.anonymous) {
    subject = `Your views, anonymously: ${title}`;
  } else {
    subject = first ? `${first}, we'd like your views: ${title}` : `We'd like your views: ${title}`;
  }

  // Greeting and opening
  const greeting = supported ? (first ? `Dear ${first},` : 'Hello,') : first ? `Hi ${first},` : 'Hello,';
  const paragraphs: string[] = [];
  if (input.reminder) {
    paragraphs.push(
      closes
        ? `Just a reminder that our survey **${title}** closes on **${closes}**.${mins ? ` It only takes about ${mins}.` : ''}`
        : `Just a reminder that our survey **${title}** is still open, and we would value your answers.${mins ? ` It only takes about ${mins}.` : ''}`,
    );
    if (input.anonymous) paragraphs.push('**It is anonymous:** your answers are not linked to your name.');
    else if (link) paragraphs.push("Your link is just for you, so please don't forward this email.");
    if (supported) paragraphs.push('A family member or someone you trust can help you, or answer for you.');
  } else {
    paragraphs.push(
      input.inviteIntro?.trim() ||
        (supported
          ? `We'd like to know how things are going for you, in our survey **${title}**: what's working well and what we could do better.`
          : `We'd like to hear your views in our survey **${title}**.`),
    );
    if (input.anonymous && !supported) {
      paragraphs.push('**This survey is anonymous:** your answers are not linked to your name, and results are only shared as totals once enough people have answered.');
    }
    if (mins) {
      paragraphs.push(
        supported
          ? `It takes about **${mins}**. A family member or someone you trust can help you, or answer for you.`
          : `It takes about **${mins}**, and you can do it on your phone.`,
      );
    } else if (supported) {
      paragraphs.push('A family member or someone you trust can help you, or answer for you.');
    }
  }

  // One clear action: a named survey's own link, or a sign-in page that holds no token.
  const webOnlyLink = staff && !link && input.staffPlaces?.web && !input.staffPlaces.app ? input.staffPlaces.webLink : null;
  const button = link
    ? { label: supported ? 'Open your survey' : 'Start the survey', href: link } // reminders: the same button as the invitation
    : supported && input.portalLink && !input.paperOnly
      ? { label: 'Open your survey', href: input.portalLink }
      : webOnlyLink
        ? { label: 'Open My surveys', href: webOnlyLink }
        : null;
  const facts = closes ? `Open until **${closes}**` : null;
  const howToAnswer = button ? null : where;

  // Sections (invitations; a reminder stays short)
  const phone = input.contactPhone?.trim() || null;
  const mail = input.contactEmail?.trim() || null;
  const sections: Array<{ heading: string; body: string }> = [];
  if (!input.reminder) {
    const notForward = link ? " Your link is just for you, so please don't forward this email." : '';
    const answers = input.anonymous
      ? supported
        ? "Your answers aren't linked to your name, and they never affect the care you receive."
        : "We can't see who said what. Please don't include names or details that could identify you or anyone else."
      : supported
        ? `Our care managers read them to improve your care. They never affect the care you receive. If you tell us about a problem, we'll be in touch.${notForward}`
        : staff
          ? `They're read by the people at ${org ?? 'our organisation'} responsible for this survey, to improve how we support you. If something needs action, someone will contact you.${notForward}`
          : `We read every answer to improve our service. If you tell us about a problem, we'll be in touch.${notForward}`;
    sections.push({ heading: 'What happens to your answers', body: answers });
    const reach = [phone ? `call ${supported ? 'us' : 'the office'} on ${phone}` : '', mail ? `email ${mail}` : ''].filter(Boolean).join(' or ');
    sections.push(
      supported
        ? {
            heading: 'Prefer to answer another way?',
            body: `We can post a paper copy, go through it with you by phone, or send it in large print. ${reach ? `Just ${reach}.` : 'Just contact the office.'}`,
          }
        : {
            heading: 'Need help?',
            body: `If you'd prefer to answer on paper or by phone, or need large print or another language, ${reach || 'contact the office'}.`,
          },
    );
  }
  const closing = input.reminder ? "If you've already answered, thank you, and please ignore this email." : null;
  const signOff = supported ? ['With thanks,', org ? `The ${org} team` : 'The care team'] : ['Thank you,', org ?? 'The team'];

  // Footer
  const b = input.brand ?? {};
  const legalLines = [
    b.legalName?.trim()
      ? `${b.legalName.trim()}${b.companyNumber?.trim() ? ` · Registered in England and Wales, company number ${b.companyNumber.trim()}` : ''}`
      : '',
    b.cqcProviderId?.trim() ? `Registered with the Care Quality Commission, provider ID ${b.cqcProviderId.trim()}` : '',
  ].filter(Boolean);
  const contactLine = [phone, mail].filter(Boolean).join(' · ') || null;
  const why = org
    ? staff
      ? `You're receiving this because you work with ${org}. Please do not reply to this email.`
      : supported
        ? `You're receiving this because ${org} provides your care. Please do not reply to this email.`
        : `You're receiving this because ${org} asked for your views. Please do not reply to this email.`
    : 'Please do not reply to this email.';
  const unsubscribe = input.unsubscribeLink ? { label: 'Stop all survey messages from us, for good', href: input.unsubscribeLink } : null;

  const preheader = input.reminder
    ? [closes ? `Closes ${closes}` : '', mins ? `takes about ${mins}` : ''].filter(Boolean).join(' · ') || title
    : [mins ? `A ${mins} survey from ${org ?? 'us'}` : `A survey from ${org ?? 'us'}`, closes ? `open until ${closes}` : '']
        .filter(Boolean)
        .join(', ');

  const html = renderSurveyEmailHtml({
    organisation: org,
    logoUrl: input.logoUrl,
    brandColour: b.brandColour ?? null,
    preheader,
    greeting,
    paragraphs,
    button,
    facts,
    howToAnswer,
    sections,
    closingNote: closing,
    signOff: closing ? [] : signOff,
    footer: { legalLines, contactLine, website: b.website ?? null, why },
    unsubscribe,
  });

  // Plain text: the same words, for email apps that do not show HTML.
  const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1');
  const lines: string[] = [greeting, ''];
  for (const p of paragraphs) lines.push(plain(p), '');
  if (button) lines.push(`${button.label}: ${button.href}`, '');
  // Same order as the HTML: button, when it closes, how to answer.
  if (facts) lines.push(plain(facts), '');
  if (howToAnswer) lines.push(`How to answer: ${howToAnswer}`, '');
  for (const sec of sections) lines.push(sec.heading, sec.body, '');
  if (closing) lines.push(closing, '');
  else lines.push(...signOff, '');
  lines.push('---', ...[org, contactLine, b.website ?? null, ...legalLines, why].filter((x): x is string => Boolean(x)));
  if (unsubscribe) lines.push(`To stop all survey messages from us, for good: ${unsubscribe.href}`);
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject, text, html };
}
