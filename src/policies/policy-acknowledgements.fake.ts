/** In-memory Prisma + seed data for the policy acknowledgement specs (not a spec itself). */
import { PolicyAcknowledgementStatus, PolicyAudienceTargetType, PolicyStatus, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyAcknowledgementsService } from './policy-acknowledgements.service';

export type Row = Record<string, any>;

const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** Minimal in-memory Prisma for the queries PolicyAcknowledgementsService makes. */
export function createFake() {
  const store = {
    employees: [] as Row[],
    users: [] as Row[],
    roles: [] as Row[],
    documents: [] as Row[],
    versions: [] as Row[],
    acks: [] as Row[],
    /** In-app notifications sent (for the weekly summary de-duplication). */
    notifications: [] as Row[],
    /** User ids returned by the "who manages acknowledgements" query. */
    managerUserIds: [] as string[],
  };
  let tick = 0;
  /** Strictly increasing timestamps, like @updatedAt. */
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++tick);

  const employeePayload = (e: Row) => ({
    id: e.id,
    createdAt: e.createdAt ?? daysAgo(400),
    personalDetail: { firstName: e.firstName, lastName: e.lastName, email: e.email },
    employment: {
      roleId: e.roleId ?? null,
      jobTitleId: e.jobTitleId ?? null,
      workAreaId: e.workAreaId ?? null,
      locationId: e.locationId ?? null,
      baseLocationId: null,
      startDate: e.startDate ?? null,
      floorLocations: [],
      rbacLevel: e.rbacLevel ? { name: e.rbacLevel } : null,
      jobTitle: e.jobTitle ? { name: e.jobTitle } : null,
      location: e.locationName ? { name: e.locationName } : null,
      baseLocation: null,
    },
  });
  const activeEmployee = (e: Row) => !e.deletedAt && e.isActive !== false;
  const versionPayload = (v: Row) => {
    const doc = store.documents.find((d) => d.id === v.documentId)!;
    return {
      ...v,
      applicability: v.applicability ?? [],
      audiences: v.audiences ?? [],
      document: {
        id: doc.id,
        reference: doc.reference,
        title: doc.title,
        currentVersionId: doc.currentVersionId ?? null,
        primaryCategory: { id: 'cat', name: 'Care' },
      },
    };
  };
  const docOk = (v: Row, where?: Row) => {
    if (!where?.document) return true;
    const doc = store.documents.find((d) => d.id === v.documentId);
    return !!doc && !doc.deletedAt && !doc.isCatalogue;
  };

  const prisma = {
    employeePersonalDetail: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const email = String(where.email.equals).toLowerCase();
        const e = store.employees.find((row) => row.email?.toLowerCase() === email && activeEmployee(row));
        return e ? { employeeId: e.id } : null;
      }),
    },
    employee: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const e = store.employees.find((row) => row.id === where.id && activeEmployee(row));
        return e ? employeePayload(e) : null;
      }),
      findMany: jest.fn(async () => store.employees.filter(activeEmployee).map(employeePayload)),
    },
    user: {
      findMany: jest.fn(async ({ where }: Row) => {
        if (where.userRoles) return store.managerUserIds.map((id) => ({ id }));
        const emails: string[] | null = where.OR
          ? where.OR.map((c: Row) => String(c.email.equals).toLowerCase())
          : null;
        return store.users
          .filter((u) => !emails || emails.includes(u.email.toLowerCase()))
          .map((u) => ({ id: u.id ?? `user-${u.email}`, email: u.email, userRoles: u.roleIds.map((roleId: string) => ({ roleId })) }));
      }),
    },
    role: {
      findMany: jest.fn(async ({ where }: Row) => store.roles.filter((r) => where.name.in.includes(r.name))),
    },
    policyDocument: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const doc = store.documents.find((d) => d.id === where.id && !d.deletedAt && !d.isCatalogue);
        return doc ? { id: doc.id, reference: doc.reference, title: doc.title } : null;
      }),
    },
    policyVersion: {
      findMany: jest.fn(async ({ where }: Row) => {
        if (where.documentId?.in) {
          return store.versions.filter((v) => where.documentId.in.includes(v.documentId) && v.publishedAt);
        }
        return store.versions
          .filter(
            (v) =>
              v.status === where.status &&
              v.acknowledgementRequired === where.acknowledgementRequired &&
              (!where.documentId || v.documentId === where.documentId) &&
              docOk(v, where),
          )
          .map(versionPayload);
      }),
      findFirst: jest.fn(async ({ where }: Row) => {
        const v = store.versions.find((row) => row.documentId === where.documentId && row.status === where.status);
        return v ? versionPayload(v) : null;
      }),
    },
    policyAcknowledgement: {
      findMany: jest.fn(async ({ where }: Row) =>
        store.acks.filter(
          (a) =>
            where.versionId.in.includes(a.versionId) &&
            (!where.employeeId || where.employeeId.in.includes(a.employeeId)),
        ),
      ),
      upsert: jest.fn(async ({ where, create, update }: Row) => {
        const key = where.versionId_employeeId;
        const existing = store.acks.find((a) => a.versionId === key.versionId && a.employeeId === key.employeeId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: stamp() });
          return existing;
        }
        const row = { id: `ack-${store.acks.length + 1}`, metadata: null, updatedAt: stamp(), ...create };
        store.acks.push(row);
        return row;
      }),
      createMany: jest.fn(async ({ data, skipDuplicates }: Row) => {
        let count = 0;
        for (const item of data as Row[]) {
          const dup = store.acks.some((a) => a.versionId === item.versionId && a.employeeId === item.employeeId);
          if (dup) {
            if (skipDuplicates) continue;
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' });
          }
          store.acks.push({ id: `ack-${store.acks.length + 1}`, viewedAt: null, acknowledgedAt: null, updatedAt: stamp(), ...item });
          count += 1;
        }
        return { count };
      }),
      create: jest.fn(async ({ data }: Row) => {
        if (store.acks.some((a) => a.versionId === data.versionId && a.employeeId === data.employeeId)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: `ack-${store.acks.length + 1}`, viewedAt: null, acknowledgedAt: null, updatedAt: stamp(), ...data };
        store.acks.push(row);
        return { id: row.id, metadata: row.metadata ?? null };
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const row = store.acks.find(
          (a) =>
            a.id === where.id &&
            (!where.updatedAt || a.updatedAt?.getTime() === where.updatedAt.getTime()) &&
            (!where.status?.not || a.status !== where.status.not),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data, { updatedAt: stamp() });
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = store.acks.find((a) => a.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: stamp() });
        return row;
      }),
    },
    notification: {
      findMany: jest.fn(async ({ where }: Row) =>
        store.notifications.filter(
          (n) =>
            n.type === where.type &&
            n.recipients.some((r: Row) => where.recipients.some.userId.in.includes(r.userId)),
        ),
      ),
    },
  };

  const audit = { logAudit: jest.fn(async () => undefined) };
  const service = new PolicyAcknowledgementsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogsService,
  );
  return { store, prisma, audit, service };
}

export const webUser = (email: string, overrides: Partial<RequestUser> = {}): RequestUser => ({
  id: `user-${email}`,
  email,
  roles: ['Carer/Domestic'],
  permissions: ['policies.read', 'policies.acknowledgements.me'],
  accountKind: 'user',
  assignedLocationIds: null,
  ...overrides,
});

export function seed() {
  const fake = createFake();
  const { store } = fake;
  store.roles.push({ id: 'role-carer', name: 'Carer/Domestic' }, { id: 'role-manager', name: 'Manager' });
  store.employees.push(
    {
      id: 'emp-anna',
      firstName: 'Anna',
      lastName: 'Carer',
      email: 'anna@care.test',
      rbacLevel: 'Carer/Domestic',
      locationId: 'loc-a',
      locationName: 'Branch A',
      jobTitle: 'Care Assistant',
    },
    {
      id: 'emp-ben',
      firstName: 'Ben',
      lastName: 'Carer',
      email: 'ben@care.test',
      rbacLevel: 'Carer/Domestic',
      locationId: 'loc-b',
      locationName: 'Branch B',
    },
    { id: 'emp-cara', firstName: 'Cara', lastName: 'Manager', email: 'cara@care.test', locationId: 'loc-a' },
    { id: 'emp-gone', firstName: 'Gone', lastName: 'Leaver', email: 'gone@care.test', isActive: false },
  );
  store.users.push({ email: 'Cara@care.test', roleIds: ['role-manager'] });

  // POL-1: org-wide, carers only (identity role), acknowledgement required, v1.1 (minor) current.
  store.documents.push(
    { id: 'doc-1', reference: 'POL-1', title: 'Safeguarding' },
    { id: 'doc-2', reference: 'POL-2', title: 'Infection control' },
    { id: 'doc-3', reference: 'POL-3', title: 'Not required' },
    { id: 'doc-cat', reference: 'CAT-1', title: 'Catalogue', isCatalogue: true },
  );
  const carersOnly = [
    { targetType: PolicyAudienceTargetType.ROLE, roleId: 'role-carer', jobTitleId: null, workAreaId: null, locationId: null },
  ];
  const orgWide = [{ organisationWide: true, locationId: null, serviceTypeCode: null }];
  store.versions.push(
    {
      id: 'v1-0',
      documentId: 'doc-1',
      versionMajor: 1,
      versionMinor: 0,
      status: PolicyStatus.SUPERSEDED,
      publishedAt: daysAgo(30),
      acknowledgementRequired: true,
      applicability: orgWide,
      audiences: carersOnly,
    },
    {
      id: 'v1-1',
      documentId: 'doc-1',
      versionMajor: 1,
      versionMinor: 1,
      status: PolicyStatus.PUBLISHED,
      publishedAt: daysAgo(5),
      acknowledgementRequired: true,
      applicability: orgWide,
      audiences: carersOnly,
      contentHtml: '<h2>Key points for staff</h2>',
    },
    {
      id: 'v2-0',
      documentId: 'doc-2',
      versionMajor: 2,
      versionMinor: 0,
      status: PolicyStatus.PUBLISHED,
      publishedAt: daysAgo(3),
      acknowledgementRequired: true,
      applicability: orgWide,
      audiences: [],
    },
    {
      id: 'v3-0',
      documentId: 'doc-3',
      versionMajor: 1,
      versionMinor: 0,
      status: PolicyStatus.PUBLISHED,
      publishedAt: daysAgo(3),
      acknowledgementRequired: false,
      applicability: orgWide,
      audiences: [],
    },
    {
      id: 'vcat',
      documentId: 'doc-cat',
      versionMajor: 1,
      versionMinor: 0,
      status: PolicyStatus.PUBLISHED,
      publishedAt: daysAgo(3),
      acknowledgementRequired: true,
      applicability: orgWide,
      audiences: [],
    },
  );
  return fake;
}
