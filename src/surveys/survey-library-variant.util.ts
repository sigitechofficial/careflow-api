/**
 * Named and anonymous versions of a ready-made survey (libraryMeta.anonymousVariant; written by
 * prisma/seed-lib/survey-library.ts surveyLibraryMeta). A named ready-made survey may declare an
 * anonymous version with its own introduction and privacy notice, leaving out the contact-me
 * question, questions that only make sense with a name and their alerts. An organisation chooses
 * the version at New survey (SurveysService.duplicate from an adopted template); it is fixed then.
 *
 * The anonymous version is recognised without a column of its own: a survey from a named ready-made
 * survey can only be anonymous through this choice (anonymityLocked), so an anonymous survey whose
 * ready-made details declare an anonymous version is that version.
 */

export type LibraryAnonymousVariant = {
  introduction: string;
  privacyNotice: string;
  /** Its own closing screen (else the survey's). */
  closingMessage?: string;
  /** Question keys the anonymous version does not ask. */
  leaveOut: string[];
  /** Alert positions (from 0) it does not have. */
  leaveOutAlerts: number[];
  /** Its own default access (else the survey's). */
  access?: unknown;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The anonymous version a ready-made survey declares, or null. */
export function libraryAnonymousVariant(libraryMeta: unknown): LibraryAnonymousVariant | null {
  const v = isObject(libraryMeta) && isObject(libraryMeta.anonymousVariant) ? libraryMeta.anonymousVariant : null;
  if (!v || typeof v.introduction !== 'string' || typeof v.privacyNotice !== 'string') return null;
  return {
    introduction: v.introduction,
    privacyNotice: v.privacyNotice,
    ...(typeof v.closingMessage === 'string' && v.closingMessage.trim() ? { closingMessage: v.closingMessage.trim() } : {}),
    leaveOut: strings(v.leaveOut),
    leaveOutAlerts: Array.isArray(v.leaveOutAlerts) ? v.leaveOutAlerts.filter((n): n is number => Number.isInteger(n)) : [],
    ...(v.access !== undefined ? { access: v.access } : {}),
  };
}

/** What people read before the questions of the anonymous version (as the library does it). */
export function variantDescription(v: LibraryAnonymousVariant): string {
  return `${v.introduction.trim()}\n\n${v.privacyNotice.trim()}`;
}

/**
 * The ready-made details as they apply to a survey: for the anonymous version, its introduction,
 * privacy notice and access, and the alerts it leaves out marked retired (so alert positions, which
 * are rule identities, do not move). Anything else is returned as it is.
 */
export function effectiveLibraryMeta<T>(libraryMeta: T, isAnonymous: boolean): T {
  const v = isAnonymous ? libraryAnonymousVariant(libraryMeta) : null;
  if (!v || !isObject(libraryMeta)) return libraryMeta;
  const { anonymousVariant: _variant, ...meta } = libraryMeta;
  const guidance = isObject(meta.managerGuidance) ? meta.managerGuidance : null;
  const alerts = guidance && Array.isArray(guidance.alerts) ? guidance.alerts : [];
  return {
    ...meta,
    introduction: v.introduction,
    privacyNotice: v.privacyNotice,
    ...(v.access !== undefined ? { access: v.access } : {}),
    ...(guidance
      ? {
          managerGuidance: {
            ...guidance,
            alerts: alerts.map((a, i) => (v.leaveOutAlerts.includes(i) && isObject(a) ? { ...a, retired: true } : a)),
          },
        }
      : {}),
    /** This is the anonymous version of the ready-made survey. */
    variant: 'ANONYMOUS',
  } as T;
}
