import type { AssessmentReviewSchedule } from './assessment-review-schedule';

export type CarePathwayAssessmentCatalogEntry = {
  formName: string;
  nameSlug: string;
  reviewSchedule: AssessmentReviewSchedule;
  /** Published care plan form names (`CarePathwayForm.name`) to auto-link on completion. */
  linkCarePlanFormNames: string[];
};

export function normalizeCarePathwayFormName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

/** CQC / NICE-informed defaults for seeded care pathway ASSESSMENT forms. */
export const CARE_PATHWAY_ASSESSMENT_CATALOG: CarePathwayAssessmentCatalogEntry[] = [
  {
    formName: 'Assessing For Medication in home care',
    nameSlug: 'assessing-for-medication-in-home-care',
    reviewSchedule: {
      kind: 'interval',
      defaultIntervalDays: 365,
      dueSoonLeadDays: 30,
      guidanceSource: 'NICE NG67 / CQC medicines',
      guidanceSummary:
        'Review medication assessment at least annually and whenever medicines, capacity, or support changes.',
    },
    linkCarePlanFormNames: ['Medication'],
  },
  {
    formName: 'Bed Rail Assessment',
    nameSlug: 'bed-rail-assessment',
    reviewSchedule: {
      kind: 'interval',
      defaultIntervalDays: 365,
      dueSoonLeadDays: 30,
      guidanceSource: 'CQC / equipment safety',
      guidanceSummary:
        'Reassess bed rail use at least annually and after falls, hospital discharge, or equipment changes.',
    },
    linkCarePlanFormNames: ['Personal Safety', 'Mobility'],
  },
  {
    formName: 'Capability Assessment',
    nameSlug: 'capability-assessment',
    reviewSchedule: {
      kind: 'interval',
      defaultIntervalDays: 365,
      dueSoonLeadDays: 30,
      guidanceSource: 'CQC Regulation 9',
      guidanceSummary:
        'Review capability and support needs at least annually or when the person’s needs change significantly.',
    },
    linkCarePlanFormNames: ['Person Centred care plan', 'Home Care Plan'],
  },
  {
    formName: 'Choking Risk Assessment',
    nameSlug: 'choking-risk-assessment',
    reviewSchedule: {
      kind: 'interval',
      defaultIntervalDays: 180,
      elevatedRiskIntervalDays: 90,
      dueSoonLeadDays: 14,
      guidanceSource: 'NICE NG28 / dysphagia',
      guidanceSummary:
        'Review choking and swallowing risk at least every 6 months; more often if swallowing deteriorates.',
    },
    linkCarePlanFormNames: ['Eating and Drinking'],
  },
  {
    formName: 'COVID-19 Best Interest Checklist',
    nameSlug: 'covid-19-best-interest-checklist',
    reviewSchedule: {
      kind: 'event_driven',
      dueSoonLeadDays: 7,
      guidanceSource: 'MCA Code of Practice',
      guidanceSummary:
        'Complete when a COVID-19 related decision requires a formal best-interest process — not on a fixed calendar.',
    },
    linkCarePlanFormNames: ['Risk Assessment'],
  },
];

export function resolveCarePathwayAssessmentCatalogEntry(
  formName: string | null | undefined,
): CarePathwayAssessmentCatalogEntry | null {
  if (!formName?.trim()) return null;
  const slug = normalizeCarePathwayFormName(formName);
  const exact = CARE_PATHWAY_ASSESSMENT_CATALOG.find(
    (entry) => entry.nameSlug === slug || normalizeCarePathwayFormName(entry.formName) === slug,
  );
  if (exact) return exact;

  return (
    CARE_PATHWAY_ASSESSMENT_CATALOG.find(
      (entry) => slug.includes(entry.nameSlug) || entry.nameSlug.includes(slug),
    ) ?? null
  );
}

export function getCarePathwayFormReviewSchedule(
  formName: string | null | undefined,
): AssessmentReviewSchedule | null {
  return resolveCarePathwayAssessmentCatalogEntry(formName)?.reviewSchedule ?? null;
}

export function getCarePathwayAutoLinkCarePlanNames(
  formName: string | null | undefined,
): string[] {
  return resolveCarePathwayAssessmentCatalogEntry(formName)?.linkCarePlanFormNames ?? [];
}
