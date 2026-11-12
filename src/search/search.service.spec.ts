import { ForbiddenException } from '@nestjs/common';
import { SearchService } from './search.service';
import { ServiceUsersService } from '../service-users/service-users.service';
import { EmployeesService } from '../employees/employees.service';
import { PoliciesService } from '../policies/policies.service';

const actor = (permissions: string[]) => ({ id: 'u1', permissions, roles: ['Manager'], assignedLocationIds: ['loc-1'] }) as any;

function setup(opts: { serviceUsers?: (q: string) => any[]; policiesFail?: boolean } = {}) {
  const serviceUsers = {
    list: jest.fn(async (query: { search: string }) => ({ data: (opts.serviceUsers ?? (() => []))(query.search) })),
  };
  const employees = { list: jest.fn(async () => ({ data: [{ id: 'e1', fullName: 'Sam Office', jobTitle: { name: 'Coordinator' } }] })) };
  const policies = {
    list: jest.fn(async () => {
      if (opts.policiesFail) throw new Error('boom');
      return { data: [{ id: 'p1', title: 'Moving and handling', reference: 'POL-1' }] };
    }),
  };
  const services = new Map<unknown, unknown>([
    [ServiceUsersService, serviceUsers],
    [EmployeesService, employees],
    [PoliciesService, policies],
  ]);
  const moduleRef = { get: jest.fn((t: unknown) => services.get(t)) };
  const prisma: any = {
    serviceUserDocumentRecord: {
      findMany: jest.fn(async () => [
        { id: 'd1', title: 'Care plan', serviceUserId: 'su-in', serviceUser: { firstName: 'Mary', lastName: 'Jones' }, documentType: { name: 'Care plan' } },
        { id: 'd2', title: 'Care plan', serviceUserId: 'su-out', serviceUser: { firstName: 'Other', lastName: 'Branch' }, documentType: { name: 'Care plan' } },
      ]),
    },
    serviceUserContact: { findMany: jest.fn(async () => []) },
    serviceUser: { findMany: jest.fn(async () => [{ firstName: 'Mary', lastName: 'Jones', preferredName: null }]) },
    employeePersonalDetail: { findMany: jest.fn(async () => []) },
  };
  const orgScope: any = {
    fromRequestUser: () => ({ locationIds: ['loc-1'] }),
    assertServiceUserInScope: jest.fn(async (_s: unknown, id: string) => {
      if (id === 'su-out') throw new ForbiddenException();
    }),
  };
  return { service: new SearchService(prisma, orgScope, moduleRef as any), serviceUsers, employees, policies, prisma };
}

describe('SearchService (Find anything)', () => {
  it('searches only the kinds of record the person may see', async () => {
    const { service, serviceUsers, employees, policies } = setup({ serviceUsers: () => [{ id: 'su1', firstName: 'Mary', lastName: 'Jones' }] });
    const res = await service.search(actor(['service_users.read']), 'Mary');
    expect(serviceUsers.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'Mary' }), expect.anything());
    expect(employees.list).not.toHaveBeenCalled();
    expect(policies.list).not.toHaveBeenCalled();
    expect(res.data.hits[0]).toMatchObject({ section: 'Service users', label: 'Mary Jones', href: '/service-users/su1/profile', recordType: 'serviceUser', recordId: 'su1' });
  });

  it('documents of people outside the person’s branches are left out', async () => {
    const { service } = setup();
    const res = await service.search(actor(['service_users.documents.read']), 'care plan');
    const docs = res.data.hits.filter((h) => h.section === 'Service user documents');
    expect(docs.map((d) => d.id)).toEqual(['sudoc:d1']);
    expect(docs[0]).toMatchObject({ detail: 'Mary Jones · Care plan', href: '/service-users/su-in/documents' });
  });

  it('one kind failing does not hide the others', async () => {
    const { service } = setup({ policiesFail: true });
    const res = await service.search(actor(['policies.read', 'employees.read']), 'Sam');
    expect(res.data.hits.map((h) => h.section)).toEqual(['Staff']);
  });

  it('nothing found: a typo in a name is offered as "did you mean", searched through the same scoped list', async () => {
    const { service, serviceUsers, prisma } = setup({ serviceUsers: (q) => (q === 'Mary Jones' ? [{ id: 'su1', firstName: 'Mary', lastName: 'Jones' }] : []) });
    prisma.serviceUserDocumentRecord.findMany.mockResolvedValue([]);
    const res = await service.search(actor(['service_users.read']), 'Mery Jnes');
    expect(res.data.hits).toEqual([]);
    expect(res.data.didYouMean).toBe('Mary Jones');
    expect(res.data.suggested.map((h) => h.label)).toEqual(['Mary Jones']);
    expect(serviceUsers.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'Mary Jones' }), expect.anything());
  });

  it('too short: nothing is searched', async () => {
    const { service, serviceUsers } = setup();
    await expect(service.search(actor(['service_users.read']), 'M')).resolves.toEqual({ data: { hits: [], didYouMean: null, suggested: [] } });
    expect(serviceUsers.list).not.toHaveBeenCalled();
  });
});
