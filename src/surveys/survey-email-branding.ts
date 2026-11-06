import type { PrismaService } from '../prisma/prisma.service';
import { formatSurveyDateTime } from './survey-recurrence.util';

/**
 * What every survey email shows about the organisation and the survey: the organisation's display
 * name, office phone and email (for help and other formats), an https logo when there is one, how long
 * the survey takes and when it closes. Read once per send; any failure falls back to plain wording.
 */
export type SurveyEmailBranding = {
  organisation: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
};

export type SurveyEmailFacts = {
  minutes: number | null;
  closesOn: string | null;
};

type Db = Pick<PrismaService, 'companyProfile' | 'survey' | 'surveyQuestion'>;

export async function surveyEmailBranding(prisma: Db): Promise<SurveyEmailBranding> {
  const profile = await Promise.resolve()
    .then(() =>
      prisma.companyProfile.findFirst({
        select: { displayName: true, companyName: true, phoneNumber: true, email: true, displayLogoUrl: true, companyLogoUrl: true },
      }),
    )
    .catch(() => null);
  const https = (u: string | null | undefined) => (u && /^https:\/\//i.test(u.trim()) ? u.trim() : null);
  return {
    organisation: profile?.displayName?.trim() || profile?.companyName?.trim() || null,
    contactPhone: profile?.phoneNumber?.trim() || null,
    contactEmail: profile?.email?.trim() || null,
    logoUrl: https(profile?.displayLogoUrl) ?? https(profile?.companyLogoUrl),
  };
}

/**
 * How long it takes: the ready-made survey's own estimate, else about 30 seconds a question (at least
 * 2 minutes); and when it closes.
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
  return { minutes, closesOn: survey?.closesAt ? formatSurveyDateTime(survey.closesAt, timeZone) : null };
}
