/**
 * Group breakdowns (by branch / job title) for survey results.
 *
 * Anonymous surveys follow a minimum group size: nothing is broken down until at least
 * MIN_ANONYMOUS_GROUP_SIZE responses exist, groups smaller than that are merged into
 * "Other groups", and if that merged group is itself too small the breakdown is withheld —
 * otherwise a small branch or a one-person job title would identify who answered.
 */
export const MIN_ANONYMOUS_GROUP_SIZE = 5;

export type SurveyBreakdownGroup = {
  key: string;
  label: string;
  responses: number;
};

export type SurveyBreakdown = {
  /** branch / jobTitle: who answered by group; channel / respondent: "How people answered". */
  dimension: 'branch' | 'jobTitle' | 'channel' | 'respondent';
  groups: SurveyBreakdownGroup[];
  /** True when groups were withheld to protect anonymity. */
  suppressed: boolean;
  note: string | null;
};

export const OTHER_GROUPS_KEY = 'other';
export const UNKNOWN_GROUP_KEY = 'unknown';

export function buildSurveyBreakdown(
  dimension: SurveyBreakdown['dimension'],
  groups: SurveyBreakdownGroup[],
  anonymous: boolean,
): SurveyBreakdown {
  const sorted = [...groups]
    .filter((g) => g.responses > 0)
    .sort((a, b) => b.responses - a.responses || a.label.localeCompare(b.label));
  if (!anonymous) {
    return { dimension, groups: sorted, suppressed: false, note: null };
  }

  const total = sorted.reduce((sum, g) => sum + g.responses, 0);
  const withheld = (note: string): SurveyBreakdown => ({
    dimension,
    groups: [],
    suppressed: true,
    note,
  });
  if (total < MIN_ANONYMOUS_GROUP_SIZE) {
    return withheld(
      `Shown once there are at least ${MIN_ANONYMOUS_GROUP_SIZE} responses, so nobody can be identified.`,
    );
  }

  const large = sorted.filter((g) => g.responses >= MIN_ANONYMOUS_GROUP_SIZE);
  const smallTotal = total - large.reduce((sum, g) => sum + g.responses, 0);
  if (smallTotal === 0) {
    return { dimension, groups: large, suppressed: false, note: null };
  }
  if (smallTotal < MIN_ANONYMOUS_GROUP_SIZE) {
    return withheld(
      `Not shown: some groups have fewer than ${MIN_ANONYMOUS_GROUP_SIZE} responses, which could identify people.`,
    );
  }
  return {
    dimension,
    groups: [
      ...large,
      { key: OTHER_GROUPS_KEY, label: 'Other groups (combined)', responses: smallTotal },
    ],
    suppressed: false,
    note: `Groups with fewer than ${MIN_ANONYMOUS_GROUP_SIZE} responses are combined.`,
  };
}
