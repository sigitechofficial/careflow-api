import { AllocationChecksService, type AllocationWarning } from './allocation-checks.service';
import { AllocationWarningType } from './enums/allocation-warning-type.enum';

/** checkCapacity with a carer whose week would be 62h (contracted 40h, their maximum 60h). */
async function capacity(
  rule: { behavior: 'MANAGER_APPROVAL' | 'REQUEST_CONFIRMATION'; allowOverMax: 'NO' | 'YES' },
  opts: { overMax?: boolean; over?: boolean; noContractedHours?: boolean } = {},
) {
  const { overMax = true, over = true, noContractedHours = false } = opts;
  const carerHours = {
    rule: jest.fn().mockResolvedValue({ ...rule, graceMinutes: 0 }),
    checkNewVisits: jest.fn().mockResolvedValue({
      limitMinutes: noContractedHours ? null : 40 * 60,
      contractedMinutes: noContractedHours ? null : 40 * 60,
      graceMinutes: 0,
      over: over && !noContractedHours ? [0] : [],
      maxMinutes: 60 * 60,
      noContractedHours,
      overMax: overMax ? [0] : [],
      weeks: [{ weekStart: '2026-11-02', minutes: 62 * 60, limitMinutes: 40 * 60, extraMinutes: 0 }],
    }),
  };
  const service = new AllocationChecksService({} as never, {} as never, carerHours as never);
  const out: AllocationWarning[] = [];
  await service.checkCapacity(
    {
      scheduledJobId: 'job1',
      employeeId: 'emma',
      serviceUserId: 'su1',
      jobStart: new Date('2026-11-02T09:00:00Z'),
      jobEnd: new Date('2026-11-02T10:00:00Z'),
    },
    (w) => out.push(w),
  );
  return out;
}

describe('AllocationChecksService.checkCapacity — carer weekly hours', () => {
  it.each(['MANAGER_APPROVAL', 'REQUEST_CONFIRMATION'] as const)(
    'no contracted hours (%s): hard block',
    async (behavior) => {
      const out = await capacity({ behavior, allowOverMax: 'YES' }, { noContractedHours: true });
      expect(out).toEqual([
        expect.objectContaining({
          type: AllocationWarningType.CARER_NO_CONTRACTED_HOURS,
          severity: 'blocking',
          hardBlock: true,
        }),
      ]);
    },
  );

  it.each(['MANAGER_APPROVAL', 'REQUEST_CONFIRMATION'] as const)(
    "above the carer's maximum, allowOverMax NO (%s): hard block",
    async (behavior) => {
      const [w, ...rest] = await capacity({ behavior, allowOverMax: 'NO' });
      expect(rest).toHaveLength(0);
      expect(w).toMatchObject({
        type: AllocationWarningType.CAPACITY_EXCEEDED,
        severity: 'blocking',
        hardBlock: true,
      });
      expect(w.message).toContain("above the carer's 60h weekly maximum");
    },
  );

  it('above the maximum, allowOverMax YES + approval: goes to a manager', async () => {
    const out = await capacity({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'YES' });
    expect(out).toEqual([
      {
        type: AllocationWarningType.CAPACITY_NEEDS_APPROVAL,
        message: expect.stringContaining('so a manager must approve'),
        severity: 'info',
      },
    ]);
  });

  it('above the maximum, allowOverMax YES + no approval: a warning only', async () => {
    const out = await capacity({ behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'YES' });
    expect(out).toEqual([
      expect.objectContaining({ type: AllocationWarningType.CAPACITY_EXCEEDED, severity: 'warning' }),
    ]);
    expect(out[0].hardBlock).toBeUndefined();
  });

  it('over the contracted hours (under the maximum) + approval: goes to a manager', async () => {
    const out = await capacity({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'NO' }, { overMax: false });
    expect(out).toEqual([expect.objectContaining({ type: AllocationWarningType.CAPACITY_NEEDS_APPROVAL })]);
  });

  it('over the contracted hours (under the maximum) + no approval: a warning', async () => {
    const out = await capacity({ behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'NO' }, { overMax: false });
    expect(out).toEqual([
      expect.objectContaining({ type: AllocationWarningType.CAPACITY_EXCEEDED, severity: 'warning' }),
    ]);
  });

  it('within the hours: nothing', async () => {
    const out = await capacity({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'NO' }, { overMax: false, over: false });
    expect(out).toEqual([]);
  });
});

describe('genderPreferenceMismatch', () => {
  const { genderPreferenceMismatch } = jest.requireActual('./allocation-checks.service') as typeof import('./allocation-checks.service');
  it('warns when the carer is not the preferred gender', () => {
    expect(genderPreferenceMismatch('female', 'Male')).toBe(
      'They prefer a female carer for personal care (DOM Care); this carer is recorded as Male.',
    );
  });
  it('is quiet when it matches, there is no clear preference, or the carer gender is unknown', () => {
    expect(genderPreferenceMismatch('female', 'Female')).toBeNull();
    expect(genderPreferenceMismatch('case_by_case', 'Male')).toBeNull();
    expect(genderPreferenceMismatch(null, 'Male')).toBeNull();
    expect(genderPreferenceMismatch('male', null)).toBeNull();
  });
});
