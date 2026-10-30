import { EmployeeExtraHoursPeriod } from '@prisma/client';
import { CarerExtraHoursService } from './carer-extra-hours.service';

/**
 * Extra hours above the carer's maximum weekly hours (Employment; blank = 60h): refused, unless
 * Settings → Dom Rules allows going over the maximum (anyone who may give extra hours).
 */
describe('CarerExtraHoursService checkGrant — carer maximum weekly hours', () => {
  function build(allowOverMax: 'NO' | 'YES', employment: { contractedWeeklyHours: number | null; maximumWeeklyHours: number | null }) {
    const prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
      employeeEmployment: { findUnique: jest.fn().mockResolvedValue(employment) },
      employeeExtraWeeklyHours: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const orgSettings = {
      getOperationalDisplaySettings: jest.fn().mockResolvedValue({ dateDisplayFormat: 'DD/MM/YYYY' }),
    };
    const carerHours = {
      rule: jest.fn().mockResolvedValue({ allowOverMax, behavior: 'MANAGER_APPROVAL', extraHoursNeedApproval: false }),
    };
    const service = new CarerExtraHoursService(
      prisma as never,
      {} as never,
      orgSettings as never,
      carerHours as never,
      {} as never,
      {} as never,
    );
    return (extraHours: number) =>
      (
        service as unknown as {
          checkGrant: (dto: unknown) => Promise<{ overMaxWarning: string | null }>;
        }
      ).checkGrant({
        employeeId: 'e1',
        periodType: EmployeeExtraHoursPeriod.WEEK,
        startDate: '2026-11-02',
        extraHours,
      });
  }

  it("refuses above the carer's maximum when the setting is No", async () => {
    const check = build('NO', { contractedWeeklyHours: 16, maximumWeeklyHours: 20 });
    await expect(check(8)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARER_OVER_MAX_WEEKLY_HOURS', employeeId: 'e1' }),
    });
  });

  it('goes ahead above the maximum with a warning when the setting is Yes', async () => {
    const check = build('YES', { contractedWeeklyHours: 16, maximumWeeklyHours: 20 });
    const out = await check(8);
    expect(out.overMaxWarning).toContain("above the carer's 20h weekly maximum");
  });

  it('a blank maximum counts as 60h', async () => {
    const check = build('NO', { contractedWeeklyHours: 50, maximumWeeklyHours: null });
    await expect(check(10)).resolves.toMatchObject({ overMaxWarning: null });
    await expect(check(11)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARER_OVER_MAX_WEEKLY_HOURS' }),
    });
  });

  it('refuses a carer with no contracted hours', async () => {
    const check = build('YES', { contractedWeeklyHours: null, maximumWeeklyHours: 40 });
    await expect(check(4)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARER_NO_CONTRACTED_HOURS' }),
    });
  });
});
