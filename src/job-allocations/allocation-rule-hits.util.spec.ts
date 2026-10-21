import { evaluateAllocationRuleHits } from './allocation-rule-hits.util';
import {
  DEFAULT_DOM_CARE_ALLOCATION_RULES,
  type DomAllocationRuleBehavior,
  type DomCareAllocationRule,
} from '../organisation-general-settings/dom-care-allocation-rules.util';

const at = (hm: string) => new Date(`2026-11-02T${hm}:00.000Z`);

function rulesWith(overrides: Record<string, { behavior?: DomAllocationRuleBehavior; minutes?: number }>) {
  return DEFAULT_DOM_CARE_ALLOCATION_RULES.map(
    (r): DomCareAllocationRule => ({ ...r, ...(overrides[r.key] ?? {}) }),
  );
}

function db(opts: {
  allocations?: Array<{ employeeId: string; start: string; end: string }>;
  absences?: Array<{ employeeId: string; absenceType: string }>;
  skills?: Array<{ employeeId: string; name: string }>;
}) {
  return {
    employeeHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    employeeNonCoreActivity: { findMany: jest.fn().mockResolvedValue([]) },
    employeeAbsenceRecord: { findMany: jest.fn().mockResolvedValue(opts.absences ?? []) },
    jobAllocation: {
      findMany: jest.fn().mockResolvedValue(
        (opts.allocations ?? []).map((a) => ({
          employeeId: a.employeeId,
          scheduledStartDateTime: null,
          scheduledEndDateTime: null,
          durationMinutes: null,
          scheduledJob: {
            scheduledStartDateTime: at(a.start),
            scheduledEndDateTime: at(a.end),
            estimatedDurationMinutes: null,
          },
        })),
      ),
    },
    employeeSkill: {
      findMany: jest.fn().mockResolvedValue(
        (opts.skills ?? []).map((s) => ({
          employeeId: s.employeeId,
          skillTypeId: null,
          expiryDate: null,
          skillType: { name: s.name },
        })),
      ),
    },
  } as never;
}

const base = { employeeIds: ['e1'], jobStart: at('09:00'), jobEnd: at('10:00') };

describe('evaluateAllocationRuleHits', () => {
  it('hard-blocks an overlap longer than the allowed overlap minutes', async () => {
    const hits = await evaluateAllocationRuleHits(db({ allocations: [{ employeeId: 'e1', start: '09:30', end: '10:30' }] }), {
      ...base,
      rules: rulesWith({ allow_overlap: { behavior: 'REQUEST_CONFIRMATION', minutes: 0 } }),
    });
    expect(hits.get('e1')).toEqual([expect.objectContaining({ key: 'allow_overlap', block: true })]);
  });

  it('applies the overlap rule behaviour within the allowed minutes', async () => {
    const hits = await evaluateAllocationRuleHits(db({ allocations: [{ employeeId: 'e1', start: '09:50', end: '10:30' }] }), {
      ...base,
      rules: rulesWith({ allow_overlap: { behavior: 'REQUEST_CONFIRMATION', minutes: 15 } }),
    });
    expect(hits.get('e1')).toEqual([expect.objectContaining({ key: 'allow_overlap', block: false })]);
  });

  it('flags a gap shorter than time between jobs, blocking only when Don’t allow', async () => {
    const data = { allocations: [{ employeeId: 'e1', start: '10:05', end: '11:00' }] };
    const warn = await evaluateAllocationRuleHits(db(data), {
      ...base,
      rules: rulesWith({ time_between_jobs: { behavior: 'REQUEST_CONFIRMATION', minutes: 15 } }),
    });
    expect(warn.get('e1')).toEqual([expect.objectContaining({ key: 'time_between_jobs', block: false })]);
    const block = await evaluateAllocationRuleHits(db(data), {
      ...base,
      rules: rulesWith({ time_between_jobs: { behavior: 'DONT_ALLOW', minutes: 15 } }),
    });
    expect(block.get('e1')).toEqual([expect.objectContaining({ key: 'time_between_jobs', block: true })]);
    const allow = await evaluateAllocationRuleHits(db(data), {
      ...base,
      rules: rulesWith({ time_between_jobs: { behavior: 'ALWAYS_ALLOW', minutes: 15 } }),
    });
    expect(allow.get('e1')).toBeUndefined();
  });

  it('skips leave when the rule is Always allow', async () => {
    const data = { absences: [{ employeeId: 'e1', absenceType: 'Sickness' }] };
    const blocked = await evaluateAllocationRuleHits(db(data), { ...base, rules: rulesWith({}) });
    expect(blocked.get('e1')).toEqual([
      { key: 'carer_on_leave', message: 'Employee is off sick for this visit date', block: true },
    ]);
    const allowed = await evaluateAllocationRuleHits(db(data), {
      ...base,
      rules: rulesWith({ carer_on_leave: { behavior: 'ALWAYS_ALLOW' } }),
    });
    expect(allowed.get('e1')).toBeUndefined();
  });

  it('flags a medication visit when the carer has no medication skill', async () => {
    const rules = rulesWith({ medication_not_trained: { behavior: 'DONT_ALLOW' } });
    const untrained = await evaluateAllocationRuleHits(db({}), { ...base, rules, medicationRequired: true });
    expect(untrained.get('e1')).toEqual([expect.objectContaining({ key: 'medication_not_trained', block: true })]);
    const trained = await evaluateAllocationRuleHits(db({ skills: [{ employeeId: 'e1', name: 'Medication Level 2' }] }), {
      ...base,
      rules,
      medicationRequired: true,
    });
    expect(trained.get('e1')).toBeUndefined();
  });
});
