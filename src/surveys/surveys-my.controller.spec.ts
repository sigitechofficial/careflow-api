import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SurveysMyController } from './surveys-my.controller';

/** My surveys (web): matched to the staff record by email; opened by survey, never by token. */
describe('SurveysMyController', () => {
  const user = (over: Record<string, unknown> = {}) => ({ id: 'u1', email: 'Ana@Example.org', accountKind: 'user', ...over }) as any;
  const setup = (opts: { staff?: string[]; recipient?: { token: string } | null } = {}) => {
    const prisma: any = {
      employeePersonalDetail: { findMany: jest.fn(async () => (opts.staff ?? ['emp-1']).map((employeeId) => ({ employeeId }))) },
      surveyRecipient: { findFirst: jest.fn(async () => (opts.recipient === undefined ? { token: 'tok-1' } : opts.recipient)) },
    };
    const service: any = {
      listForEmployeeApp: jest.fn(async () => ({ data: [{ surveyId: 's1', title: 'T', token: 'tok-1', questions: [], sectionIntros: {} }] })),
      getEmployeeAppForm: jest.fn(async () => ({ data: {} })),
      submitEmployeeAppResponse: jest.fn(async () => ({ data: {} })),
    };
    return { prisma, service, c: new SurveysMyController(service, prisma) };
  };
  const req = { headers: {}, ip: '10.0.0.1' } as any;

  it('lists my surveys without their tokens', async () => {
    const { c, service } = setup();
    const res = await c.list(user());
    expect(service.listForEmployeeApp).toHaveBeenCalledWith('emp-1');
    expect(res.data.items[0]).not.toHaveProperty('token');
    expect(JSON.stringify(res)).not.toContain('tok-1');
  });

  it('only CareFlow web logins; carer-app, portal and inspector logins are refused', async () => {
    const { c } = setup();
    for (const accountKind of ['employee', 'service_user', 'temporary_inspector']) {
      await expect(c.list(user({ accountKind }))).rejects.toThrow(ForbiddenException);
    }
  });

  it('no staff record, or two with the same email: nothing is linked and nothing can be opened', async () => {
    for (const staff of [[], ['emp-1', 'emp-2']]) {
      const { c, service } = setup({ staff });
      expect((await c.list(user())).data).toEqual({ linked: false, items: [] });
      await expect(c.submit(user(), 's1', { answers: [] } as any, req)).rejects.toThrow(NotFoundException);
      expect(service.submitEmployeeAppResponse).not.toHaveBeenCalled();
    }
  });

  it('a survey I was not sent is not found; my own is answered as me only', async () => {
    const none = setup({ recipient: null });
    await expect(none.c.form(user(), 's2')).rejects.toThrow(NotFoundException);
    const mine = setup();
    await mine.c.submit(user(), 's1', { answers: [] } as any, req);
    expect(mine.prisma.surveyRecipient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { surveyId: 's1', employeeId: 'emp-1', targetKind: 'EMPLOYEE' } }),
    );
    expect(mine.service.submitEmployeeAppResponse).toHaveBeenCalledWith('emp-1', 'tok-1', { answers: [] }, expect.anything());
  });
});
