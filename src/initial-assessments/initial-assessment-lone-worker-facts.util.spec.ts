import { buildLoneWorkerSystemFacts } from './initial-assessment-lone-worker-facts.util';

function prismaWith(parts: {
  serviceStartDate?: Date | null;
  slots?: Array<{ plannedStartTime: string; durationMinutes: number | null; requiredCarers: number; nightDuty: string }> | null;
  domCarers?: number | null;
  sos?: number;
  safeguarding?: number;
}) {
  return {
    serviceUser: { findUnique: async () => ({ serviceStartDate: parts.serviceStartDate ?? null }) },
    serviceUserVisitPlan: { findFirst: async () => (parts.slots ? { slots: parts.slots } : null) },
    serviceUserDomCare: {
      findUnique: async () => (parts.domCarers != null ? { numberOfCarers: parts.domCarers } : null),
    },
    ecmException: { count: async () => parts.sos ?? 0 },
    incident: { count: async () => parts.safeguarding ?? 0 },
  } as never;
}

describe('buildLoneWorkerSystemFacts', () => {
  const now = new Date('2026-09-29T12:00:00Z');

  it('reads carers, night visits and duration from the active visit plan', async () => {
    const facts = await buildLoneWorkerSystemFacts(
      prismaWith({
        serviceStartDate: new Date('2026-09-20T00:00:00Z'),
        slots: [
          { plannedStartTime: '08:00', durationMinutes: 45, requiredCarers: 1, nightDuty: 'NONE' },
          { plannedStartTime: '21:30', durationMinutes: 120, requiredCarers: 2, nightDuty: 'NONE' },
        ],
        sos: 1,
      }),
      'su-1',
      now,
    );
    expect(facts).toMatchObject({
      isNewServiceUser: true,
      plannedCarersPerVisit: 2,
      plannedCarersSource: 'visit_plan',
      hasNightOrLateVisits: true,
      longestVisitMinutes: 120,
      sosEventCount: 1,
    });
  });

  it('falls back to DOM Care and says nothing when there is no plan yet', async () => {
    const facts = await buildLoneWorkerSystemFacts(prismaWith({ domCarers: 1 }), 'su-1', now);
    expect(facts).toMatchObject({
      isNewServiceUser: null,
      plannedCarersPerVisit: 1,
      plannedCarersSource: 'dom_care',
      hasNightOrLateVisits: null,
      longestVisitMinutes: null,
    });
  });
});
