import { SurveysService } from './surveys.service';

/**
 * People held back by the 4-week rule on a month copy of a survey sent when care ends (or a complaint
 * closes): released with the same rule as the first send, so their ended care does not lapse them.
 */
describe('held-back release on event-sent month copies', () => {
  function setup(eventTrigger: unknown) {
    const prisma: any = {
      survey: { findUnique: jest.fn(async () => ({ eventTrigger })) },
      surveyHeldBack: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const svc = new SurveysService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const resolveTargets = jest.spyOn(svc as any, 'resolveTargets').mockResolvedValue({ ids: [] });
    const copy = { id: 'p1', clonedFromId: 's1', targetKind: 'SERVICE_USER', isAnonymous: false, locationIds: [], roleIds: [], audienceEmployeeIds: [], audienceServiceUserIds: [] };
    const send = () => (svc as any).sendToHeld(copy, [{ id: 'h1', employeeId: null, serviceUserId: 'su1' }], null, new Date());
    return { send, resolveTargets };
  }
  const trigger = (event: string) => ({ event, delayDays: 14, windowDays: 7, exclusions: [], options: {}, since: '2026-11-01' });

  it('a care-ended survey still reaches someone discharged', async () => {
    const { send, resolveTargets } = setup(trigger('CARE_ENDED'));
    await send();
    expect(resolveTargets.mock.calls[0][4]).toMatchObject({ repeating: false });
  });

  it('other month copies keep the stricter rule (care ended: not sent)', async () => {
    const { send, resolveTargets } = setup(trigger('HOSPITAL_DISCHARGE'));
    await send();
    expect(resolveTargets.mock.calls[0][4]).toMatchObject({ repeating: true });
  });
});
