import type { PrismaService } from '../prisma/prisma.service';
import { everydayOrganisationName } from '../surveys/survey-email-branding';

/**
 * Everything an account email shows about the organisation and where its links go, from real settings:
 * - name, logo, legal line, registered address and website: Company Details (CompanyProfile);
 * - the CareFlow site (sign-in, forgot password, /get-app, email images): ADMIN_APP_URL;
 * - where set-password links open: PASSWORD_RESET_URL_BASE (else ADMIN_APP_URL; localhost outside production).
 *
 * Logo: Company Details › Company logo, else the display logo, else MAIL_LOGO_URL. An uploaded logo is stored as
 * /uploads/…, which the API serves publicly: it is made absolute with API_PUBLIC_URL (inboxes need a full https
 * address). Store badges are served from the admin site's /email folder.
 */
export type AccountEmailBranding = {
  /** Everyday name for greetings and sign-off: "Allfor Care". */
  organisation: string;
  logoUrl: string | null;
  /** "ALLFOR CARE SERVICES LIMITED · Company no. 05142064 · CQC provider ID 1-101656545" */
  legalLine: string | null;
  addressLine: string | null;
  website: string | null;
  companyPhone: string | null;
  /** The CareFlow site, no trailing slash ("https://careflow.allforcare.co.uk"). */
  siteUrl: string;
  /** Where set-password links open, no trailing slash. */
  setPasswordUrlBase: string;
  appStoreBadgeUrl: string;
  googlePlayBadgeUrl: string;
};

export type BranchContact = { name: string; phone: string | null };

type Env = Record<string, string | undefined>;
const DEV_SITE = 'http://localhost:5173';

function trimUrl(v: string | undefined | null): string {
  return (v ?? '').trim().replace(/\/+$/, '');
}

/** The CareFlow site: ADMIN_APP_URL, else PASSWORD_RESET_URL_BASE, else localhost outside production. */
export function careflowSiteUrl(env: Env = process.env): string | null {
  const site = trimUrl(env.ADMIN_APP_URL) || trimUrl(env.PASSWORD_RESET_URL_BASE);
  if (site) return site;
  return env.NODE_ENV === 'production' ? null : DEV_SITE;
}

/** Where set-password links open: PASSWORD_RESET_URL_BASE, else the CareFlow site. */
export function setPasswordUrlBase(env: Env = process.env): string | null {
  return trimUrl(env.PASSWORD_RESET_URL_BASE) || careflowSiteUrl(env);
}

/** A stored logo as a full address: https as is; an /uploads/… path via API_PUBLIC_URL. */
export function absoluteLogoUrl(stored: string | null | undefined, env: Env = process.env): string | null {
  const v = stored?.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const api = trimUrl(env.API_PUBLIC_URL);
  if (api && v.startsWith('/uploads/')) return `${api}${v}`;
  return null;
}

/** "careflow.allforcare.co.uk" from "https://careflow.allforcare.co.uk/". */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

type Db = Pick<PrismaService, 'companyProfile'>;

export async function loadAccountEmailBranding(prisma: Db, env: Env = process.env): Promise<AccountEmailBranding | null> {
  const siteUrl = careflowSiteUrl(env);
  const setPasswordBase = setPasswordUrlBase(env);
  if (!siteUrl || !setPasswordBase) return null;
  const p = await Promise.resolve()
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
          companyLogoUrl: true,
          displayLogoUrl: true,
          registeredAddressLine1: true,
          registeredAddressLine2: true,
          registeredTown: true,
          registeredPostcode: true,
        },
      }),
    )
    .catch(() => null);

  const display = p?.displayName?.trim() || p?.companyName?.trim() || null;
  const legalName = p?.legalName?.trim() || p?.companyName?.trim() || null;
  const legalLine = [
    legalName,
    p?.companyNumber?.trim() ? `Company no. ${p.companyNumber.trim()}` : null,
    p?.cqcProviderId?.trim() ? `CQC provider ID ${p.cqcProviderId.trim()}` : null,
  ].filter(Boolean);
  const town = [p?.registeredTown?.trim(), p?.registeredPostcode?.trim()].filter(Boolean).join(' ');
  const addressLine = [p?.registeredAddressLine1?.trim(), p?.registeredAddressLine2?.trim(), town].filter(Boolean).join(', ');
  const website = p?.companyWebsite?.trim() || null;

  return {
    organisation: everydayOrganisationName(display) ?? 'CareFlow',
    logoUrl: absoluteLogoUrl(p?.companyLogoUrl, env) ?? absoluteLogoUrl(p?.displayLogoUrl, env) ?? absoluteLogoUrl(env.MAIL_LOGO_URL, env),
    legalLine: legalLine.length ? legalLine.join(' · ') : null,
    addressLine: addressLine || null,
    website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : null,
    companyPhone: p?.phoneNumber?.trim() || null,
    siteUrl,
    setPasswordUrlBase: setPasswordBase,
    appStoreBadgeUrl: `${siteUrl}/email/app-store-badge.png`,
    googlePlayBadgeUrl: `${siteUrl}/email/google-play-badge.png`,
  };
}

type BranchDb = Pick<PrismaService, 'location' | 'scheduleArea'>;

/** A branch's name and phone (the phone lives on the branch's schedule area record). */
export async function loadBranchContact(prisma: BranchDb, locationId: string | null | undefined): Promise<BranchContact | null> {
  if (!locationId) return null;
  const [location, area] = await Promise.all([
    prisma.location.findFirst({ where: { id: locationId, deletedAt: null }, select: { name: true } }),
    prisma.scheduleArea.findFirst({
      where: { locationId, isActive: true, phone: { not: null } },
      orderBy: { sortOrder: 'asc' },
      select: { phone: true },
    }),
  ]);
  if (!location) return null;
  return { name: location.name, phone: area?.phone?.trim() || null };
}
