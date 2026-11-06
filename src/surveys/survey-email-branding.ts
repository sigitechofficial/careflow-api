import type { PrismaService } from '../prisma/prisma.service';
import { formatSurveyDateTime } from './survey-recurrence.util';

/**
 * What every survey email shows about the organisation and the survey: a short everyday name for
 * subjects and greetings ("Allfor Care"), the legal name and registration details for the footer, the
 * office phone and email (help and other formats), the website, an https logo and the brand colour.
 *
 * Logo: the company profile's logo when it is a public https address; else MAIL_LOGO_URL. Brand colour:
 * MAIL_BRAND_COLOUR (#rrggbb), else a dark navy. Read once per send; any failure falls back to plain wording.
 */
export type SurveyEmailBranding = {
  /** Everyday name: "Allfor Care Services Limited" → "Allfor Care". */
  organisation: string | null;
  legalName: string | null;
  companyNumber: string | null;
  cqcProviderId: string | null;
  website: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  brandColour: string;
};

export type SurveyEmailFacts = {
  minutes: number | null;
  /** "30 Nov 2026, 17:00" (the wording used in texts and the app). */
  closesOn: string | null;
  /** "Monday 30 November 2026" (emails). */
  closesDate: string | null;
  /** Whole days until it closes (0 = closes today); null with no end date. */
  daysLeft: number | null;
};

type Db = Pick<PrismaService, 'companyProfile' | 'survey' | 'surveyQuestion'>;

const DEFAULT_BRAND = '#132573';

/** "Allfor Care Services Limited" → "Allfor Care"; "Sunrise Homecare Ltd" → "Sunrise Homecare". */
export function everydayOrganisationName(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n) return null;
  const short = n
    .replace(/\s*\b(limited|ltd\.?|llp|plc|c\.?i\.?c\.?)\s*$/i, '')
    .replace(/\s+services\s*$/i, '')
    .trim();
  return short || n;
}

function https(u: string | null | undefined): string | null {
  const v = u?.trim();
  return v && /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : null;
}

export async function surveyEmailBranding(prisma: Db): Promise<SurveyEmailBranding> {
  const profile = await Promise.resolve()
    .then(() =>
      prisma.companyProfile.findFirst({
        select: {
          displayName: true,
          companyName: true,
          legalName: true,
          companyNumber: true,
          cqcProviderId: true,
          companyWebsite: true,
          phoneNumber: true,
          email: true,
          displayLogoUrl: true,
          companyLogoUrl: true,
        },
      }),
    )
    .catch(() => null);
  const display = profile?.displayName?.trim() || profile?.companyName?.trim() || null;
  const colour = (process.env.MAIL_BRAND_COLOUR ?? '').trim();
  const website = profile?.companyWebsite?.trim() || null;
  return {
    organisation: everydayOrganisationName(display),
    // Companies House names are often in capitals; prefer the same name as the company writes it.
    legalName:
      profile?.legalName?.trim() && profile.companyName?.trim() && profile.legalName.trim().toUpperCase() === profile.companyName.trim().toUpperCase()
        ? profile.companyName.trim()
        : profile?.legalName?.trim() || profile?.companyName?.trim() || display,
    companyNumber: profile?.companyNumber?.trim() || null,
    cqcProviderId: profile?.cqcProviderId?.trim() || null,
    website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
    contactPhone: profile?.phoneNumber?.trim() || null,
    contactEmail: profile?.email?.trim() || null,
    logoUrl: https(profile?.displayLogoUrl) ?? https(profile?.companyLogoUrl) ?? https(process.env.MAIL_LOGO_URL),
    brandColour: /^#[0-9a-f]{6}$/i.test(colour) ? colour : DEFAULT_BRAND,
  };
}

/**
 * How long it takes: the ready-made survey's own estimate, else about 30 seconds a question (at least
 * 2 minutes); and when it closes (in the organisation's time zone).
 */
export async function surveyEmailFacts(prisma: Db, surveyId: string, timeZone?: string): Promise<SurveyEmailFacts> {
  const survey = await Promise.resolve()
    .then(() => prisma.survey.findUnique({ where: { id: surveyId }, select: { closesAt: true, libraryMeta: true } }))
    .catch(() => null);
  const meta = (survey?.libraryMeta ?? null) as { estimatedMinutes?: unknown } | null;
  let minutes = typeof meta?.estimatedMinutes === 'number' && meta.estimatedMinutes > 0 ? meta.estimatedMinutes : null;
  if (!minutes) {
    const count = await Promise.resolve()
      .then(() => prisma.surveyQuestion.count({ where: { surveyId, deletedAt: null, isActive: true } }))
      .catch(() => 0);
    minutes = count ? Math.max(2, Math.ceil(count / 2)) : null;
  }
  const closesAt = survey?.closesAt ?? null;
  return {
    minutes,
    closesOn: closesAt ? formatSurveyDateTime(closesAt, timeZone) : null,
    closesDate: closesAt ? formatEmailDate(closesAt, timeZone) : null,
    daysLeft: closesAt ? daysUntil(closesAt, timeZone) : null,
  };
}

/** "Monday 30 November 2026" in the organisation's time zone. */
export function formatEmailDate(at: Date, timeZone = 'Europe/London'): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(at)
    .replace(',', '');
}

/** Calendar days from today to the closing day, in the organisation's time zone. */
export function daysUntil(at: Date, timeZone = 'Europe/London', now = new Date()): number {
  const day = (d: Date) => {
    const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(d)
      .split('-')
      .map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.max(0, Math.round((day(at) - day(now)) / 86_400_000));
}
